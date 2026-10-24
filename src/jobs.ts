// Local commands. Every user edit goes through here, online or offline: one Dexie transaction
// writes the visible job and its immutable outbox operation together, then sync is requested.
import type { FieldLogDB } from './db'
import {
  PROTOCOL_VERSION,
  diffFields,
  hasErrors,
  newId,
  normalizeFields,
  validateFields,
  type FieldErrors,
  type FieldKey,
  type FieldValue,
  type JobFields,
  type LocalJob,
  type OperationPayload,
  type OutboxRow,
} from './domain'
import { applyLocal } from './sync/merge'

export type LocalContext = {
  db: FieldLogDB
  ownerId: string
  deviceId: string
  requestSync?: (reason: string) => void
  now?: () => number
}

export class ValidationError extends Error {
  constructor(readonly errors: FieldErrors) {
    super('Some fields need attention.')
    this.name = 'ValidationError'
  }
}

export class NotEditableError extends Error {
  constructor(message = 'This job is no longer available for editing on this device.') {
    super(message)
    this.name = 'NotEditableError'
  }
}

/** The IndexedDB transaction did not commit. Nothing from the attempted save was stored. */
export class LocalSaveError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LocalSaveError'
  }
}

export function describeStorageError(e: unknown): string {
  const names = [e, (e as { inner?: unknown })?.inner].map((x) => (x as { name?: string })?.name)
  if (names.includes('QuotaExceededError')) {
    return 'This device is out of storage space for FieldLog. Nothing was saved — free up space and try again.'
  }
  return 'This change could not be saved on this device. Nothing was saved — please try again.'
}

function pendingRow(payload: OperationPayload): OutboxRow {
  return {
    payload,
    state: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  }
}

function operation(
  ctx: LocalContext,
  kind: OperationPayload['kind'],
  job: { id: string; shadow: LocalJob['shadow'] },
  after: JobFields,
  now: number,
  patch: Partial<JobFields> = {},
  baseValues: Partial<JobFields> = {},
): OperationPayload {
  return {
    protocolVersion: PROTOCOL_VERSION,
    opId: newId(),
    ownerId: ctx.ownerId,
    deviceId: ctx.deviceId,
    jobId: job.id,
    kind,
    baseRevision: job.shadow?.revision ?? null,
    baseValues,
    patch,
    after,
    clientCreatedAt: now,
  }
}

/** Runs `fn` in one read-write transaction over the given stores; no network work inside. */
async function commit<T>(
  ctx: LocalContext,
  stores: ('jobs' | 'outbox' | 'conflicts')[],
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await ctx.db.transaction('rw', stores, fn)
  } catch (e) {
    if (e instanceof ValidationError || e instanceof NotEditableError) throw e
    throw new LocalSaveError(describeStorageError(e), { cause: e })
  }
}

async function editableJob(ctx: LocalContext, jobId: string): Promise<LocalJob> {
  const job = await ctx.db.jobs.get(jobId)
  if (!job || job.view.deleted) throw new NotEditableError()
  return job
}

/** Queues a patch against the latest stored view (inside an open transaction). */
async function enqueuePatch(
  ctx: LocalContext,
  job: LocalJob,
  patch: Partial<JobFields>,
  baseValues: Partial<JobFields>,
  now: number,
): Promise<boolean> {
  const keys = Object.keys(patch) as FieldKey[]
  if (keys.every((k) => job.view.fields[k] === patch[k])) return false
  const after = { ...job.view.fields, ...patch }
  const errors = validateFields(after)
  if (hasErrors(errors)) throw new ValidationError(errors)
  const payload = operation(ctx, 'patch', job, after, now, patch, baseValues)
  await ctx.db.jobs.put({
    ...job,
    view: applyLocal(job.view, payload)!,
    localVersion: job.localVersion + 1,
    localUpdatedAt: now,
  })
  await ctx.db.outbox.add(pendingRow(payload))
  return true
}

export async function createJob(ctx: LocalContext, input: JobFields): Promise<string> {
  const fields = normalizeFields(input)
  const errors = validateFields(fields)
  if (hasErrors(errors)) throw new ValidationError(errors)
  const now = ctx.now?.() ?? Date.now()
  const job: LocalJob = {
    id: newId(),
    shadow: null,
    view: { fields, deleted: false },
    localVersion: 1,
    localUpdatedAt: now,
  }
  const payload = operation(ctx, 'create', job, fields, now)
  await commit(ctx, ['jobs', 'outbox'], async () => {
    await ctx.db.jobs.add(job)
    await ctx.db.outbox.add(pendingRow(payload))
  })
  ctx.requestSync?.('local-save')
  return job.id
}

/**
 * Saves only the fields the user changed (draft vs. the values the editor started from),
 * applied to the latest stored job so unrelated fields changed elsewhere are kept.
 */
