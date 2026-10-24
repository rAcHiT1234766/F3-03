import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DB_VERSIONS, FieldLogDB, accountDbName, ensureDeviceId } from '../../src/db'
import {
  LocalSaveError,
  NotEditableError,
  ValidationError,
  buildExport,
  chooseConflictValue,
  createJob,
  deleteJob,
  editJob,
  resolveDeletedJob,
} from '../../src/jobs'
import { newDb, sampleFields, testContext } from './helpers'

const opened: FieldLogDB[] = []
function db(name?: string) {
  const d = newDb(name)
  opened.push(d)
  return d
}
afterEach(async () => {
  for (const d of opened.splice(0)) {
    d.close()
    await Dexie.delete(d.name)
  }
})

describe('local create (T01, T02, T40)', () => {
  it('T01: one save writes the job and its create operation together', async () => {
    const ctx = testContext(db())
    const id = await createJob(ctx, sampleFields())
    const job = await ctx.db.jobs.get(id)
    const rows = await ctx.db.outbox.toArray()
    expect(job).toMatchObject({ shadow: null, view: { deleted: false }, localVersion: 1 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      state: 'pending',
      attempts: 0,
      payload: { kind: 'create', jobId: id },
    })
    expect(rows[0]!.payload.after).toEqual(job!.view.fields)
    expect(ctx.syncRequests).toEqual(['local-save'])
  })

  it('T02: if the queue insert fails, the job is not stored either', async () => {
    const ctx = testContext(db())
    ctx.db.outbox.hook('creating', () => {
      throw new Error('simulated queue failure')
    })
    await expect(createJob(ctx, sampleFields())).rejects.toBeInstanceOf(LocalSaveError)
    expect(await ctx.db.jobs.count()).toBe(0)
    expect(await ctx.db.outbox.count()).toBe(0)
    expect(ctx.syncRequests).toEqual([]) // no sync request for a save that did not happen
  })

  it('T02: if the job insert fails, no queue entry is left behind', async () => {
    const ctx = testContext(db())
    ctx.db.jobs.hook('creating', () => {
      throw new Error('simulated job failure')
    })
    await expect(createJob(ctx, sampleFields())).rejects.toBeInstanceOf(LocalSaveError)
    expect(await ctx.db.outbox.count()).toBe(0)
  })

  it('T40: a quota error is reported as a failed save with a clear message', async () => {
    const ctx = testContext(db())
    ctx.db.outbox.hook('creating', () => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    const error = await createJob(ctx, sampleFields()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LocalSaveError)
    expect((error as Error).message).toMatch(/out of storage space/)
    expect(await ctx.db.jobs.count()).toBe(0)
  })

  it('rejects invalid input before touching storage', async () => {
    const ctx = testContext(db())
    const error = await createJob(ctx, sampleFields({ title: '   ' })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).errors.title).toBeDefined()
    expect(await ctx.db.jobs.count()).toBe(0)
  })
})

