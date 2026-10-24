// Dexie-side sync transactions: queue bookkeeping, receipt acknowledgement, and applying pulled
// snapshots. Each function is one local transaction; none of them touch the network.
import type { FieldLogDB } from '../db'
import {
  stableStringify,
  type ConflictNotice,
  type JobFields,
  type JobSnapshot,
  type LocalJob,
  type OutboxRow,
  type Receipt,
} from '../domain'
import { isNewerShadow, rebuildView } from './merge'

function bySequence(rows: OutboxRow[]): OutboxRow[] {
  return [...rows].sort((a, b) => a.sequence! - b.sequence!)
}

async function opsForJob(db: FieldLogDB, jobId: string): Promise<OutboxRow[]> {
  return bySequence(await db.outbox.where('payload.jobId').equals(jobId).toArray())
}

/**
 * Called with the sync lock held. A row still marked "sending" cannot have a live request
 * (the lock is held across every request), so its outcome is unknown: retry it with the same opId.
 */
export async function recoverInterrupted(db: FieldLogDB, now: number): Promise<number> {
  return db.outbox.where('state').equals('sending').modify({
    state: 'retry_wait',
    nextAttemptAt: now,
    lastErrorCode: 'interrupted',
    lastErrorMessage: 'Previous attempt ended without a confirmed result.',
  })
}

/**
 * Earliest due operation that has no earlier unacknowledged operation for the same job.
 * A waiting or blocked operation holds later operations for its job; other jobs continue.
 */
export async function nextEligible(db: FieldLogDB, now: number): Promise<OutboxRow | null> {
  const held = new Set<string>()
  for (const row of await db.outbox.toArray()) {
    const jobId = row.payload.jobId
    if (held.has(jobId)) continue
    held.add(jobId)
    const due = row.state === 'retry_wait' && (row.nextAttemptAt ?? 0) <= now
    if (row.state === 'pending' || due) return row
  }
  return null
}

export async function nextRetryAt(db: FieldLogDB): Promise<number | null> {
  const rows = await db.outbox.where('state').equals('retry_wait').toArray()
  const times = rows.map((r) => r.nextAttemptAt ?? 0)
  return times.length ? Math.min(...times) : null
}

export async function markSending(db: FieldLogDB, sequence: number): Promise<OutboxRow | null> {
  return db.transaction('rw', db.outbox, async () => {
    const row = await db.outbox.get(sequence)
    if (!row || (row.state !== 'pending' && row.state !== 'retry_wait')) return null
    const changes = { state: 'sending' as const, attempts: row.attempts + 1 }
    await db.outbox.update(sequence, changes)
    return { ...row, ...changes }
  })
}

export async function markFailed(
  db: FieldLogDB,
  sequence: number,
  changes: Pick<OutboxRow, 'state' | 'nextAttemptAt' | 'lastErrorCode' | 'lastErrorMessage'>,
): Promise<void> {
  await db.outbox.update(sequence, changes)
}

/** Manual retry: clears the delay of transient failures. Error explanations and payloads stay. */
export async function clearRetryDelays(db: FieldLogDB, now: number): Promise<void> {
  await db.outbox.where('state').equals('retry_wait').modify({ nextAttemptAt: now })
}

/** Blocked → pending, for a cause the user says is resolved. The payload is unchanged. */
export async function unblock(db: FieldLogDB, sequence: number): Promise<void> {
  await db.outbox
    .where(':id')
    .equals(sequence)
    .filter((r) => r.state === 'blocked')
    .modify({ state: 'pending', nextAttemptAt: null })
}

/** Removes one operation whose remote outcome is known to be "no effect", then rebuilds the view. */
export async function discardOperation(db: FieldLogDB, sequence: number): Promise<void> {
  await db.transaction('rw', [db.jobs, db.outbox], async () => {
    const row = await db.outbox.get(sequence)
    if (!row) return
    await db.outbox.delete(sequence)
    await rebuildStoredJob(db, row.payload.jobId)
  })
}

async function rebuildStoredJob(db: FieldLogDB, jobId: string): Promise<void> {
  const job = await db.jobs.get(jobId)
  if (!job) return
  const view = rebuildView(
    job.shadow,
    (await opsForJob(db, jobId)).map((r) => r.payload),
  )
  if (view) await db.jobs.put({ ...job, view })
  else await db.jobs.delete(jobId) // a never-confirmed local create whose operations are gone
}