export async function editJob(
  ctx: LocalContext,
  jobId: string,
  base: JobFields,
  draft: JobFields,
): Promise<'saved' | 'unchanged'> {
  const normalized = normalizeFields(draft)
  const errors = validateFields(normalized)
  if (hasErrors(errors)) throw new ValidationError(errors)
  const { patch, baseValues } = diffFields(base, normalized)
  if (Object.keys(patch).length === 0) return 'unchanged'
  const now = ctx.now?.() ?? Date.now()
  const saved = await commit(ctx, ['jobs', 'outbox'], async () =>
    enqueuePatch(ctx, await editableJob(ctx, jobId), patch, baseValues, now),
  )
  if (saved) ctx.requestSync?.('local-save')
  return saved ? 'saved' : 'unchanged'
}

export async function deleteJob(ctx: LocalContext, jobId: string): Promise<void> {
  const now = ctx.now?.() ?? Date.now()
  await commit(ctx, ['jobs', 'outbox'], async () => {
    const job = await editableJob(ctx, jobId)
    const payload = operation(ctx, 'delete', job, job.view.fields, now)
    await ctx.db.jobs.put({
      ...job,
      view: applyLocal(job.view, payload)!,
      localVersion: job.localVersion + 1,
      localUpdatedAt: now,
    })
    await ctx.db.outbox.add(pendingRow(payload))
  })
  ctx.requestSync?.('local-save')
}

/** "Use this value" from a conflict notice: a new patch with a new opId against today's view. */
export async function chooseConflictValue(
  ctx: LocalContext,
  noticeId: string,
  value: FieldValue,
): Promise<'saved' | 'unchanged'> {
  const now = ctx.now?.() ?? Date.now()
  const saved = await commit(ctx, ['jobs', 'outbox', 'conflicts'], async () => {
    const notice = await ctx.db.conflicts.get(noticeId)
    if (!notice?.field) throw new NotEditableError('This conflict notice no longer exists.')
    const job = await editableJob(ctx, notice.jobId)
    const key = notice.field
    const changed = await enqueuePatch(
      ctx,
      job,
      { [key]: value } as Partial<JobFields>,
      { [key]: job.view.fields[key] } as Partial<JobFields>,
      now,
    )
    await ctx.db.conflicts.update(noticeId, { resolvedAt: now })
    return changed
  })
  if (saved) ctx.requestSync?.('local-save')
  return saved ? 'saved' : 'unchanged'
}

export async function dismissNotice(ctx: LocalContext, noticeId: string): Promise<void> {
  await commit(ctx, ['conflicts'], async () => {
    await ctx.db.conflicts.update(noticeId, { resolvedAt: ctx.now?.() ?? Date.now() })
  })
}

/**
 * The job was deleted on another device while this device still had edits. Recovery creates a
 * replacement job with a new ID from the retained values; the tombstone is never resurrected.
 * The held-back operations for the deleted job are removed: they can no longer change
 * canonical data, because the server rejects every change to a tombstone.
 */
export async function resolveDeletedJob(
  ctx: LocalContext,
  noticeId: string,
  action: 'recover' | 'discard',
): Promise<string | null> {
  const now = ctx.now?.() ?? Date.now()
  let newJobId: string | null = null
  await commit(ctx, ['jobs', 'outbox', 'conflicts'], async () => {
    const notice = await ctx.db.conflicts.get(noticeId)
    if (notice?.kind !== 'deleted' || !notice.retained) {
      throw new NotEditableError('This recovery item no longer exists.')
    }
    await ctx.db.outbox
      .where('payload.jobId')
      .equals(notice.jobId)
      .filter((r) => r.state === 'blocked' && r.lastErrorCode === 'job_deleted')
      .delete()
    if (action === 'recover') {
      const fields = normalizeFields(notice.retained)
      const errors = validateFields(fields)
      if (hasErrors(errors)) throw new ValidationError(errors)
      const job: LocalJob = {
        id: newId(),
        shadow: null,
        view: { fields, deleted: false },
        localVersion: 1,
        localUpdatedAt: now,
      }
      await ctx.db.jobs.add(job)
      await ctx.db.outbox.add(pendingRow(operation(ctx, 'create', job, fields, now)))
      newJobId = job.id
    }
    await ctx.db.conflicts.update(noticeId, { resolvedAt: now })
  })
  if (newJobId) ctx.requestSync?.('local-save')
  return newJobId
}

/** Recovery/debug snapshot of this account's local data. Contains no tokens or credentials. */
export async function buildExport(ctx: LocalContext, projectId: string): Promise<unknown> {
  const db = ctx.db
  return db.transaction('r', [db.jobs, db.outbox, db.conflicts, db.meta], async () => ({
    kind: 'fieldlog-local-export',
    note: 'Recovery/debug snapshot of local data. Not encrypted, not a backup, and not importable.',
    exportedAt: new Date(ctx.now?.() ?? Date.now()).toISOString(),
    projectId,
    ownerId: ctx.ownerId,
    deviceId: ctx.deviceId,
    localDbVersion: db.verno,
    protocolVersion: PROTOCOL_VERSION,
    jobs: await db.jobs.toArray(),
    outbox: await db.outbox.toArray(),
    conflicts: await db.conflicts.toArray(),
    meta: (await db.meta.toArray()).filter((m) => !/token/i.test(m.key)),
  }))
}
