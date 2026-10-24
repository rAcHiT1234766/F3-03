import { describe, expect, it } from 'vitest'
import {
  diffFields,
  isCalendarDate,
  normalizeFields,
  parseFields,
  parseJobMessage,
  parseSnapshot,
  payloadProblem,
  samePayload,
  stableStringify,
  validateFields,
  type OperationPayload,
} from '../../src/domain'
import { sampleFields } from './helpers'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

function patchPayload(overrides: Partial<OperationPayload> = {}): OperationPayload {
  const after = sampleFields({ title: 'New title' })
  return {
    protocolVersion: 1,
    opId: UUID_A,
    ownerId: 'user-a',
    deviceId: 'device-a',
    jobId: UUID_B,
    kind: 'patch',
    baseRevision: 3,
    baseValues: { title: 'Boiler inspection' },
    patch: { title: 'New title' },
    after,
    clientCreatedAt: 1,
    ...overrides,
  }
}

describe('field validation', () => {
  it('accepts a valid job', () => {
    expect(validateFields(sampleFields())).toEqual({})
  })

  it('enforces required fields and length limits', () => {
    const errors = validateFields(
      sampleFields({ title: '', customerName: 'x'.repeat(121), notes: 'n'.repeat(4001) }),
    )
    expect(Object.keys(errors).sort()).toEqual(['customerName', 'notes', 'title'])
    expect(
      validateFields(sampleFields({ title: 't'.repeat(120), notes: 'n'.repeat(4000) })),
    ).toEqual({})
  })

  it('rejects unknown enum values', () => {
    const bad = { ...sampleFields(), status: 'done', priority: 'urgent' } as never
    expect(Object.keys(validateFields(bad)).sort()).toEqual(['priority', 'status'])
  })

  it('validates real Gregorian calendar dates only', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2024-02-29')).toBe(true)
    expect(isCalendarDate('1900-02-29')).toBe(false) // century rule
    expect(isCalendarDate('2000-02-29')).toBe(true)
    expect(isCalendarDate('2026-02-31')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-1-01')).toBe(false)
    expect(isCalendarDate('2026-04-31')).toBe(false)
    expect(validateFields(sampleFields({ dueDate: '2026-02-31' })).dueDate).toBeDefined()
    expect(validateFields(sampleFields({ dueDate: null }))).toEqual({})
  })

  it('trims single-line text but keeps multiline text as typed', () => {
    const n = normalizeFields(
      sampleFields({
        title: '  Pump  ',
        description: '  line 1\n  line 2  ',
        notes: '\n\nkeep\n',
        dueDate: '',
      }),
    )
    expect(n.title).toBe('Pump')
    expect(n.description).toBe('  line 1\n  line 2  ')
    expect(n.notes).toBe('\n\nkeep\n')
    expect(n.dueDate).toBeNull()
  })
})

describe('patch generation', () => {
  it('includes only fields the user changed, with the values the editor started from', () => {
    const base = sampleFields()
    const { patch, baseValues } = diffFields(base, {
      ...base,
      notes: 'Gas off',
      status: 'in_progress',
    })
    expect(patch).toEqual({ notes: 'Gas off', status: 'in_progress' })
    expect(baseValues).toEqual({ notes: '', status: 'scheduled' })
  })

  it('treats null and empty string as different explicit values', () => {
    const base = sampleFields({ dueDate: '2026-01-01' })
    expect(diffFields(base, { ...base, dueDate: null }).patch).toEqual({ dueDate: null })
    expect(diffFields(base, base).patch).toEqual({})
  })
})

describe('payload and snapshot parsing', () => {
  it('accepts a well-formed patch and rejects malformed ones', () => {
    expect(payloadProblem(patchPayload())).toBeNull()
    expect(payloadProblem(patchPayload({ opId: 'not-a-uuid' }))).toMatch(/UUID/)
    expect(payloadProblem(patchPayload({ protocolVersion: 2 as 1 }))).toMatch(/protocol/)
    expect(payloadProblem(patchPayload({ baseValues: {} }))).toMatch(/base values/)
    expect(payloadProblem(patchPayload({ patch: { title: 'Other' } }))).toMatch(/disagree/)
    expect(payloadProblem(patchPayload({ patch: {}, baseValues: {} }))).toMatch(/empty/)
    expect(
      payloadProblem(patchPayload({ kind: 'create', patch: { title: 'x' } as never })),
    ).toMatch(/no field patch/)
    expect(payloadProblem(patchPayload({ after: sampleFields({ title: '' }) }))).toMatch(/invalid/)
  })

  it('rejects remote snapshots with the wrong owner, id or shape', () => {
    const snap = {
      schemaVersion: 1,
      id: UUID_B,
      ownerId: 'user-a',
      fields: sampleFields(),
      deleted: false,
      revision: 2,
      lastOpId: UUID_A,
      updatedAt: 5,
    }
    expect(parseSnapshot(snap, 'user-a', UUID_B)).toEqual(snap)
    expect(parseSnapshot(snap, 'user-b', UUID_B)).toBeNull()
    expect(parseSnapshot(snap, 'user-a', UUID_A)).toBeNull()
    expect(parseSnapshot({ ...snap, revision: 0 }, 'user-a')).toBeNull()
    expect(parseSnapshot({ ...snap, fields: { ...snap.fields, extra: 1 } }, 'user-a')).toBeNull()
    expect(parseFields({ ...sampleFields(), dueDate: undefined })).toBeNull()
  })

  it('compares requests independent of key order', () => {
    const p = patchPayload()
    const reordered = JSON.parse(JSON.stringify({ ...p, after: { ...p.after } }))
    expect(samePayload(p, Object.fromEntries(Object.entries(reordered).reverse()))).toBe(true)
    expect(samePayload(p, { ...p, patch: { title: 'Different' } })).toBe(false)
    expect(stableStringify({ b: 1, a: [null, { d: 2, c: 3 }] })).toBe(
      '{"a":[null,{"c":3,"d":2}],"b":1}',
    )
  })

  it('accepts only well-formed job push messages', () => {
    expect(parseJobMessage({ type: 'job_update', jobId: UUID_A, tag: 'job-1' })).toEqual({
      jobId: UUID_A,
      tag: 'job-1',
    })
    expect(parseJobMessage({ type: 'job_update', jobId: UUID_A, tag: '<b>x</b>' })?.tag).toBe(
      `job-${UUID_A}`,
    )
    expect(parseJobMessage({ type: 'job_update', jobId: 'https://evil.example' })).toBeNull()
    expect(parseJobMessage({ type: 'other', jobId: UUID_A })).toBeNull()
    expect(parseJobMessage(undefined)).toBeNull()
  })
})
