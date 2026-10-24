import { describe, expect, it } from 'vitest'
import {
  FIELD_KEYS,
  type JobFields,
  type JobSnapshot,
  type OperationPayload,
} from '../../src/domain'
import {
  applyLocal,
  isNewerShadow,
  rebuildView,
  resolveOperation,
  type ConflictPolicy,
} from '../../src/sync/merge'
import { FakeServer, sampleFields } from './helpers'

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const JOB = '99999999-9999-4999-8999-999999999999'

function op(
  kind: OperationPayload['kind'],
  start: JobFields,
  changes: Partial<JobFields> = {},
  extra: Partial<OperationPayload> = {},
): OperationPayload {
  const baseValues: Partial<JobFields> = {}
  for (const k of Object.keys(changes) as (keyof JobFields)[]) {
    ;(baseValues as Record<string, unknown>)[k] = start[k]
  }
  return {
    protocolVersion: 1,
    opId: uuid(),
    ownerId: 'user-a',
    deviceId: 'device-a',
    jobId: JOB,
    kind,
    baseRevision: 1,
    baseValues: kind === 'patch' ? baseValues : {},
    patch: kind === 'patch' ? changes : {},
    after: { ...start, ...changes },
    clientCreatedAt: Date.now(),
    ...extra,
  }
}

/** Runs operations through the in-memory server in the given arrival order. */
function serverWith(policy: ConflictPolicy, start: JobFields) {
  const server = new FakeServer(policy)
  server.apply(op('create', start))
  return server
}

const start = sampleFields({ title: 'Boiler inspection', status: 'scheduled', notes: '' })

describe('field-level merge (final policy)', () => {
  it.each([
    ['A then B', false],
    ['B then A', true],
  ])('keeps both disjoint edits regardless of arrival order (%s)', (_label, reverse) => {
    const server = serverWith('field-merge', start)
    const a = op('patch', start, { status: 'completed' }, { deviceId: 'A' })
    const b = op('patch', start, { notes: 'Pressure OK' }, { deviceId: 'B' })
    const [first, second] = reverse ? [b, a] : [a, b]
    server.apply(first)
    const receipt = server.apply(second)
    expect(receipt.result.fields.status).toBe('completed')
    expect(receipt.result.fields.notes).toBe('Pressure OK')
    expect(receipt.conflicts).toEqual([])
    expect(receipt.result.revision).toBe(3)
  })

  it.each([
    ['A then B', false, 'B notes'],
    ['B then A', true, 'A notes'],
  ])('same field: last server commit wins and records a conflict (%s)', (_l, reverse, winner) => {
    const server = serverWith('field-merge', start)
    const a = op('patch', start, { notes: 'A notes' })
    const b = op('patch', start, { notes: 'B notes' })
    const [first, second] = reverse ? [b, a] : [a, b]
    server.apply(first)
    const receipt = server.apply(second)
    expect(receipt.result.fields.notes).toBe(winner)
    expect(receipt.conflicts).toEqual([
      {
        field: 'notes',
        base: '',
        incoming: winner,
        remote: winner === 'A notes' ? 'B notes' : 'A notes',
        chosen: winner,
      },
    ])
  })

  it('identical concurrent changes are not a conflict and do not bump the revision', () => {
    const server = serverWith('field-merge', start)
    server.apply(op('patch', start, { status: 'completed' }))
    const receipt = server.apply(op('patch', start, { status: 'completed' }))
    expect(receipt.outcome).toBe('noop')
    expect(receipt.conflicts).toEqual([])
    expect(receipt.result.revision).toBe(2)
  })

  it('distinguishes an omitted field from an explicit null or empty value', () => {
    const withDate = sampleFields({ dueDate: '2026-12-01', notes: 'old' })
    const current = { fields: withDate, deleted: false }
    const omitted = resolveOperation(current, op('patch', withDate, { title: 'T2' }), 'field-merge')
    const nulled = resolveOperation(
      current,
      op('patch', withDate, { dueDate: null }),
      'field-merge',
    )
    const emptied = resolveOperation(current, op('patch', withDate, { notes: '' }), 'field-merge')
    expect(omitted.ok && omitted.fields.dueDate).toBe('2026-12-01')
    expect(nulled.ok && nulled.fields.dueDate).toBeNull()
    expect(emptied.ok && emptied.fields.notes).toBe('')
  })

  it('a value changed and changed back elsewhere looks unchanged (documented limitation)', () => {
    const server = serverWith('field-merge', start)
    const a1 = op('patch', start, { title: 'Temp' })
    server.apply(a1)
    server.apply(op('patch', a1.after, { title: start.title }))
    const receipt = server.apply(op('patch', start, { title: 'Mine' }))
    expect(receipt.conflicts).toEqual([]) // remote equals base again, so no conflict is detected
    expect(receipt.result.fields.title).toBe('Mine')
  })

  it('sequential edits from one device apply in order', () => {
    const server = serverWith('field-merge', start)
    const p1 = op('patch', start, { notes: 'one' })
    const p2 = op('patch', p1.after, { notes: 'one two' })
    server.apply(p1)
    const receipt = server.apply(p2)
    expect(receipt.conflicts).toEqual([])
    expect(receipt.result.fields.notes).toBe('one two')
  })

  it('a clock-skewed client cannot win through a future timestamp', () => {
    const server = serverWith('field-merge', start)
    const future = op(
      'patch',
      start,
      { notes: 'from the future' },
      { clientCreatedAt: Date.now() + 365 * 864e5 },
    )
    const later = op('patch', start, { notes: 'committed last' }, { clientCreatedAt: 0 })
    server.apply(future)
    expect(server.apply(later).result.fields.notes).toBe('committed last')
  })

  it('never merges protocol metadata through patches', () => {
    const malicious = op('patch', start, { title: 'x' })
    ;(malicious.patch as Record<string, unknown>).revision = 99
    const r = resolveOperation({ fields: start, deleted: false }, malicious, 'field-merge')
    expect(r.ok && 'revision' in r.fields).toBe(false) // validation rejects this before sending
  })
})

