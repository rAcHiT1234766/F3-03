import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { JobFields, OperationPayload } from '../../src/domain'
import { applyOperation } from '../../src/sync/remote'
import { sampleFields } from '../unit/helpers'
import { PROJECT_ID, emulatorTargets } from './support'

let env: RulesTestEnvironment
const ALICE = 'alice'
const BOB = 'bob'

beforeAll(async () => {
  const { firestore } = emulatorTargets(false)
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: firestore.host,
      port: firestore.port,
    },
  })
})
afterEach(() => env.clearFirestore())
afterAll(() => env.cleanup())

// Rules-unit-testing returns compat instances; the modular API accepts them.
const db = (uid: string | null): Firestore =>
  (uid
    ? env.authenticatedContext(uid).firestore()
    : env.unauthenticatedContext().firestore()) as unknown as Firestore

const uuid = () => crypto.randomUUID()

function payload(
  uid: string,
  jobId: string,
  kind: OperationPayload['kind'],
  fields: JobFields,
  changes: Partial<JobFields> = {},
): OperationPayload {
  const baseValues = Object.fromEntries(
    Object.keys(changes).map((k) => [k, fields[k as keyof JobFields]]),
  )
  return {
    protocolVersion: 1,
    opId: uuid(),
    ownerId: uid,
    deviceId: 'device-a',
    jobId,
    kind,
    baseRevision: null,
    baseValues: kind === 'patch' ? baseValues : {},
    patch: kind === 'patch' ? changes : {},
    after: { ...fields, ...changes },
    clientCreatedAt: 1,
  }
}

function jobDoc(
  uid: string,
  jobId: string,
  opId: string,
  overrides: DocumentData = {},
): DocumentData {
  return {
    schemaVersion: 1,
    id: jobId,
    ownerId: uid,
    fields: sampleFields(),
    deleted: false,
    revision: 1,
    lastOpId: opId,
    updatedAt: serverTimestamp(),
    ...overrides,
  }
}

function receiptDoc(uid: string, job: DocumentData, overrides: DocumentData = {}): DocumentData {
  const kind = job.revision === 1 ? 'create' : 'patch'
  return {
    protocolVersion: 1,
    opId: job.lastOpId,
    ownerId: uid,
    deviceId: 'device-a',
    jobId: job.id,
    kind,
    outcome: 'applied',
    request: { protocolVersion: 1, opId: job.lastOpId, ownerId: uid, jobId: job.id, kind },
    result: job,
    conflicts: [],
    receivedAt: serverTimestamp(),
    ...overrides,
  }
}

/** Writes a job and its receipt in one atomic batch, as the client transaction does. */
async function writePair(fs: Firestore, uid: string, job: DocumentData, receipt: DocumentData) {
  const batch = writeBatch(fs)
  batch.set(doc(fs, 'users', uid, 'jobs', job.id), job)
  batch.set(doc(fs, 'users', uid, 'operations', receipt.opId), receipt)
  return batch.commit()
}

async function seedValidJob(uid = ALICE) {
  const job = jobDoc(uid, uuid(), uuid())
  await assertSucceeds(writePair(db(uid), uid, job, receiptDoc(uid, job)))
  return job
}

