import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import type { FieldLogDB } from '../../src/db'
import type { OperationPayload } from '../../src/domain'
import { createJob, deleteJob, editJob, resolveDeletedJob } from '../../src/jobs'
import { createSyncEngine, retryDelay, type SyncEngine } from '../../src/sync/engine'
import { acknowledgeReceipt, applyRemoteSnapshots } from '../../src/sync/local'
import { FakeServer, deferred, fakeRemote, newDb, sampleFields, testContext } from './helpers'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

type DeviceOptions = {
  server: FakeServer
  dbName?: string
  deviceId?: string
  uid?: string
  isCurrent?: () => boolean
}

/** One "device" (or tab): its own Dexie connection, remote adapter and engine. */
function device({
  server,
  dbName = `test-${crypto.randomUUID()}`,
  deviceId = 'device-a',
  uid = 'user-a',
  isCurrent,
}: DeviceOptions) {
  const db = newDb(dbName)
  const ctx = testContext(db, uid, deviceId)
  const { remote, control } = fakeRemote(server, uid)
  const clock = { now: 50_000 }
  const engine = createSyncEngine({
    db,
    remote,
    lockName: `sync:${dbName}`,
    now: () => clock.now,
    random: () => 0.5,
    onlineHint: () => true,
    isCurrent,
  })
  cleanup.push(async () => {
    await engine.stop()
    db.close()
    await Dexie.delete(dbName)
  })
  return { db, ctx, control, engine, clock, dbName }
}

async function sync(engine: SyncEngine, reason = 'manual') {
  engine.request(reason)
  await engine.whenIdle()
}

const fieldsOf = async (db: FieldLogDB, id: string) => (await db.jobs.get(id))!.view.fields

describe('first round trip (T07–T10)', () => {
  it('T07: a queued create reaches the server, gets a receipt and leaves the queue', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const id = await createJob(a.ctx, sampleFields())
    await sync(a.engine)
    expect(server.jobs.get(id)).toMatchObject({ revision: 1, deleted: false })
    expect(server.receipts.size).toBe(1)
    expect(await a.db.outbox.count()).toBe(0)
    expect((await a.db.jobs.get(id))?.shadow?.revision).toBe(1)
    expect(a.engine.status.phase).toBe('idle')
    expect((await a.db.meta.get('lastSuccessfulPullAt'))?.value).toBe(a.clock.now)
  })

  it('T08: delivering the same operation twice has one canonical effect', async () => {
    const server = new FakeServer()
    const a = device({ server })
    await createJob(a.ctx, sampleFields())
    const [row] = await a.db.outbox.toArray()
    const first = server.apply(row!.payload)
    const second = server.apply(row!.payload)
    expect(second).toEqual(first)
    expect(server.mutations).toBe(1)
    expect(server.receipts.size).toBe(1)
    // and a duplicate local acknowledgement is harmless
    expect(await acknowledgeReceipt(a.db, first, 1)).toBe('acknowledged')
    expect(await acknowledgeReceipt(a.db, first, 1)).toBe('duplicate')
  })

  it('T09: a lost response is resolved by retrying the same opId', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const id = await createJob(a.ctx, sampleFields())
    const [original] = await a.db.outbox.toArray()
    a.control.faults.push('lost-response')
    await sync(a.engine)
    const [waiting] = await a.db.outbox.toArray()
    expect(waiting).toMatchObject({
      state: 'retry_wait',
      attempts: 1,
      lastErrorCode: 'unavailable',
    })
    expect(waiting!.payload).toEqual(original!.payload)
    expect(server.mutations).toBe(1) // it did commit

    a.clock.now += retryDelay(1, () => 0.5)
    await sync(a.engine, 'retry')
    expect(a.control.calls).toEqual([original!.payload.opId, original!.payload.opId])
    expect(server.mutations).toBe(1)
    expect(server.jobs.get(id)?.revision).toBe(1)
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('T10: reusing an opId for a different change is a blocked protocol error', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const id = await createJob(a.ctx, sampleFields())
    const [row] = await a.db.outbox.toArray()
    await sync(a.engine)
    const forged: OperationPayload = {
      ...row!.payload,
      kind: 'patch',
      patch: { notes: 'forged' },
      baseValues: { notes: '' },
      after: { ...row!.payload.after, notes: 'forged' },
    }
    await a.db.outbox.add({
      payload: forged,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    })
    await sync(a.engine)
    expect((await a.db.outbox.toArray())[0]).toMatchObject({
      state: 'blocked',
      lastErrorCode: 'receipt_mismatch',
    })
    expect(server.jobs.get(id)?.fields.notes).toBe('')
    expect(server.mutations).toBe(1)
  })
})

