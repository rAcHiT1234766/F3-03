// Test doubles. FakeServer follows the same protocol as src/sync/remote.ts (receipt lookup first,
// pure resolver, revision +1 per real change, immutable receipts) but in memory, so engine and
// acknowledgement behaviour can be paused, failed and inspected deterministically.
import { FieldLogDB } from '../../src/db'
import {
  samePayload,
  type JobFields,
  type JobSnapshot,
  type OperationPayload,
  type Receipt,
} from '../../src/domain'
import type { LocalContext } from '../../src/jobs'
import type { Remote } from '../../src/sync/engine'
import { SyncError } from '../../src/sync/errors'
import { FINAL_POLICY, resolveOperation, type ConflictPolicy } from '../../src/sync/merge'

export function sampleFields(overrides: Partial<JobFields> = {}): JobFields {
  return {
    title: 'Boiler inspection',
    customerName: 'Acme Lettings',
    siteAddress: '12 Harbour Road',
    description: 'Annual service',
    notes: '',
    status: 'scheduled',
    priority: 'normal',
    dueDate: '2026-11-03',
    ...overrides,
  }
}

export function newDb(name = `test-${crypto.randomUUID()}`): FieldLogDB {
  return new FieldLogDB(name)
}

export function testContext(
  db: FieldLogDB,
  ownerId = 'user-a',
  deviceId = 'device-a',
): LocalContext & { syncRequests: string[] } {
  const syncRequests: string[] = []
  return { db, ownerId, deviceId, syncRequests, requestSync: (r) => syncRequests.push(r) }
}

/** Mimics a FirebaseError (`code` property), which is all the classifier looks at. */
export function firebaseError(code: string): Error {
  return Object.assign(new Error(`simulated ${code}`), { code })
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

export class FakeServer {
  jobs = new Map<string, JobSnapshot>()
  receipts = new Map<string, Receipt>()
  mutations = 0
  clock = 1_000_000

  constructor(public policy: ConflictPolicy = FINAL_POLICY) {}

  apply(payload: OperationPayload): Receipt {
    const existing = this.receipts.get(payload.opId)
    if (existing) {
      if (!samePayload(payload, existing.request)) {
        throw new SyncError('blocked', 'receipt_mismatch', 'opId reused for a different change')
      }
      return structuredClone(existing)
    }
    const current = this.jobs.get(payload.jobId) ?? null
    const resolution = resolveOperation(current, payload, this.policy)
    if (!resolution.ok) throw new SyncError('blocked', resolution.code, resolution.message)
    let result = current!
    if (resolution.changed) {
      this.mutations++
      result = {
        schemaVersion: 1,
        id: payload.jobId,
        ownerId: payload.ownerId,
        fields: resolution.fields,
        deleted: resolution.deleted,
        revision: (current?.revision ?? 0) + 1,
        lastOpId: payload.opId,
        updatedAt: ++this.clock,
      }
      this.jobs.set(payload.jobId, result)
    }
    const receipt: Receipt = {
      protocolVersion: 1,
      opId: payload.opId,
      ownerId: payload.ownerId,
      deviceId: payload.deviceId,
      jobId: payload.jobId,
      kind: payload.kind,
      outcome: resolution.outcome,
      request: structuredClone(payload),
      result: structuredClone(result),
      conflicts: resolution.conflicts,
      receivedAt: ++this.clock,
    }
    this.receipts.set(payload.opId, receipt)
    return structuredClone(receipt)
  }
}

export type Fault = 'unavailable' | 'lost-response' | 'permission-denied' | 'unauthenticated'

/** A Remote for one account, with per-call fault injection and pause hooks. */
export function fakeRemote(server: FakeServer, uid: string) {
  const control = {
    faults: [] as (Fault | null)[],
    pullFaults: [] as (Fault | null)[],
    calls: [] as string[],
    pulls: 0,
    beforeApply: null as null | ((p: OperationPayload) => Promise<void>),
    afterCommit: null as null | ((p: OperationPayload) => Promise<void>),
  }
  const remote: Remote = {
    async applyOperation(payload) {
      control.calls.push(payload.opId)
      if (payload.ownerId !== uid) throw new SyncError('blocked', 'wrong_owner', 'wrong owner')
      await control.beforeApply?.(payload)
      const fault = control.faults.shift() ?? null
      if (fault && fault !== 'lost-response') throw firebaseError(fault)
      const receipt = server.apply(payload)
      await control.afterCommit?.(payload)
      if (fault === 'lost-response') throw firebaseError('unavailable') // committed, reply lost
      return receipt
    },
    async fetchJobs() {
      control.pulls++
      const fault = control.pullFaults.shift() ?? null
      if (fault) throw firebaseError(fault === 'lost-response' ? 'unavailable' : fault)
      return [...server.jobs.values()]
        .filter((j) => j.ownerId === uid)
        .map((j) => structuredClone(j))
    },
    async getReceipt(opId) {
      const r = server.receipts.get(opId)
      return r && r.ownerId === uid ? structuredClone(r) : null
    },
  }
  return { remote, control }
}
