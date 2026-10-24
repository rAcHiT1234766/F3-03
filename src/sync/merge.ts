// Pure conflict resolution and projection rebuilding. No I/O, no clocks, no mutation of inputs.
import {
  FIELD_KEYS,
  type FieldConflict,
  type FieldKey,
  type FieldValue,
  type JobFields,
  type JobSnapshot,
  type JobView,
  type OperationPayload,
  type ReceiptOutcome,
} from '../domain'

/**
 * 'record-lww' is the staged baseline (replace all business fields with `after`).
 * 'field-merge' is the shipped default. "Last" means last successful server commit on the job,
 * never a device clock.
 */
export type ConflictPolicy = 'record-lww' | 'field-merge'
export const FINAL_POLICY: ConflictPolicy = 'field-merge'

export type Resolution =
  | {
      ok: true
      outcome: ReceiptOutcome
      changed: boolean
      fields: JobFields
      deleted: boolean
      conflicts: FieldConflict[]
    }
  | { ok: false; code: 'job_exists' | 'job_deleted' | 'missing_job'; message: string }

type Current = Pick<JobSnapshot, 'fields' | 'deleted'> | null

export function resolveOperation(
  current: Current,
  op: OperationPayload,
  policy: ConflictPolicy,
): Resolution {
  if (op.kind === 'create') {
    if (current?.deleted) {
      return { ok: false, code: 'job_deleted', message: 'This job ID belongs to a deleted job.' }
    }
    if (current) {
      return { ok: false, code: 'job_exists', message: 'A different job already uses this ID.' }
    }
    return applied({ ...op.after }, false, [])
  }

  if (!current) {
    return { ok: false, code: 'missing_job', message: 'The job does not exist on the server.' }
  }

  if (op.kind === 'delete') {
    // Terminal tombstone. Fields are kept so the record can still be inspected or recovered.
    return current.deleted ? unchanged('noop', current) : applied({ ...current.fields }, true, [])
  }

  if (current.deleted) return unchanged('rejected_deleted', current)

  if (policy === 'record-lww') {
    const fields = { ...op.after }
    return FIELD_KEYS.every((k) => fields[k] === current.fields[k])
      ? unchanged('noop', current)
      : applied(fields, false, [])
  }

  const fields = { ...current.fields }
  const conflicts: FieldConflict[] = []
  // Only business fields; protocol metadata is never taken from a patch.
  for (const key of FIELD_KEYS) {
    if (!(key in op.patch)) continue
    const incoming = op.patch[key] as FieldValue
    const base = op.baseValues[key] as FieldValue
    const remote = current.fields[key]
    if (incoming === base || remote === incoming) continue // nothing to apply / already there
    if (remote !== base) conflicts.push({ field: key, base, incoming, remote, chosen: incoming })
    ;(fields as Record<FieldKey, FieldValue>)[key] = incoming
  }
  const changed = FIELD_KEYS.some((k) => fields[k] !== current.fields[k])
  return changed ? applied(fields, false, conflicts) : unchanged('noop', current)
}

function applied(fields: JobFields, deleted: boolean, conflicts: FieldConflict[]): Resolution {
  return { ok: true, outcome: 'applied', changed: true, fields, deleted, conflicts }
}

function unchanged(outcome: ReceiptOutcome, current: NonNullable<Current>): Resolution {
  return {
    ok: true,
    outcome,
    changed: false,
    fields: { ...current.fields },
    deleted: current.deleted,
    conflicts: [],
  }
}

/** Optimistic local effect of one queued operation on the visible projection. */
export function applyLocal(view: JobView | null, op: OperationPayload): JobView | null {
  switch (op.kind) {
    case 'create':
      // If a confirmed shadow already exists, the create was committed (or will be rejected);
      // the confirmed state is the better display until the receipt is processed.
      return view ?? { fields: { ...op.after }, deleted: false }
    case 'patch':
      if (!view || view.deleted) return view
      return { fields: { ...view.fields, ...op.patch }, deleted: false }
    case 'delete':
      return view ? { fields: { ...view.fields }, deleted: true } : null
  }
}

/** View = confirmed shadow + outstanding operations in local sequence. A tombstone is final. */
export function rebuildView(shadow: JobSnapshot | null, ops: OperationPayload[]): JobView | null {
  if (shadow?.deleted) return { fields: { ...shadow.fields }, deleted: true }
  let view: JobView | null = shadow ? { fields: { ...shadow.fields }, deleted: false } : null
  for (const op of ops) view = applyLocal(view, op)
  return view
}

/** True if `incoming` should replace the stored shadow (per-job revision only moves forward). */
export function isNewerShadow(stored: JobSnapshot | null, incoming: JobSnapshot): boolean {
  return stored === null || incoming.revision > stored.revision
}