describe('local edit and delete (T03–T06)', () => {
  it('T03: an edit survives closing and reopening the database', async () => {
    const name = `test-${crypto.randomUUID()}`
    const first = db(name)
    const ctx = testContext(first)
    const id = await createJob(ctx, sampleFields())
    const base = (await first.jobs.get(id))!.view.fields
    expect(await editJob(ctx, id, base, { ...base, notes: 'Isolation valve replaced' })).toBe(
      'saved',
    )
    first.close()

    const reopened = db(name)
    const job = await reopened.jobs.get(id)
    expect(job?.view.fields.notes).toBe('Isolation valve replaced')
    expect(job?.localVersion).toBe(2)
    const ops = await reopened.outbox.toArray()
    expect(ops.map((r) => r.payload.kind)).toEqual(['create', 'patch'])
    expect(ops[1]!.payload.patch).toEqual({ notes: 'Isolation valve replaced' })
    expect(ops[1]!.payload.baseValues).toEqual({ notes: '' })
    expect(ops[0]!.sequence! < ops[1]!.sequence!).toBe(true)
  })

  it('T04: saving an unchanged form creates no operation', async () => {
    const ctx = testContext(db())
    const id = await createJob(ctx, sampleFields())
    const base = (await ctx.db.jobs.get(id))!.view.fields
    expect(await editJob(ctx, id, base, { ...base })).toBe('unchanged')
    expect(await editJob(ctx, id, base, { ...base, title: `  ${base.title} ` })).toBe('unchanged') // trims
    expect(await ctx.db.outbox.count()).toBe(1)
  })

  it('T05: a stale form only changes the fields it edited', async () => {
    const ctx = testContext(db())
    const id = await createJob(ctx, sampleFields())
    const opened = (await ctx.db.jobs.get(id))!.view.fields // form A opens
    await editJob(ctx, id, opened, { ...opened, status: 'in_progress' }) // another tab changes status
    await editJob(ctx, id, opened, { ...opened, title: 'Boiler inspection (2nd visit)' }) // form A saves title
    const job = await ctx.db.jobs.get(id)
    expect(job?.view.fields).toMatchObject({
      title: 'Boiler inspection (2nd visit)',
      status: 'in_progress',
    })
    const last = (await ctx.db.outbox.toArray()).at(-1)!
    expect(last.payload.patch).toEqual({ title: 'Boiler inspection (2nd visit)' })
    expect(last.payload.after.status).toBe('in_progress')
  })

  it('an edit that another tab already made is not queued twice', async () => {
    const ctx = testContext(db())
    const id = await createJob(ctx, sampleFields())
    const opened = (await ctx.db.jobs.get(id))!.view.fields
    await editJob(ctx, id, opened, { ...opened, notes: 'same' })
    expect(await editJob(ctx, id, opened, { ...opened, notes: 'same' })).toBe('unchanged')
    expect(await ctx.db.outbox.count()).toBe(2)
  })

  it('T06: delete hides the job but keeps it and the delete intent after reload', async () => {
    const name = `test-${crypto.randomUUID()}`
    const ctx = testContext(db(name))
    const id = await createJob(ctx, sampleFields())
    await deleteJob(ctx, id)
    ctx.db.close()
    const reopened = db(name)
    const job = await reopened.jobs.get(id)
    expect(job?.view.deleted).toBe(true)
    expect((await reopened.outbox.toArray()).map((r) => r.payload.kind)).toEqual([
      'create',
      'delete',
    ])
    await expect(
      editJob(testContext(reopened), id, job!.view.fields, sampleFields({ notes: 'x' })),
    ).rejects.toBeInstanceOf(NotEditableError)
  })
})

describe('conflict follow-up actions', () => {
  it('"Use this value" queues a new patch against the latest view and resolves the notice', async () => {
    const ctx = testContext(db())
    const id = await createJob(ctx, sampleFields({ notes: 'kept' }))
    await ctx.db.conflicts.put({
      id: 'op-1:notes',
      jobId: id,
      opId: 'op-1',
      kind: 'field',
      field: 'notes',
      base: '',
      incoming: 'kept',
      remote: 'mine',
      chosen: 'kept',
      retained: null,
      createdAt: 1,
      resolvedAt: null,
    })
    expect(await chooseConflictValue(ctx, 'op-1:notes', 'mine')).toBe('saved')
    const last = (await ctx.db.outbox.toArray()).at(-1)!
    expect(last.payload).toMatchObject({
      kind: 'patch',
      patch: { notes: 'mine' },
      baseValues: { notes: 'kept' },
    })
    expect((await ctx.db.conflicts.get('op-1:notes'))?.resolvedAt).not.toBeNull()
  })

  it('recovering a job deleted elsewhere creates a new job and drops the held edits', async () => {
    const ctx = testContext(db())
    const oldId = crypto.randomUUID()
    await ctx.db.outbox.add({
      payload: {
        protocolVersion: 1,
        opId: crypto.randomUUID(),
        ownerId: 'user-a',
        deviceId: 'device-a',
        jobId: oldId,
        kind: 'patch',
        baseRevision: 2,
        baseValues: { notes: '' },
        patch: { notes: 'later' },
        after: sampleFields({ notes: 'later' }),
        clientCreatedAt: 1,
      },
      state: 'blocked',
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: 'job_deleted',
      lastErrorMessage: null,
    })
    await ctx.db.conflicts.put({
      id: 'op-2:deleted',
      jobId: oldId,
      opId: 'op-2',
      kind: 'deleted',
      field: null,
      base: null,
      incoming: null,
      remote: null,
      chosen: null,
      retained: sampleFields({ notes: 'later' }),
      createdAt: 1,
      resolvedAt: null,
    })
    const newId = await resolveDeletedJob(ctx, 'op-2:deleted', 'recover')
    expect(newId).not.toBe(oldId)
    expect((await ctx.db.jobs.get(newId!))?.view.fields.notes).toBe('later')
    const rows = await ctx.db.outbox.toArray()
    expect(rows.map((r) => [r.payload.jobId, r.payload.kind])).toEqual([[newId, 'create']])
  })
})

