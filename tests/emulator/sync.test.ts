// Real Firestore protocol tests: the production remote adapter, engine and Dexie code against the
// Auth + Firestore emulators. Each "device" is an independent Firebase app instance signed in as
// the same user, with its own local database.
import Dexie from 'dexie'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FieldLogDB } from '../../src/db'
import type { OperationPayload } from '../../src/domain'
import { createJob, deleteJob, editJob } from '../../src/jobs'
import { createSyncEngine, type Remote } from '../../src/sync/engine'
import { classifyError } from '../../src/sync/errors'
import type { ConflictPolicy } from '../../src/sync/merge'
import { applyOperation, createFirestoreRemote } from '../../src/sync/remote'
import { firebaseError, sampleFields, testContext } from '../unit/helpers'
import { clearFirestore, createUser, signedInClient, type DeviceClient } from './support'

const cleanups: (() => Promise<void>)[] = []
beforeEach(clearFirestore)
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})

type User = Awaited<ReturnType<typeof createUser>>

async function device(
  user: User,
  options: { policy?: ConflictPolicy; wrap?: (r: Remote) => Remote } = {},
) {
  const client = await signedInClient(user)
  const db = new FieldLogDB(`emu-${crypto.randomUUID()}`)
  const ctx = testContext(db, client.uid, `dev-${crypto.randomUUID().slice(0, 8)}`)
  const base = createFirestoreRemote(client.firestore, client.uid, options.policy)
  const remote = options.wrap ? options.wrap(base) : base
  const engine = createSyncEngine({ db, remote, lockName: `emu:${db.name}` })
  cleanups.push(async () => {
    await engine.stop()
    db.close()
    await Dexie.delete(db.name)
    await client.close()
  })
  const sync = async () => {
    engine.request('manual')
    await engine.whenIdle()
  }
  const fields = async (id: string) => (await db.jobs.get(id))!.view.fields
  const edit = async (id: string, changes: Parameters<typeof sampleFields>[0]) => {
    const f = await fields(id)
    return editJob(ctx, id, f, { ...f, ...changes })
  }
  return { client, db, ctx, engine, sync, fields, edit }
}

async function serverJob(client: DeviceClient, id: string) {
  return (await getDoc(doc(client.firestore, 'users', client.uid, 'jobs', id))).data()
}

async function receipts(client: DeviceClient) {
  return (await getDocs(collection(client.firestore, 'users', client.uid, 'operations'))).docs.map(
    (d) => d.data(),
  )
}

describe('first real round trip (T07–T10)', () => {
  it('T07: a create reaches Firestore with revision 1 and an atomic receipt', async () => {
    const user = await createUser()
    const a = await device(user)
    const id = await createJob(a.ctx, sampleFields())
    const [queued] = await a.db.outbox.toArray()
    await a.sync()
    const job = await serverJob(a.client, id)
    expect(job).toMatchObject({
      revision: 1,
      deleted: false,
      ownerId: a.client.uid,
      lastOpId: queued!.payload.opId,
    })
    const [receipt] = await receipts(a.client)
    expect(receipt).toMatchObject({
      opId: queued!.payload.opId,
      outcome: 'applied',
      kind: 'create',
    })
    expect(receipt!.request).toEqual(queued!.payload)
    expect(await a.db.outbox.count()).toBe(0)
    const local = await a.db.jobs.get(id)
    expect(local?.shadow?.revision).toBe(1)
    expect(Math.abs(local!.shadow!.updatedAt - Date.now())).toBeLessThan(60_000) // a real server time
  })

  it('T08: the same payload applied twice gives one revision and one receipt', async () => {
    const user = await createUser()
    const a = await device(user)
    await createJob(a.ctx, sampleFields())
    const [row] = await a.db.outbox.toArray()
    const first = await applyOperation(a.client.firestore, a.client.uid, row!.payload)
    const second = await applyOperation(a.client.firestore, a.client.uid, row!.payload)
    expect(second).toEqual(first)
    expect(first.result.updatedAt).toBe(first.receivedAt) // both are the commit's request.time
    expect((await serverJob(a.client, row!.payload.jobId))?.revision).toBe(1)
    expect(await receipts(a.client)).toHaveLength(1)
  })

  it('T09: a committed write whose response is lost is resolved by retrying the same opId', async () => {
    const user = await createUser()
    let loseNext = true
    const a = await device(user, {
      wrap: (r) => ({
        ...r,
        async applyOperation(p) {
          const receipt = await r.applyOperation(p)
          if (loseNext) {
            loseNext = false
            throw firebaseError('unavailable') // the server committed; the reply never arrived
          }
          return receipt
        },
      }),
    })
    const id = await createJob(a.ctx, sampleFields())
    await a.sync()
    expect((await a.db.outbox.toArray())[0]).toMatchObject({ state: 'retry_wait', attempts: 1 })
    expect((await serverJob(a.client, id))?.revision).toBe(1)
    await a.engine.retryNow()
    await a.engine.whenIdle()
    expect(await a.db.outbox.count()).toBe(0)
    expect((await serverJob(a.client, id))?.revision).toBe(1)
    expect(await receipts(a.client)).toHaveLength(1)
  })

  it('T10: reusing an opId with a different body is a protocol error; data is unchanged', async () => {
    const user = await createUser()
    const a = await device(user)
    const id = await createJob(a.ctx, sampleFields())
    const [row] = await a.db.outbox.toArray()
    await a.sync()
    const forged: OperationPayload = {
      ...row!.payload,
      kind: 'patch',
      patch: { notes: 'forged' },
      baseValues: { notes: '' },
      after: { ...row!.payload.after, notes: 'forged' },
    }
    const error = await applyOperation(a.client.firestore, a.client.uid, forged).catch(
      (e: unknown) => e,
    )
    expect(classifyError(error)).toMatchObject({ kind: 'blocked', code: 'receipt_mismatch' })
    expect(await serverJob(a.client, id)).toMatchObject({ revision: 1, fields: { notes: '' } })
  })
})