describe('record-level LWW (staged baseline)', () => {
  it('a stale full snapshot overwrites an unrelated concurrent change (known weakness)', () => {
    const server = serverWith('record-lww', start)
    server.apply(op('patch', start, { status: 'completed' })) // device A
    const receipt = server.apply(op('patch', start, { title: 'Boiler inspection — urgent' })) // B, stale
    expect(receipt.result.fields.title).toBe('Boiler inspection — urgent')
    expect(receipt.result.fields.status).toBe('scheduled') // A's change was lost
  })

  it('field merge keeps the same two changes', () => {
    const server = serverWith('field-merge', start)
    server.apply(op('patch', start, { status: 'completed' }))
    const receipt = server.apply(op('patch', start, { title: 'Boiler inspection — urgent' }))
    expect(receipt.result.fields).toMatchObject({
      title: 'Boiler inspection — urgent',
      status: 'completed',
    })
  })
})

describe('deletion is terminal', () => {
  it('update after delete is rejected and cannot resurrect the job', () => {
    const server = serverWith('field-merge', start)
    server.apply(op('delete', start))
    const receipt = server.apply(op('patch', start, { notes: 'stale edit' }))
    expect(receipt.outcome).toBe('rejected_deleted')
    expect(receipt.result.deleted).toBe(true)
    expect(receipt.result.fields.notes).toBe('')
    expect(server.mutations).toBe(2)
  })

  it('delete after update marks the updated job deleted', () => {
    const server = serverWith('field-merge', start)
    server.apply(op('patch', start, { notes: 'done' }))
    const receipt = server.apply(op('delete', start))
    expect(receipt.result).toMatchObject({ deleted: true, revision: 3 })
    expect(receipt.result.fields.notes).toBe('done')
  })

  it('a repeated delete is a noop referencing the tombstone', () => {
    const server = serverWith('field-merge', start)
    server.apply(op('delete', start))
    const receipt = server.apply(op('delete', start))
    expect(receipt.outcome).toBe('noop')
    expect(receipt.result.revision).toBe(2)
  })

  it('create with a tombstoned or existing ID is blocked, patch of a missing job too', () => {
    const tomb = resolveOperation(
      { fields: start, deleted: true },
      op('create', start),
      'field-merge',
    )
    const exists = resolveOperation(
      { fields: start, deleted: false },
      op('create', start),
      'field-merge',
    )
    const missing = resolveOperation(null, op('patch', start, { title: 'x' }), 'field-merge')
    const missingDelete = resolveOperation(null, op('delete', start), 'field-merge')
    expect([tomb, exists, missing, missingDelete].map((r) => !r.ok && r.code)).toEqual([
      'job_deleted',
      'job_exists',
      'missing_job',
      'missing_job',
    ])
  })
})