describe('account-scoped storage', () => {
  it('names one database per project and UID', () => {
    expect(accountDbName('demo-fieldlog', 'uidA')).toBe('fieldlog:demo-fieldlog:uidA')
    expect(accountDbName('p', 'a/b c')).toBe('fieldlog:p:a_b_c')
    expect(accountDbName('p', 'A')).not.toBe(accountDbName('p', 'B'))
  })

  it('T33 (local): account B does not see account A data', async () => {
    const a = testContext(db(accountDbName('demo', `A-${crypto.randomUUID()}`)), 'A')
    const b = testContext(db(accountDbName('demo', `B-${crypto.randomUUID()}`)), 'B')
    await createJob(a, sampleFields())
    expect(await b.db.jobs.count()).toBe(0)
    expect(await b.db.outbox.count()).toBe(0)
  })

  it('keeps a durable device ID', async () => {
    const name = `test-${crypto.randomUUID()}`
    const first = await ensureDeviceId(db(name))
    expect(await ensureDeviceId(db(name))).toBe(first)
  })

  it('exports local data without token-like metadata', async () => {
    const ctx = testContext(db())
    await createJob(ctx, sampleFields())
    await ctx.db.meta.put({ key: 'pushToken', value: 'secret' })
    const data = (await buildExport(ctx, 'demo')) as {
      jobs: unknown[]
      outbox: unknown[]
      meta: { key: string }[]
    }
    expect(data.jobs).toHaveLength(1)
    expect(data.outbox).toHaveLength(1)
    expect(data.meta.map((m) => m.key)).not.toContain('pushToken')
  })
})

describe('T39: schema migration keeps queued work', () => {
  it('upgrading a fixture database preserves payloads, order and account scope', async () => {
    const name = accountDbName('demo', `migrate-${crypto.randomUUID()}`)
    const v1 = db(name)
    const ctx = testContext(v1, 'owner-1')
    const id = await createJob(ctx, sampleFields())
    const base = (await v1.jobs.get(id))!.view.fields
    await editJob(ctx, id, base, { ...base, notes: 'queued before upgrade' })
    const before = await v1.outbox.toArray()
    v1.close()

    // A fixture v2 that adds an index and back-fills a field, the way a real migration would.
    class FixtureV2 extends Dexie {
      constructor() {
        super(name)
        for (const v of DB_VERSIONS) this.version(v.version).stores(v.stores)
        this.version(DB_VERSIONS.at(-1)!.version + 1)
          .stores({ conflicts: 'id, jobId, opId, resolvedAt' })
          .upgrade((tx) => tx.table('conflicts').toCollection().modify({ resolvedAt: null }))
      }
    }
    const v2 = new FixtureV2()
    const after = await v2.table('outbox').toArray()
    expect(after).toEqual(before)
    expect(
      after.every((r: { payload: { ownerId: string } }) => r.payload.ownerId === 'owner-1'),
    ).toBe(true)
    expect(v2.verno).toBe(DB_VERSIONS.at(-1)!.version + 1)
    v2.close()
  })
})
