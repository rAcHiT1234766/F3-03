// Small UI helpers: one polite live region, honest sync wording, date formatting.
import { ref } from 'vue'
import type { LocalJob, OutboxRow } from './domain'
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

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return 'never'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
}

export function formatDueDate(value: string | null): string {
  if (!value) return 'No due date'
  const [y, m, d] = value.split('-').map(Number)
  // Date-only value: format in local calendar terms, never through UTC midnight.
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(y!, m! - 1, d!),
  )
}

export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