describe('acknowledgement safety (T11, T12, T13, T24)', () => {
  it('T11: an edit saved while a request is in flight survives that acknowledgement', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const id = await createJob(a.ctx, sampleFields())
    await sync(a.engine)
    const base = await fieldsOf(a.db, id)
    await editJob(a.ctx, id, base, { ...base, status: 'completed' }) // operation A

    const gate = deferred()
    a.control.afterCommit = async () => {
      a.control.afterCommit = null
      const latest = await fieldsOf(a.db, id)
      await editJob(a.ctx, id, latest, { ...latest, notes: 'Added while syncing' }) // operation B
      await gate.promise
    }
    a.engine.request('manual')
    await new Promise((r) => setTimeout(r, 20))
    gate.resolve()
    await a.engine.whenIdle()

    // B was saved during A's request. A's receipt removed only A; B is still visible and queued
    // unless the same cycle already delivered it.
    const fields = await fieldsOf(a.db, id)
    expect(fields).toMatchObject({ status: 'completed', notes: 'Added while syncing' })
    await sync(a.engine)
    expect(server.jobs.get(id)?.fields).toMatchObject({
      status: 'completed',
      notes: 'Added while syncing',
    })
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('T11 (strict): acknowledging A while B is still queued keeps B visible and pending', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const id = await createJob(a.ctx, sampleFields())
    await sync(a.engine)
    const base = await fieldsOf(a.db, id)
    await editJob(a.ctx, id, base, { ...base, status: 'completed' })
    const [opA] = await a.db.outbox.toArray()
    const receiptA = server.apply(opA!.payload) // committed remotely, not yet acknowledged
    const latest = await fieldsOf(a.db, id)
    await editJob(a.ctx, id, latest, { ...latest, notes: 'B' })
    await acknowledgeReceipt(a.db, receiptA, 1)
    const job = await a.db.jobs.get(id)
    expect(job?.shadow?.revision).toBe(2)
    expect(job?.view.fields).toMatchObject({ status: 'completed', notes: 'B' })
    const rows = await a.db.outbox.toArray()
    expect(rows.map((r) => r.payload.patch)).toEqual([{ notes: 'B' }])
  })

  it('T12: a failed local acknowledgement stays recoverable without a second effect', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const id = await createJob(a.ctx, sampleFields())
    let failOnce = true
    a.db.outbox.hook('deleting', () => {
      if (failOnce) {
        failOnce = false
        throw new Error('simulated local write failure')
      }
    })
    await sync(a.engine)
    expect(server.mutations).toBe(1)
    expect((await a.db.outbox.toArray())[0]).toMatchObject({
      state: 'retry_wait',
      lastErrorCode: 'local_ack_failed',
    })
    await sync(a.engine)
    expect(server.mutations).toBe(1)
    expect(await a.db.outbox.count()).toBe(0)
    expect((await a.db.jobs.get(id))?.shadow?.revision).toBe(1)
  })

  it('T13: a row left "sending" by a crash is retried safely with the same opId', async () => {
    const server = new FakeServer()
    const dbName = `test-${crypto.randomUUID()}`
    const crashed = device({ server, dbName })
    const id = await createJob(crashed.ctx, sampleFields())
    const [row] = await crashed.db.outbox.toArray()
    server.apply(row!.payload) // the request reached the server before the tab died
    await crashed.db.outbox.update(row!.sequence!, { state: 'sending', attempts: 1 })

    const reopened = device({ server, dbName }) // next start, same database
    await sync(reopened.engine, 'sign-in')
    expect(reopened.control.calls).toEqual([row!.payload.opId])
    expect(server.mutations).toBe(1)
    expect(await reopened.db.outbox.count()).toBe(0)
    expect((await reopened.db.jobs.get(id))?.shadow?.revision).toBe(1)
  })

  it('T24: a late receipt for revision 5 cannot roll back a pulled revision 6', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const id = await createJob(a.ctx, sampleFields())
    await sync(a.engine)
    for (const notes of ['r2', 'r3', 'r4']) {
      const f = await fieldsOf(a.db, id)
      await editJob(a.ctx, id, f, { ...f, notes })
      await sync(a.engine)
    }
    const f = await fieldsOf(a.db, id)
    await editJob(a.ctx, id, f, { ...f, notes: 'r5 (mine)' })
    const [mine] = await a.db.outbox.toArray()
    const receipt5 = server.apply(mine!.payload)
    const other = device({ server, deviceId: 'device-b' })
    await sync(other.engine)
    const of = await fieldsOf(other.db, id)
    await editJob(other.ctx, id, of, { ...of, status: 'completed' })
    await sync(other.engine) // server is now at revision 6

    await applyRemoteSnapshots(a.db, [server.jobs.get(id)!], 2) // pull sees 6 first
    expect((await a.db.jobs.get(id))?.shadow?.revision).toBe(6)
    await acknowledgeReceipt(a.db, receipt5, 3) // then the older receipt arrives
    const job = await a.db.jobs.get(id)
    expect(job?.shadow?.revision).toBe(6)
    expect(job?.view.fields).toMatchObject({ notes: 'r5 (mine)', status: 'completed' })
    expect(await a.db.outbox.count()).toBe(0)
  })
})