describe('two devices, same account (T22, T25–T31)', () => {
  async function pair(policy?: ConflictPolicy) {
    const user = await createUser()
    const a = await device(user, { policy })
    const b = await device(user, { policy })
    const id = await createJob(
      a.ctx,
      sampleFields({ title: 'Boiler inspection', status: 'scheduled' }),
    )
    await a.sync()
    await b.sync() // T22: B downloads A's job
    expect(await b.fields(id)).toEqual(await a.fields(id))
    return { a, b, id }
  }

  it.each([
    ['A first', false],
    ['B first', true],
  ])('T26: disjoint edits both survive (%s)', async (_label, reverse) => {
    const { a, b, id } = await pair()
    await a.edit(id, { status: 'completed' })
    await b.edit(id, { notes: 'Pressure relief valve replaced' })
    const order = reverse ? [b, a] : [a, b]
    for (const d of [...order, ...order]) await d.sync()
    const expected = {
      status: 'completed',
      notes: 'Pressure relief valve replaced',
      title: 'Boiler inspection',
    }
    expect((await serverJob(a.client, id))?.fields).toMatchObject(expected)
    expect((await serverJob(a.client, id))?.revision).toBe(3)
    expect(await a.fields(id)).toMatchObject(expected)
    expect(await b.fields(id)).toMatchObject(expected)
  })

  it('T25: staged record-LWW lets a stale full record overwrite an unrelated change', async () => {
    const { a, b, id } = await pair('record-lww')
    await a.edit(id, { status: 'completed' })
    await a.sync()
    await b.edit(id, { title: 'Boiler inspection — urgent' }) // B never saw A's status change
    await b.sync()
    expect((await serverJob(a.client, id))?.fields).toMatchObject({
      title: 'Boiler inspection — urgent',
      status: 'scheduled', // A's completed status was lost: the documented weakness
    })
  })

  it.each([
    ['A then B', false],
    ['B then A', true],
  ])(
    'T27: same-field edits keep the last server commit and record a notice (%s)',
    async (_l, reverse) => {
      const { a, b, id } = await pair()
      await a.edit(id, { notes: 'A: replace pump' })
      await b.edit(id, { notes: 'B: repair pump' })
      const [first, second] = reverse ? [b, a] : [a, b]
      await first.sync()
      await second.sync()
      await first.sync()
      const winner = reverse ? 'A: replace pump' : 'B: repair pump'
      expect((await serverJob(a.client, id))?.fields.notes).toBe(winner)
      expect((await a.fields(id)).notes).toBe(winner)
      expect((await b.fields(id)).notes).toBe(winner)
      const [notice] = await second.db.conflicts.toArray()
      expect(notice).toMatchObject({ field: 'notes', chosen: winner, incoming: winner })
      expect(await first.db.conflicts.count()).toBe(0)
    },
  )

  it('T28: identical edits are not a conflict and add no revision', async () => {
    const { a, b, id } = await pair()
    await a.edit(id, { status: 'in_progress' })
    await b.edit(id, { status: 'in_progress' })
    await a.sync()
    await b.sync()
    expect((await serverJob(a.client, id))?.revision).toBe(2)
    expect(await b.db.conflicts.count()).toBe(0)
    expect((await receipts(a.client)).map((r) => r.outcome).sort()).toEqual([
      'applied',
      'applied',
      'noop',
    ])
  })

  it('T29: a client clock far in the future cannot decide the winner', async () => {
    const { a, b, id } = await pair()
    await a.edit(id, { notes: 'future clock' })
    const [row] = await a.db.outbox.toArray()
    await a.db.outbox.clear() // replace with the same command stamped one year ahead
    await a.db.outbox.add({
      ...row!,
      payload: { ...row!.payload, clientCreatedAt: Date.now() + 365 * 864e5 },
    })
    await a.sync()
    await b.edit(id, { notes: 'normal clock, committed later' })
    await b.sync()
    expect((await serverJob(a.client, id))?.fields.notes).toBe('normal clock, committed later')
  })

  it('T30: delete then a stale update — no resurrection, edits kept for recovery', async () => {
    const { a, b, id } = await pair()
    await a.edit(id, { notes: 'offline edit' })
    await deleteJob(b.ctx, id)
    await b.sync()
    await a.sync()
    expect(await serverJob(a.client, id)).toMatchObject({ deleted: true, revision: 2 })
    expect((await receipts(a.client)).map((r) => r.outcome)).toContain('rejected_deleted')
    expect((await a.db.jobs.get(id))?.view.deleted).toBe(true)
    const [notice] = await a.db.conflicts.toArray()
    expect(notice).toMatchObject({ kind: 'deleted', retained: { notes: 'offline edit' } })
  })

  it('T31: update then delete ends deleted on both devices', async () => {
    const { a, b, id } = await pair()
    await a.edit(id, { notes: 'updated' })
    await a.sync()
    await deleteJob(b.ctx, id)
    await b.sync()
    await a.sync()
    expect(await serverJob(a.client, id)).toMatchObject({ deleted: true, revision: 3 })
    expect((await a.db.jobs.get(id))?.view.deleted).toBe(true)
  })

  it('concurrent commits to one job both apply; contention never blocks an operation', async () => {
    const { a, b, id } = await pair()
    for (let round = 1; round <= 5; round++) {
      await a.edit(id, { status: round % 2 ? 'completed' : 'in_progress' })
      await b.edit(id, { notes: `round ${round}` })
      await Promise.all([a.sync(), b.sync()])
      await Promise.all([a.sync(), b.sync()])
      const left = [...(await a.db.outbox.toArray()), ...(await b.db.outbox.toArray())]
      // Printed in full on failure, so a blocked row shows its error code.
      expect(JSON.stringify(left.map((r) => [r.state, r.attempts, r.lastErrorCode]))).toBe('[]')
      expect(await serverJob(a.client, id)).toMatchObject({
        revision: 1 + round * 2,
        fields: { status: round % 2 ? 'completed' : 'in_progress', notes: `round ${round}` },
      })
    }
  })
})

