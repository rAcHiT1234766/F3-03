// Small UI helpers: one polite live region, honest sync wording, date and due-date formatting.
import { ref } from 'vue'
import type { JobPriority, JobStatus, LocalJob, OutboxRow } from './domain'
import type { SyncPhase } from './sync/engine'

export const announcement = ref('')

/** Set by the job editor while it holds unsaved input; app updates wait for it. */
export const hasUnsavedDraft = ref(false)

/** Announces an important outcome once (save, error, sync result) — not every retry tick. */
export function announce(message: string): void {
  announcement.value = ''
  queueMicrotask(() => (announcement.value = message))
}

export type JobSyncState = 'synced' | 'pending' | 'syncing' | 'retrying' | 'attention'

export function jobSyncState(job: LocalJob, ops: OutboxRow[]): JobSyncState {
  if (ops.length === 0) return job.shadow ? 'synced' : 'pending'
  if (ops.some((r) => r.state === 'blocked')) return 'attention'
  if (ops.some((r) => r.state === 'sending')) return 'syncing'
  if (ops.some((r) => r.state === 'retry_wait')) return 'retrying'
  return 'pending'
}

export const JOB_SYNC_LABELS: Record<JobSyncState, string> = {
  synced: 'Synced',
  pending: 'Saved on this device',
  syncing: 'Syncing…',
  retrying: 'Waiting to retry',
  attention: 'Needs attention',
}

export function phaseMessage(phase: SyncPhase, online: boolean): string {
  switch (phase) {
    case 'syncing':
      return 'Syncing…'
    case 'offline':
      return 'Offline — you can keep working'
    case 'unreachable':
      return online ? 'Cannot reach the server — retrying' : 'Offline — you can keep working'
    case 'auth_required':
      return 'Sign in again to sync'
    case 'denied':
      return 'Some changes need attention'
    case 'unsupported':
      return 'This browser cannot sync safely (Web Locks missing)'
    case 'stopped':
      return 'Sync stopped'
    case 'idle':
      return online ? 'Ready' : 'Offline — you can keep working'
  }
}

// Formatters are created once: constructing Intl.DateTimeFormat per call was measurable when a
// long job list renders.
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return 'never'
  return dateTimeFormat.format(ms)
}

export function formatDueDate(value: string | null): string {
  if (!value) return 'No due date'
  const [y, m, d] = value.split('-').map(Number)
  // Date-only value: format in local calendar terms, never through UTC midnight.
  return dateFormat.format(new Date(y!, m! - 1, d!))
}

export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

export const PRIORITY_LABELS: Record<JobPriority, string> = {
  low: 'Low priority',
  normal: 'Normal priority',
  high: 'High priority',
}

export type DueTone = 'none' | 'done' | 'overdue' | 'today' | 'soon' | 'later'

/** Whole calendar days from `today` to a YYYY-MM-DD date, in local calendar terms. */
export function daysUntil(value: string, today: Date = new Date()): number {
  const [y, m, d] = value.split('-').map(Number)
  const target = Date.UTC(y!, m! - 1, d!)
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((target - start) / 86_400_000)
}

/** Due date wording for a field technician: relative when it matters, absolute otherwise. */
export function describeDue(
  value: string | null,
  status: JobStatus,
  today: Date = new Date(),
): { text: string; tone: DueTone } {
  if (!value) return { text: 'No due date', tone: 'none' }
  if (status === 'completed') return { text: `Due ${formatDueDate(value)}`, tone: 'done' }
  const days = daysUntil(value, today)
  if (days < 0) return { text: `Overdue by ${pluralize(-days, 'day')}`, tone: 'overdue' }
  if (days === 0) return { text: 'Due today', tone: 'today' }
  if (days === 1) return { text: 'Due tomorrow', tone: 'soon' }
  if (days < 7) return { text: `Due in ${days} days`, tone: 'soon' }
  return { text: `Due ${formatDueDate(value)}`, tone: 'later' }
}

/** Short printed reference for a job, as on a paper docket ("3F2A1B"). */
export function jobRef(id: string): string {
  return id.slice(0, 6).toUpperCase()
}