describe('jobs and receipts', () => {
  it('accepts a valid job + receipt pair (positive control)', async () => {
    const job = await seedValidJob()
    const snap = await getDoc(doc(db(ALICE), 'users', ALICE, 'jobs', job.id))
    expect(snap.data()?.revision).toBe(1)
  })

  it('denies a job write without its receipt in the same atomic write', async () => {
    const job = jobDoc(ALICE, uuid(), uuid())
    await assertFails(setDoc(doc(db(ALICE), 'users', ALICE, 'jobs', job.id), job))
  })

  it('denies a receipt whose revision does not match the job', async () => {
    const job = jobDoc(ALICE, uuid(), uuid())
    await assertFails(
      writePair(db(ALICE), ALICE, job, receiptDoc(ALICE, job, { result: { ...job, revision: 2 } })),
    )
  })

  it('requires the authoritative server timestamp', async () => {
    const job = jobDoc(ALICE, uuid(), uuid(), {
      updatedAt: Timestamp.fromMillis(Date.now() + 864e5),
    })
    await assertFails(writePair(db(ALICE), ALICE, job, receiptDoc(ALICE, job)))
  })

  it.each([
    ['title too long', { title: 't'.repeat(121) }],
    ['empty title', { title: '' }],
    ['unknown status', { status: 'done' }],
    ['unknown priority', { priority: 'urgent' }],
    ['timestamp-like due date', { dueDate: '2026-11-03T00:00:00Z' }],
    ['notes too long', { notes: 'n'.repeat(4001) }],
    ['extra field', { colour: 'red' }],
  ])('denies invalid fields: %s', async (_label, change) => {
    const job = jobDoc(ALICE, uuid(), uuid(), { fields: { ...sampleFields(), ...change } })
    await assertFails(writePair(db(ALICE), ALICE, job, receiptDoc(ALICE, job)))
  })

  it('denies a missing business field', async () => {
    const fields: Partial<JobFields> = { ...sampleFields() }
    delete fields.notes
    const job = jobDoc(ALICE, uuid(), uuid(), { fields })
    await assertFails(writePair(db(ALICE), ALICE, job, receiptDoc(ALICE, job)))
  })

  it('denies mismatched IDs, owners and schema versions', async () => {
    const jobId = uuid()
    const fs = db(ALICE)
    for (const overrides of [
      { id: uuid() },
      { ownerId: BOB },
      { schemaVersion: 2 },
      { revision: 2 },
      { deleted: true },
    ]) {
      const job = jobDoc(ALICE, jobId, uuid(), overrides)
      const batch = writeBatch(fs)
      batch.set(doc(fs, 'users', ALICE, 'jobs', jobId), job)
      batch.set(
        doc(fs, 'users', ALICE, 'operations', job.lastOpId),
        receiptDoc(ALICE, { ...job, id: jobId }),
      )
      await assertFails(batch.commit())
    }
  })

  it('an update must advance the revision by exactly one with a new receipt', async () => {
    const job = await seedValidJob()
    const skip = jobDoc(ALICE, job.id, uuid(), {
      revision: 3,
      fields: sampleFields({ notes: 'x' }),
    })
    await assertFails(writePair(db(ALICE), ALICE, skip, receiptDoc(ALICE, skip)))
    const sameOp = jobDoc(ALICE, job.id, job.lastOpId, {
      revision: 2,
      fields: sampleFields({ notes: 'x' }),
    })
    await assertFails(setDoc(doc(db(ALICE), 'users', ALICE, 'jobs', job.id), sameOp))
    const next = jobDoc(ALICE, job.id, uuid(), {
      revision: 2,
      fields: sampleFields({ notes: 'x' }),
    })
    await assertSucceeds(writePair(db(ALICE), ALICE, next, receiptDoc(ALICE, next)))
  })

  it('tombstones are terminal and keep their fields', async () => {
    const job = await seedValidJob()
    const changedOnDelete = jobDoc(ALICE, job.id, uuid(), {
      revision: 2,
      deleted: true,
      fields: sampleFields({ notes: 'x' }),
    })
    await assertFails(
      writePair(db(ALICE), ALICE, changedOnDelete, receiptDoc(ALICE, changedOnDelete)),
    )
    const tomb = jobDoc(ALICE, job.id, uuid(), { revision: 2, deleted: true })
    await assertSucceeds(
      writePair(
        db(ALICE),
        ALICE,
        tomb,
        receiptDoc(ALICE, tomb, {
          kind: 'delete',
          request: {
            protocolVersion: 1,
            opId: tomb.lastOpId,
            ownerId: ALICE,
            jobId: job.id,
            kind: 'delete',
          },
        }),
      ),
    )
    const revive = jobDoc(ALICE, job.id, uuid(), { revision: 3, deleted: false })
    await assertFails(writePair(db(ALICE), ALICE, revive, receiptDoc(ALICE, revive)))
  })

  it('never allows physical deletion of jobs, or changes to receipts', async () => {
    const job = await seedValidJob()
    await assertFails(deleteDoc(doc(db(ALICE), 'users', ALICE, 'jobs', job.id)))
    const receiptRef = doc(db(ALICE), 'users', ALICE, 'operations', job.lastOpId)
    await assertFails(updateDoc(receiptRef, { outcome: 'noop' }))
    await assertFails(deleteDoc(receiptRef))
  })

  it('a noop receipt is allowed only while the job stays unchanged', async () => {
    const job = await seedValidJob()
    const stored = (await getDoc(doc(db(ALICE), 'users', ALICE, 'jobs', job.id))).data()!
    const opId = uuid()
    const noop = receiptDoc(ALICE, stored, {
      opId,
      kind: 'patch',
      outcome: 'noop',
      request: { protocolVersion: 1, opId, ownerId: ALICE, jobId: job.id, kind: 'patch' },
    })
    await assertSucceeds(setDoc(doc(db(ALICE), 'users', ALICE, 'operations', opId), noop))
    const rejectedId = uuid()
    const rejected: DocumentData = {
      ...noop,
      opId: rejectedId,
      outcome: 'rejected_deleted',
      request: { ...noop.request, opId: rejectedId },
    }
    // Denied: a rejected_deleted receipt must reference a tombstone, and this job is not deleted.
    await assertFails(setDoc(doc(db(ALICE), 'users', ALICE, 'operations', rejectedId), rejected))
  })
})