/**
 * Applies one committed receipt. Removes only the matching operation, never regresses the
 * shadow, and rebuilds the view from the latest shadow plus the operations still queued, so
 * edits made while the request was in flight stay visible and pending.
 */
export async function acknowledgeReceipt(
  db: FieldLogDB,
  receipt: Receipt,
  now: number,
): Promise<'acknowledged' | 'duplicate'> {
  return db.transaction('rw', [db.jobs, db.outbox, db.conflicts], async () => {
    const row = await db.outbox.where('payload.opId').equals(receipt.opId).first()
    if (!row) return 'duplicate'
    const job = await db.jobs.get(receipt.jobId)
    const stored = job?.shadow ?? null
    const shadow = isNewerShadow(stored, receipt.result) ? receipt.result : stored!
    await db.outbox.delete(row.sequence!)

    const notices: ConflictNotice[] = receipt.conflicts.map((c) => ({
      id: `${receipt.opId}:${c.field}`,
      jobId: receipt.jobId,
      opId: receipt.opId,
      kind: 'field',
      field: c.field,
      base: c.base,
      incoming: c.incoming,
      remote: c.remote,
      chosen: c.chosen,
      retained: null,
      createdAt: receipt.receivedAt,
      resolvedAt: null,
    }))

    const remaining = await opsForJob(db, receipt.jobId)
    if (receipt.outcome === 'rejected_deleted') {
      // Keep the user's intended values for recovery, and hold the job's later edits:
      // sending them would only produce more rejections.
      let retained: JobFields = { ...row.payload.after }
      for (const r of remaining)
        if (r.payload.kind === 'patch') retained = { ...retained, ...r.payload.patch }
      notices.push({
        id: `${receipt.opId}:deleted`,
        jobId: receipt.jobId,
        opId: receipt.opId,
        kind: 'deleted',
        field: null,
        base: null,
        incoming: null,
        remote: null,
        chosen: null,
        retained,
        createdAt: receipt.receivedAt,
        resolvedAt: null,
      })
      for (const r of remaining) {
        if (r.state === 'sending') continue
        await db.outbox.update(r.sequence!, {
          state: 'blocked',
          lastErrorCode: 'job_deleted',
          lastErrorMessage: 'Deleted on another device; this edit is kept on this device.',
        })
      }
    }
    if (notices.length) await db.conflicts.bulkPut(notices)

    const view = rebuildView(
      shadow,
      remaining.map((r) => r.payload),
    )!
    await db.jobs.put({
      id: receipt.jobId,
      shadow,
      view,
      localVersion: job?.localVersion ?? 0,
      localUpdatedAt: job?.localUpdatedAt ?? now,
    })
    return 'acknowledged'
  })
}

export type PullResult = { applied: number; ignored: number; mismatched: string[] }

/**
 * Applies a validated server read. Newer revisions replace the shadow and the view is rebuilt
 * with outstanding local operations; older ones are ignored. Absence from the read never deletes.
 */
export async function applyRemoteSnapshots(
  db: FieldLogDB,
  snapshots: JobSnapshot[],
  now: number,
): Promise<PullResult> {
  return db.transaction('rw', [db.jobs, db.outbox, db.meta], async () => {
    const result: PullResult = { applied: 0, ignored: 0, mismatched: [] }
    const stored = await db.jobs.bulkGet(snapshots.map((s) => s.id))
    const opsByJob = new Map<string, OutboxRow[]>()
    for (const row of await db.outbox.toArray()) {
      const list = opsByJob.get(row.payload.jobId) ?? []
      list.push(row)
      opsByJob.set(row.payload.jobId, list)
    }
    const updates: LocalJob[] = []
    snapshots.forEach((snap, i) => {
      const job = stored[i]
      const shadow = job?.shadow ?? null
      if (shadow && snap.revision === shadow.revision) {
        if (stableStringify(snap) !== stableStringify(shadow)) result.mismatched.push(snap.id)
        else result.ignored++
        return
      }
      if (!isNewerShadow(shadow, snap)) {
        result.ignored++
        return
      }
      const ops = (opsByJob.get(snap.id) ?? []).map((r) => r.payload)
      updates.push({
        id: snap.id,
        shadow: snap,
        view: rebuildView(snap, ops)!,
        localVersion: job?.localVersion ?? 0,
        localUpdatedAt: job?.localUpdatedAt ?? now,
      })
      result.applied++
    })
    if (updates.length) await db.jobs.bulkPut(updates)
    await db.meta.put({ key: 'lastSuccessfulPullAt', value: now })
    return result
  })
}
