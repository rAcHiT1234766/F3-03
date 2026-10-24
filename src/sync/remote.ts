// Firestore transport: server-backed reads, one transaction per operation, immutable receipts.
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore'
import {
  FIELD_KEYS,
  PROTOCOL_VERSION,
  isUuid,
  parseSnapshot,
  payloadProblem,
  samePayload,
  type FieldConflict,
  type JobSnapshot,
  type OperationPayload,
  type Receipt,
} from '../domain'
import type { Remote } from './engine'
import { SyncError } from './errors'
import { FINAL_POLICY, resolveOperation, type ConflictPolicy } from './merge'

function millis(value: unknown): number | null {
  const ts = value as { toMillis?: () => number } | null
  return typeof ts?.toMillis === 'function' ? ts.toMillis() : null
}

/** Converts a Firestore job document (real Timestamp) into a validated snapshot. */
export function parseJobDoc(data: DocumentData, uid: string, id: string): JobSnapshot | null {
  const updatedAt = millis(data.updatedAt)
  return updatedAt === null ? null : parseSnapshot({ ...data, updatedAt }, uid, id)
}

function parseConflicts(x: unknown): FieldConflict[] | null {
  if (!Array.isArray(x)) return null
  const ok = x.every((c) => c && FIELD_KEYS.includes(c.field) && 'incoming' in c && 'remote' in c)
  return ok ? (x as FieldConflict[]) : null
}

export function parseReceiptDoc(data: DocumentData, uid: string): Receipt | null {
  const result = data.result ? parseJobDoc(data.result, uid, data.jobId) : null
  const receivedAt = millis(data.receivedAt)
  const conflicts = parseConflicts(data.conflicts)
  const request = data.request as OperationPayload
  if (
    data.protocolVersion !== PROTOCOL_VERSION ||
    !isUuid(data.opId) ||
    data.ownerId !== uid ||
    !result ||
    receivedAt === null ||
    !conflicts ||
    !['applied', 'noop', 'rejected_deleted'].includes(data.outcome) ||
    !request ||
    payloadProblem(request) !== null ||
    request.opId !== data.opId ||
    request.jobId !== data.jobId ||
    request.ownerId !== uid
  ) {
    return null
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    opId: data.opId,
    ownerId: uid,
    deviceId: String(data.deviceId),
    jobId: result.id,
    kind: request.kind,
    outcome: data.outcome,
    request,
    result,
    conflicts,
    receivedAt,
  }
}

const receiptMismatch = () =>
  new SyncError(
    'blocked',
    'receipt_mismatch',
    'This operation ID was already used for a different change.',
  )

/**
 * Applies one queued operation exactly once per opId (while receipts are retained).
 * The transaction callback has no side effects besides Firestore reads/writes, because
 * Firestore may run it more than once.
 */
export async function applyOperation(
  fs: Firestore,
  uid: string,
  payload: OperationPayload,
  policy: ConflictPolicy = FINAL_POLICY,
): Promise<Receipt> {
  const problem = payloadProblem(payload)
  if (problem) throw new SyncError('blocked', 'invalid_operation', problem)
  if (payload.ownerId !== uid) {
    throw new SyncError('blocked', 'wrong_owner', 'This change belongs to a different account.')
  }
  const jobRef = doc(fs, 'users', uid, 'jobs', payload.jobId)
  const opRef = doc(fs, 'users', uid, 'operations', payload.opId)

  const transaction = () =>
    runTransaction(fs, async (tx) => {
      const existing = await tx.get(opRef)
      if (existing.exists()) {
        if (!samePayload(payload, existing.data().request)) throw receiptMismatch()
        return // already processed: no second mutation
      }
      const jobSnap = await tx.get(jobRef)
      const current = jobSnap.exists() ? parseJobDoc(jobSnap.data(), uid, payload.jobId) : null
      if (jobSnap.exists() && !current) {
        throw new SyncError(
          'blocked',
          'invalid_remote_job',
          'The server copy of this job is not valid.',
        )
      }
      const resolution = resolveOperation(current, payload, policy)
      if (!resolution.ok) throw new SyncError('blocked', resolution.code, resolution.message)

      let result: DocumentData
      if (resolution.changed) {
        result = {
          schemaVersion: 1,
          id: payload.jobId,
          ownerId: uid,
          fields: resolution.fields,
          deleted: resolution.deleted,
          revision: (current?.revision ?? 0) + 1,
          lastOpId: payload.opId,
          updatedAt: serverTimestamp(),
        }
        tx.set(jobRef, result)
      } else {
        result = jobSnap.data()! // unchanged canonical document, with its real timestamp
      }
      tx.set(opRef, {
        protocolVersion: PROTOCOL_VERSION,
        opId: payload.opId,
        ownerId: uid,
        deviceId: payload.deviceId,
        jobId: payload.jobId,
        kind: payload.kind,
        outcome: resolution.outcome,
        request: payload,
        result,
        conflicts: resolution.conflicts,
        receivedAt: serverTimestamp(),
      })
    })

  // Under contention, the rules can be evaluated against a revision another device just
  // committed, so the losing commit fails as permission-denied instead of a retryable conflict.
  // Nothing was applied, the transaction re-reads and the receipt check keeps it idempotent,
  // and a genuine denial repeats every time — so a bounded immediate re-run is safe.
  for (let attempt = 1; ; attempt++) {
    try {
      await transaction()
      break
    } catch (e) {
      if ((e as { code?: string }).code !== 'permission-denied' || attempt >= 3) throw e
    }
  }

  // Read the committed receipt back from the server so timestamps and values are real.
  // If this read fails, the caller keeps the operation queued; the retry finds the receipt.
  const committed = await getDocFromServer(opRef)
  const receipt = committed.exists() ? parseReceiptDoc(committed.data(), uid) : null
  if (!receipt) {
    throw new SyncError(
      'transient',
      'receipt_unconfirmed',
      'The server did not confirm this change.',
    )
  }
  if (!samePayload(payload, receipt.request)) throw receiptMismatch()
  return receipt
}

export function createFirestoreRemote(
  fs: Firestore,
  uid: string,
  policy: ConflictPolicy = FINAL_POLICY,
): Remote {
  return {
    applyOperation: (payload) => applyOperation(fs, uid, payload, policy),

    // Full server-backed reconciliation, tombstones included. Intended for tens to a few
    // hundred jobs; reads scale with the dataset size.
    async fetchJobs() {
      const snap = await getDocsFromServer(collection(fs, 'users', uid, 'jobs'))
      const jobs: JobSnapshot[] = []
      for (const d of snap.docs) {
        const job = parseJobDoc(d.data(), uid, d.id)
        if (job) jobs.push(job)
        else console.warn(`FieldLog: ignored an invalid server job document (${d.id}).`)
      }
      return jobs
    },

    async getReceipt(opId) {
      if (!isUuid(opId)) throw new SyncError('blocked', 'invalid_operation', 'Bad operation ID.')
      const snap = await getDocFromServer(doc(fs, 'users', uid, 'operations', opId))
      return snap.exists() ? parseReceiptDoc(snap.data(), uid) : null
    },
  }
}