describe('account isolation (T33)', () => {
  it('another account cannot read, list or write the owner data', async () => {
    const job = await seedValidJob(ALICE)
    await assertFails(getDoc(doc(db(BOB), 'users', ALICE, 'jobs', job.id)))
    await assertFails(getDocs(collection(db(BOB), 'users', ALICE, 'jobs')))
    await assertFails(getDoc(doc(db(BOB), 'users', ALICE, 'operations', job.lastOpId)))
    await assertFails(getDoc(doc(db(null), 'users', ALICE, 'jobs', job.id)))
    const forged = jobDoc(ALICE, uuid(), uuid())
    await assertFails(writePair(db(BOB), ALICE, forged, receiptDoc(ALICE, forged)))
    await assertSucceeds(getDocs(collection(db(ALICE), 'users', ALICE, 'jobs')))
  })
})

describe('device registrations', () => {
  const device = (overrides: DocumentData = {}) => ({
    deviceId: 'device-a',
    fid: 'fid-123',
    enabled: true,
    userAgent: 'test',
    updatedAt: serverTimestamp(),
    ...overrides,
  })

  it('owner-only, shape-checked, server-timestamped', async () => {
    const ref = (uid: string, as: string) => doc(db(as), 'users', uid, 'devices', 'device-a')
    await assertSucceeds(setDoc(ref(ALICE, ALICE), device()))
    await assertFails(setDoc(ref(ALICE, BOB), device()))
    await assertFails(getDoc(ref(ALICE, BOB)))
    await assertFails(setDoc(ref(ALICE, ALICE), device({ token: 'legacy' })))
    await assertFails(setDoc(ref(ALICE, ALICE), device({ deviceId: 'other' })))
    await assertFails(setDoc(ref(ALICE, ALICE), device({ updatedAt: Timestamp.now() })))
    await assertSucceeds(deleteDoc(ref(ALICE, ALICE)))
  })
})

describe('the real client transaction satisfies the rules for every outcome', () => {
  it('create, patch, delete, repeated delete and update-after-delete', async () => {
    const fs = db(ALICE)
    const jobId = uuid()
    const fields = sampleFields()
    const create = await applyOperation(fs, ALICE, payload(ALICE, jobId, 'create', fields))
    expect(create).toMatchObject({ outcome: 'applied', result: { revision: 1 } })
    const patch = await applyOperation(
      fs,
      ALICE,
      payload(ALICE, jobId, 'patch', fields, { notes: 'Checked' }),
    )
    expect(patch).toMatchObject({ outcome: 'applied', result: { revision: 2 } })
    const same = await applyOperation(
      fs,
      ALICE,
      payload(ALICE, jobId, 'patch', fields, { notes: 'Checked' }),
    )
    expect(same).toMatchObject({ outcome: 'noop', result: { revision: 2 } })
    const del = await applyOperation(
      fs,
      ALICE,
      payload(ALICE, jobId, 'delete', patch.result.fields),
    )
    expect(del).toMatchObject({ outcome: 'applied', result: { revision: 3, deleted: true } })
    const again = await applyOperation(
      fs,
      ALICE,
      payload(ALICE, jobId, 'delete', patch.result.fields),
    )
    expect(again).toMatchObject({ outcome: 'noop', result: { revision: 3 } })
    const late = await applyOperation(
      fs,
      ALICE,
      payload(ALICE, jobId, 'patch', fields, { title: 'Stale' }),
    )
    expect(late).toMatchObject({
      outcome: 'rejected_deleted',
      result: { revision: 3, deleted: true },
    })
    expect(late.result.fields.title).toBe(fields.title)
    expect(typeof late.receivedAt).toBe('number')
  })

  it('T18: rules deny writing another account path, surfacing permission-denied', async () => {
    const error = await applyOperation(
      db(ALICE),
      BOB,
      payload(BOB, uuid(), 'create', sampleFields()),
    ).catch((e: unknown) => e)
    expect((error as { code?: string }).code).toMatch(/permission-denied/)
  })
})