describe('properties of the resolver', () => {
  const values: Partial<Record<keyof JobFields, unknown[]>> = {
    title: ['A', 'B', 'C'],
    notes: ['', 'x', 'y'],
    status: ['scheduled', 'in_progress', 'completed'],
    dueDate: [null, '2026-01-01', '2027-02-02'],
  }
  let seed = 7
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!

  it('keeps unrelated fields, does not mutate inputs and changes revision only on change', () => {
    for (let i = 0; i < 300; i++) {
      const remote = sampleFields()
      const base = sampleFields()
      const changes: Partial<JobFields> = {}
      for (const key of Object.keys(values) as (keyof JobFields)[]) {
        if (rand() < 0.5) (remote as Record<string, unknown>)[key] = pick(values[key]!)
        if (rand() < 0.5) (base as Record<string, unknown>)[key] = pick(values[key]!)
        if (rand() < 0.4) (changes as Record<string, unknown>)[key] = pick(values[key]!)
      }
      const operation = op('patch', base, changes)
      if (Object.keys(changes).length === 0) continue
      const current = { fields: { ...remote }, deleted: false }
      const frozen = JSON.stringify([current, operation])
      const r = resolveOperation(current, operation, 'field-merge')
      expect(JSON.stringify([current, operation])).toBe(frozen)
      if (!r.ok) throw new Error('unexpected failure')
      const unrelated = FIELD_KEYS.filter((k) => !(k in changes))
      expect(unrelated.map((k) => r.fields[k])).toEqual(unrelated.map((k) => remote[k]))
      expect(r.changed).toBe(FIELD_KEYS.some((k) => r.fields[k] !== remote[k]))
      expect(r.outcome).toBe(r.changed ? 'applied' : 'noop')
    }
  })

  it('a repeated completed operation has no additional effect', () => {
    const server = serverWith('field-merge', start)
    const p = op('patch', start, { notes: 'once' })
    const first = server.apply(p)
    const again = server.apply(p)
    expect(again).toEqual(first)
    expect(server.mutations).toBe(2)
  })
})

describe('local projection', () => {
  const shadow = (overrides: Partial<JobSnapshot> = {}): JobSnapshot => ({
    schemaVersion: 1,
    id: JOB,
    ownerId: 'user-a',
    fields: start,
    deleted: false,
    revision: 2,
    lastOpId: uuid(),
    updatedAt: 1,
    ...overrides,
  })

  it('rebuilds the view from the shadow plus outstanding operations in order', () => {
    const p1 = op('patch', start, { notes: 'a' })
    const p2 = op('patch', p1.after, { status: 'completed' })
    expect(rebuildView(shadow(), [p1, p2])?.fields).toMatchObject({
      notes: 'a',
      status: 'completed',
    })
    expect(rebuildView(null, [op('create', start), p1])?.fields.notes).toBe('a')
    expect(rebuildView(null, [])).toBeNull()
  })

  it('a tombstone stays deleted even with outstanding patches', () => {
    const view = rebuildView(shadow({ deleted: true }), [op('patch', start, { notes: 'mine' })])
    expect(view).toMatchObject({ deleted: true })
    expect(view?.fields.notes).toBe('')
  })

  it('applies local delete and ignores patches on a deleted view', () => {
    const deleted = applyLocal({ fields: start, deleted: false }, op('delete', start))
    expect(deleted?.deleted).toBe(true)
    expect(applyLocal(deleted, op('patch', start, { notes: 'x' }))).toBe(deleted)
  })

  it('only newer revisions replace a shadow', () => {
    expect(isNewerShadow(null, shadow())).toBe(true)
    expect(isNewerShadow(shadow({ revision: 6 }), shadow({ revision: 5 }))).toBe(false)
    expect(isNewerShadow(shadow({ revision: 6 }), shadow({ revision: 6 }))).toBe(false)
    expect(isNewerShadow(shadow({ revision: 5 }), shadow({ revision: 6 }))).toBe(true)
  })
})