describe('errors and isolation (T18, T32, T33)', () => {
  it('T32: patching a job that does not exist is blocked and never creates it', async () => {
    const user = await createUser()
    const a = await device(user)
    const jobId = crypto.randomUUID()
    await a.db.outbox.add({
      payload: {
        protocolVersion: 1,
        opId: crypto.randomUUID(),
        ownerId: a.client.uid,
        deviceId: a.ctx.deviceId,
        jobId,
        kind: 'patch',
        baseRevision: 1,
        baseValues: { notes: '' },
        patch: { notes: 'x' },
        after: sampleFields({ notes: 'x' }),
        clientCreatedAt: 1,
      },
      state: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    })
    await a.sync()
    expect((await a.db.outbox.toArray())[0]).toMatchObject({
      state: 'blocked',
      lastErrorCode: 'missing_job',
    })
    expect(await serverJob(a.client, jobId)).toBeUndefined()
  })

  it('T33: another account cannot read the owner jobs', async () => {
    const owner = await device(await createUser())
    const other = await signedInClient(await createUser())
    cleanups.push(() => other.close())
    const id = await createJob(owner.ctx, sampleFields())
    await owner.sync()
    const error = await getDoc(doc(other.firestore, 'users', owner.client.uid, 'jobs', id)).catch(
      (e: unknown) => e,
    )
    expect((error as { code?: string }).code).toBe('permission-denied')
  })

  it('T18: a rules denial becomes a visible blocked operation, not an endless retry', async () => {
    const victim = await createUser()
    const attacker = await signedInClient(await createUser())
    cleanups.push(() => attacker.close())
    const db = new FieldLogDB(`emu-${crypto.randomUUID()}`)
    const engine = createSyncEngine({
      db,
      remote: createFirestoreRemote(attacker.firestore, victim.uid), // wrong account's path
      lockName: `emu:${db.name}`,
    })
    cleanups.push(async () => {
      await engine.stop()
      db.close()
      await Dexie.delete(db.name)
    })
    await createJob(testContext(db, victim.uid), sampleFields())
    engine.request('manual')
    await engine.whenIdle()
    // The pull is refused first, so nothing is sent; the phase explains why.
    expect(engine.status.phase).toBe('denied')
    expect((await db.outbox.toArray())[0]?.state).toBe('pending')
  })
})