describe('queue order, retries and failures (T14–T19)', () => {
  it('T14: create, patch, patch, delete for one job are sent in order', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const id = await createJob(a.ctx, sampleFields())
    let f = await fieldsOf(a.db, id)
    await editJob(a.ctx, id, f, { ...f, status: 'in_progress' })
    f = await fieldsOf(a.db, id)
    await editJob(a.ctx, id, f, { ...f, notes: 'Parts ordered' })
    await deleteJob(a.ctx, id)
    const ops = (await a.db.outbox.toArray()).map((r) => r.payload.opId)
    await sync(a.engine)
    expect(a.control.calls).toEqual(ops)
    expect(server.jobs.get(id)).toMatchObject({ deleted: true, revision: 4 })
    expect(server.jobs.get(id)?.fields).toMatchObject({
      status: 'in_progress',
      notes: 'Parts ordered',
    })
    expect((await a.db.jobs.get(id))?.view.deleted).toBe(true)
  })

  it('T15: a blocked operation holds later edits to the same job, other jobs continue', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const x = await createJob(a.ctx, sampleFields({ title: 'X' }))
    await sync(a.engine)
    let f = await fieldsOf(a.db, x)
    await editJob(a.ctx, x, f, { ...f, notes: 'first' })
    f = await fieldsOf(a.db, x)
    await editJob(a.ctx, x, f, { ...f, notes: 'second' })
    const y = await createJob(a.ctx, sampleFields({ title: 'Y' }))
    const [p1, p2] = (await a.db.outbox.toArray()).map((r) => r.payload.opId)

    a.control.faults.push('permission-denied')
    await sync(a.engine)
    expect(a.control.calls).toContain(p1)
    expect(a.control.calls).not.toContain(p2)
    expect(server.jobs.has(y)).toBe(true)
    const rows = await a.db.outbox.toArray()
    expect(rows.map((r) => [r.payload.opId, r.state])).toEqual([
      [p1, 'blocked'],
      [p2, 'pending'],
    ])
  })

  it('T16: repeated outages back off with persisted, bounded delays and no busy loop', async () => {
    const server = new FakeServer()
    const a = device({ server })
    await createJob(a.ctx, sampleFields())
    const [original] = await a.db.outbox.toArray()
    a.control.faults.push('unavailable', 'unavailable', 'unavailable')
    await sync(a.engine)
    let [row] = await a.db.outbox.toArray()
    expect(row).toMatchObject({
      state: 'retry_wait',
      attempts: 1,
      nextAttemptAt: a.clock.now + 2000,
    })
    expect(a.engine.status.phase).toBe('unreachable')

    await sync(a.engine, 'timer') // not due yet: nothing is sent
    expect(a.control.calls).toHaveLength(1)

    a.clock.now += 2000
    await sync(a.engine, 'retry')
    ;[row] = await a.db.outbox.toArray()
    expect(row).toMatchObject({ attempts: 2, nextAttemptAt: a.clock.now + 4000 })
    expect(row!.payload).toEqual(original!.payload)
    expect([1, 2, 3, 4, 5, 6, 7, 10].map((n) => retryDelay(n, () => 0.5))).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000,
    ])
    expect(retryDelay(3, () => 0)).toBe(6400)
    expect(retryDelay(3, () => 1)).toBe(9600)
  })

  it('T17: manual retry clears the delay once and resends the same payload', async () => {
    const server = new FakeServer()
    const a = device({ server })
    await createJob(a.ctx, sampleFields())
    const [original] = await a.db.outbox.toArray()
    a.control.faults.push('unavailable')
    await sync(a.engine)
    await a.engine.retryNow()
    a.engine.request('manual')
    a.engine.request('manual') // coalesced
    await a.engine.whenIdle()
    expect(a.control.calls).toEqual([original!.payload.opId, original!.payload.opId])
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('T18: a permission denial is shown as blocked and not retried automatically', async () => {
    const server = new FakeServer()
    const a = device({ server })
    await createJob(a.ctx, sampleFields())
    a.control.faults.push('permission-denied')
    await sync(a.engine)
    a.clock.now += 120_000
    await sync(a.engine, 'timer')
    expect(a.control.calls).toHaveLength(1)
    expect((await a.db.outbox.toArray())[0]).toMatchObject({
      state: 'blocked',
      lastErrorCode: 'permission-denied',
    })
  })

  it('T19: expired auth pauses delivery, local editing continues, sign-in resumes', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const id = await createJob(a.ctx, sampleFields())
    a.control.faults.push('unauthenticated')
    await sync(a.engine)
    expect(a.engine.status.phase).toBe('auth_required')
    const f = await fieldsOf(a.db, id)
    expect(await editJob(a.ctx, id, f, { ...f, notes: 'offline edit' })).toBe('saved')
    await sync(a.engine, 'timer') // automatic triggers are ignored while paused
    expect(a.control.calls).toHaveLength(1)
    await sync(a.engine, 'sign-in')
    expect(server.jobs.get(id)?.fields.notes).toBe('offline edit')
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('pull failures pause the cycle before any push', async () => {
    const server = new FakeServer()
    const a = device({ server })
    await createJob(a.ctx, sampleFields())
    a.control.pullFaults.push('unavailable')
    await sync(a.engine)
    expect(a.control.calls).toHaveLength(0)
    expect((await a.db.outbox.toArray())[0]?.state).toBe('pending')
  })

  it('reports unsupported when Web Locks are unavailable and does not sync', async () => {
    const db = newDb()
    const { remote, control } = fakeRemote(new FakeServer(), 'user-a')
    const engine = createSyncEngine({ db, remote, lockName: 'x', locks: null })
    await createJob(testContext(db), sampleFields())
    engine.request('manual')
    await engine.whenIdle()
    expect(engine.status.phase).toBe('unsupported')
    expect(control.calls).toHaveLength(0)
    db.close()
  })
})

describe('tabs, devices and reconciliation (T20, T22, T23, T27, T28, T30, T31, T34, T48)', () => {
  it('T20: two tabs on one database coordinate through one lock without duplicate sends', async () => {
    const server = new FakeServer()
    const dbName = `test-${crypto.randomUUID()}`
    const tab1 = device({ server, dbName })
    const tab2 = device({ server, dbName })
    for (const title of ['One', 'Two', 'Three']) await createJob(tab1.ctx, sampleFields({ title }))
    tab1.engine.request('manual')
    tab2.engine.request('manual')
    await Promise.all([tab1.engine.whenIdle(), tab2.engine.whenIdle()])
    expect(server.mutations).toBe(3)
    expect([...tab1.control.calls, ...tab2.control.calls]).toHaveLength(3)
    expect(await tab2.db.outbox.count()).toBe(0)
  })

  it('T22/T23: a pull brings remote changes and keeps unsent local edits', async () => {
    const server = new FakeServer()
    const a = device({ server, deviceId: 'A' })
    const b = device({ server, deviceId: 'B' })
    const id = await createJob(b.ctx, sampleFields())
    await sync(b.engine)
    await sync(a.engine)
    expect(await fieldsOf(a.db, id)).toEqual(server.jobs.get(id)!.fields) // T22

    const fa = await fieldsOf(a.db, id)
    await editJob(a.ctx, id, fa, { ...fa, title: 'Local title' }) // queued on A
    const fb = await fieldsOf(b.db, id)
    await editJob(b.ctx, id, fb, { ...fb, status: 'completed' })
    await sync(b.engine)

    await applyRemoteSnapshots(a.db, [server.jobs.get(id)!], 1) // reconcile only, no push
    expect(await fieldsOf(a.db, id)).toMatchObject({ title: 'Local title', status: 'completed' })
    expect(await a.db.outbox.count()).toBe(1)
    await sync(a.engine)
    expect(server.jobs.get(id)?.fields).toMatchObject({ title: 'Local title', status: 'completed' })
  })

  it('a pull never deletes local jobs that are missing from the read', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const id = await createJob(a.ctx, sampleFields())
    await applyRemoteSnapshots(a.db, [], 1)
    expect(await a.db.jobs.get(id)).toBeDefined()
  })

  it('T27: concurrent same-field edits converge and leave a conflict notice', async () => {
    const server = new FakeServer()
    const a = device({ server, deviceId: 'A' })
    const b = device({ server, deviceId: 'B' })
    const id = await createJob(a.ctx, sampleFields())
    await sync(a.engine)
    await sync(b.engine)
    const fa = await fieldsOf(a.db, id)
    const fb = await fieldsOf(b.db, id)
    await editJob(a.ctx, id, fa, { ...fa, notes: 'A says replace pump' })
    await editJob(b.ctx, id, fb, { ...fb, notes: 'B says repair pump' })
    await sync(a.engine)
    await sync(b.engine)
    await sync(a.engine)
    expect(server.jobs.get(id)?.fields.notes).toBe('B says repair pump')
    expect((await fieldsOf(a.db, id)).notes).toBe('B says repair pump')
    const notices = await b.db.conflicts.toArray()
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      kind: 'field',
      field: 'notes',
      incoming: 'B says repair pump',
      remote: 'A says replace pump',
      chosen: 'B says repair pump',
    })
  })

  it('T28: identical concurrent edits produce no conflict notice and one revision', async () => {
    const server = new FakeServer()
    const a = device({ server, deviceId: 'A' })
    const b = device({ server, deviceId: 'B' })
    const id = await createJob(a.ctx, sampleFields())
    await sync(a.engine)
    await sync(b.engine)
    for (const d of [a, b]) {
      const f = await fieldsOf(d.db, id)
      await editJob(d.ctx, id, f, { ...f, status: 'completed' })
    }
    await sync(a.engine)
    await sync(b.engine)
    expect(server.jobs.get(id)?.revision).toBe(2)
    expect(await b.db.conflicts.count()).toBe(0)
  })

  it('T30: a stale offline edit after a remote delete is preserved for recovery, not resurrected', async () => {
    const server = new FakeServer()
    const a = device({ server, deviceId: 'A' })
    const b = device({ server, deviceId: 'B' })
    const id = await createJob(a.ctx, sampleFields())
    await sync(a.engine)
    await sync(b.engine)
    let f = await fieldsOf(a.db, id)
    await editJob(a.ctx, id, f, { ...f, notes: 'offline 1' })
    f = await fieldsOf(a.db, id)
    await editJob(a.ctx, id, f, { ...f, status: 'completed' })
    await deleteJob(b.ctx, id)
    await sync(b.engine)

    await sync(a.engine)
    expect(server.jobs.get(id)).toMatchObject({ deleted: true, revision: 2 })
    const job = await a.db.jobs.get(id)
    expect(job?.view.deleted).toBe(true)
    const [notice] = await a.db.conflicts.toArray()
    expect(notice).toMatchObject({ kind: 'deleted', jobId: id })
    expect(notice!.retained).toMatchObject({ notes: 'offline 1', status: 'completed' })
    expect((await a.db.outbox.toArray()).map((r) => [r.state, r.lastErrorCode])).toEqual([
      ['blocked', 'job_deleted'],
    ])

    const replacement = await resolveDeletedJob(a.ctx, notice!.id, 'recover')
    await sync(a.engine)
    expect(server.jobs.get(replacement!)?.fields).toMatchObject({
      notes: 'offline 1',
      status: 'completed',
    })
    expect(server.jobs.get(id)?.deleted).toBe(true)
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('T31: update then delete ends deleted', async () => {
    const server = new FakeServer()
    const a = device({ server, deviceId: 'A' })
    const b = device({ server, deviceId: 'B' })
    const id = await createJob(a.ctx, sampleFields())
    await sync(a.engine)
    await sync(b.engine)
    const f = await fieldsOf(a.db, id)
    await editJob(a.ctx, id, f, { ...f, notes: 'updated' })
    await sync(a.engine)
    await deleteJob(b.ctx, id)
    await sync(b.engine)
    await sync(a.engine)
    expect(server.jobs.get(id)).toMatchObject({ deleted: true })
    expect((await a.db.jobs.get(id))?.view.deleted).toBe(true)
  })

  it('T34: a late response for account A cannot touch account B', async () => {
    const server = new FakeServer()
    let generation = 1
    const a = device({ server, uid: 'user-a', isCurrent: () => generation === 1 })
    const first = await createJob(a.ctx, sampleFields({ title: 'A1' }))
    await createJob(a.ctx, sampleFields({ title: 'A2' }))
    const gate = deferred()
    a.control.beforeApply = async () => {
      a.control.beforeApply = null
      await gate.promise
    }
    a.engine.request('manual')
    await new Promise((r) => setTimeout(r, 20))

    generation = 2 // account switch while A's request is pending
    const b = device({ server, uid: 'user-b', deviceId: 'device-b' })
    await sync(b.engine)
    gate.resolve()
    await a.engine.whenIdle()

    expect(await b.db.jobs.count()).toBe(0)
    expect(await b.db.outbox.count()).toBe(0)
    // A's in-flight operation settled into A's own database; no new A work started after the switch.
    expect(a.control.calls).toHaveLength(1)
    expect((await a.db.jobs.get(first))?.shadow?.revision).toBe(1)
    expect(await a.db.outbox.count()).toBe(1)
  })

  it('T48: under network flapping, every change applies exactly once and the queue drains', async () => {
    const server = new FakeServer()
    const a = device({ server })
    const ids: string[] = []
    for (let i = 0; i < 6; i++)
      ids.push(await createJob(a.ctx, sampleFields({ title: `Job ${i}` })))
    for (const [i, id] of ids.entries()) {
      for (const step of [1, 2]) {
        const f = await fieldsOf(a.db, id)
        await editJob(a.ctx, id, f, { ...f, notes: `job ${i} step ${step}` })
      }
    }
    const total = await a.db.outbox.count()
    let seed = 3
    const coin = () => ((seed = (seed * 16807) % 2147483647) % 10) / 10
    a.control.beforeApply = async () => {
      const r = coin()
      if (r < 0.2) a.control.faults.unshift('unavailable')
      else if (r < 0.4) a.control.faults.unshift('lost-response')
    }
    for (let round = 0; round < 200 && (await a.db.outbox.count()) > 0; round++) {
      if (coin() < 0.3) a.control.pullFaults.push('unavailable')
      a.clock.now += 61_000
      await sync(a.engine, 'retry')
    }
    expect(await a.db.outbox.count()).toBe(0)
    expect(server.mutations).toBe(total)
    expect(server.receipts.size).toBe(total)
    for (const [i, id] of ids.entries()) {
      expect(server.jobs.get(id)?.fields.notes).toBe(`job ${i} step 2`)
      expect(await fieldsOf(a.db, id)).toEqual(server.jobs.get(id)!.fields)
    }
  })
})
