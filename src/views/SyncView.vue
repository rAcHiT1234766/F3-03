<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { requireSession } from '../auth'
import { useOnline, useSyncOverview } from '../composables/useJobs'
import {
  FIELD_LABELS,
  STATUS_LABELS,
  type ConflictNotice,
  type FieldKey,
  type FieldValue,
  type OutboxRow,
} from '../domain'
import { chooseConflictValue, dismissNotice, resolveDeletedJob } from '../jobs'
import { canRetryBlocked, describeErrorCode } from '../sync/errors'
import { unblock } from '../sync/local'
import { announce, formatDateTime, phaseMessage, pluralize } from '../ui'

const s = requireSession()
const router = useRouter()
const overview = useSyncOverview(s.db)
const online = useOnline()
const status = s.sync.status
const message = ref<string | null>(null)

const STATE_LABELS: Record<OutboxRow['state'], string> = {
  pending: 'Waiting to sync',
  sending: 'Sending…',
  retry_wait: 'Will retry',
  blocked: 'Needs attention',
}

const pendingCount = computed(() => overview.value.outbox.length)
const openConflicts = computed(() => overview.value.conflicts.filter((c) => !c.resolvedAt))
const fieldConflicts = computed(() => openConflicts.value.filter((c) => c.kind === 'field'))
const deletedNotices = computed(() => openConflicts.value.filter((c) => c.kind === 'deleted'))
const history = computed(() => overview.value.conflicts.filter((c) => c.resolvedAt))
const upToDate = computed(
  () => pendingCount.value === 0 && status.phase === 'idle' && overview.value.lastPullAt !== null,
)

function titleFor(jobId: string, fallback?: string): string {
  return overview.value.jobs.get(jobId)?.view.fields.title ?? fallback ?? 'Unknown job'
}

function describeOp(row: OutboxRow): string {
  const p = row.payload
  if (p.kind === 'create') return 'New job'
  if (p.kind === 'delete') return 'Delete job'
  return `Edit: ${(Object.keys(p.patch) as FieldKey[]).map((k) => FIELD_LABELS[k]).join(', ')}`
}

/** True if an earlier operation for the same job is holding this one back. */
function isWaitingBehind(row: OutboxRow): boolean {
  return overview.value.outbox.some(
    (r) =>
      r.payload.jobId === row.payload.jobId && r.sequence! < row.sequence! && r.state === 'blocked',
  )
}

function hasLaterOps(row: OutboxRow): boolean {
  return overview.value.outbox.some(
    (r) => r.payload.jobId === row.payload.jobId && r.sequence! > row.sequence!,
  )
}

function show(value: FieldValue, field: FieldKey | null): string {
  if (value === null || value === '') return '(empty)'
  return field === 'status' ? (STATUS_LABELS[value as keyof typeof STATUS_LABELS] ?? value) : value
}

function currentValue(c: ConflictNotice): FieldValue | undefined {
  const job = overview.value.jobs.get(c.jobId)
  return job && c.field ? job.view.fields[c.field] : undefined
}

function canEdit(c: ConflictNotice): boolean {
  const job = overview.value.jobs.get(c.jobId)
  return !!job && !job.view.deleted
}

/** Results appear in the status card's role="status" banner, which announces them. */
async function run(action: () => Promise<unknown>, success: string) {
  message.value = null
  try {
    await action()
    message.value = success
  } catch (e) {
    message.value = (e as Error).message
  }
}

const syncNow = () => run(() => s.sync.retryNow(), 'Sync requested.')

function retryBlocked(row: OutboxRow) {
  return run(async () => {
    await unblock(s.db, row.sequence!)
    s.sync.request('manual')
  }, 'Trying this change again.')
}

async function checkAndDiscard(row: OutboxRow) {
  const ok = confirm(
    'FieldLog will first ask the server whether this change was applied. It is only removed from this device if the server confirms it had no effect. Continue?',
  )
  if (!ok) return
  message.value = null
  const result = await s.sync.discardBlocked(row.sequence!)
  message.value = {
    discarded:
      'The server confirmed this change was never applied. It was removed from this device; you can edit the job again.',
    acknowledged: 'The server had already applied this change. It is now marked as synced.',
    unknown:
      'Could not confirm with the server whether this change was applied, so it was kept. Try again when online.',
  }[result]
}

function useValue(c: ConflictNotice, value: FieldValue) {
  return run(
    () => chooseConflictValue(s, c.id, value),
    'Saved your choice as a new change on this device.',
  )
}

async function recover(c: ConflictNotice) {
  message.value = null
  try {
    const id = await resolveDeletedJob(s, c.id, 'recover')
    announce('Created a replacement job from your kept edits.')
    if (id) await router.push(`/jobs/${id}`)
  } catch (e) {
    message.value = (e as Error).message
  }
}

function discardDeleted(c: ConflictNotice) {
  if (!confirm('Discard the edits you made to this deleted job? This cannot be undone.')) return
  return run(
    () => resolveDeletedJob(s, c.id, 'discard'),
    'Your edits to the deleted job were discarded.',
  )
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Sync center</h1>
      <button class="btn btn-primary" type="button" :disabled="status.running" @click="syncNow">
        {{ status.running ? 'Syncing…' : 'Sync now' }}
      </button>
    </div>

    <section class="card" aria-labelledby="status-h">
      <h2 id="status-h">Status</h2>
      <p data-testid="sync-phase">
        <strong>{{ phaseMessage(status.phase, online) }}</strong>
        <template v-if="status.stalled">
          — the server is taking a long time to answer. You can keep working.</template
        >
      </p>
      <p v-if="status.lastError && status.phase !== 'idle'" class="small muted">
        {{ status.lastError }}
      </p>
      <p data-testid="pending-count">
        {{
          pendingCount === 0
            ? 'No changes waiting to sync.'
            : `${pluralize(pendingCount, 'change')} waiting to sync.`
        }}
      </p>
      <p v-if="upToDate" class="banner banner-ok">
        Up to date as of {{ formatDateTime(overview.lastPullAt) }}.
      </p>
      <dl class="details small">
        <dt>Last server check</dt>
        <dd data-testid="last-pull">{{ formatDateTime(overview.lastPullAt) }}</dd>
        <dt>Last upload</dt>
        <dd>{{ formatDateTime(overview.lastPushAt) }}</dd>
      </dl>
      <p class="hint">
        “No changes waiting” only covers this device's uploads. Changes made on other devices arrive
        at the next successful server check.
      </p>
      <p v-if="message" class="banner" role="status">{{ message }}</p>
    </section>

    <section v-if="deletedNotices.length" class="card" aria-labelledby="deleted-h">
      <h2 id="deleted-h">Deleted on another device</h2>
      <ul class="plain stack">
        <li v-for="c in deletedNotices" :key="c.id" class="notice">
          <p>
            <strong>{{ c.retained?.title }}</strong> was deleted on another device; your local edits
            were preserved on this device.
          </p>
          <p class="small muted">
            Recovering creates a new, separate job from your kept values. The deleted job itself
            cannot be restored.
          </p>
          <div class="row">
            <button class="btn" type="button" @click="recover(c)">Recover as a new job</button>
            <button class="btn btn-danger" type="button" @click="discardDeleted(c)">
              Discard my edits
            </button>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="fieldConflicts.length" class="card" aria-labelledby="conflicts-h">
      <h2 id="conflicts-h">Conflicting edits resolved</h2>
      <p class="small muted">
        Two devices changed the same field. The change that reached the server last was kept. These
        values are what happened at that time; the job may have changed again since.
      </p>
      <ul class="plain stack">
        <li v-for="c in fieldConflicts" :key="c.id" class="notice" data-testid="conflict">
          <p>
            <strong>{{ titleFor(c.jobId) }}</strong> — {{ c.field ? FIELD_LABELS[c.field] : '' }}
          </p>
          <dl class="details small">
            <dt>Value kept then</dt>
            <dd>{{ show(c.chosen, c.field) }}</dd>
            <dt>This change</dt>
            <dd>{{ show(c.incoming, c.field) }}</dd>
            <dt>Other device</dt>
            <dd>{{ show(c.remote, c.field) }}</dd>
            <dt>Value now</dt>
            <dd>
              {{
                currentValue(c) === undefined
                  ? '(job not available)'
                  : show(currentValue(c)!, c.field)
              }}
            </dd>
          </dl>
          <div class="row">
            <template v-if="canEdit(c)">
              <button class="btn btn-small" type="button" @click="useValue(c, c.incoming)">
                Use “this change”
              </button>
              <button class="btn btn-small" type="button" @click="useValue(c, c.remote)">
                Use “other device”
              </button>
            </template>
            <button
              class="btn btn-small"
              type="button"
              @click="run(() => dismissNotice(s, c.id), 'Notice dismissed.')"
            >
              Dismiss
            </button>
          </div>
        </li>
      </ul>
    </section>

    <section class="card" aria-labelledby="queue-h">
      <h2 id="queue-h">Changes waiting to sync</h2>
      <p v-if="!overview.outbox.length" class="muted">Nothing waiting.</p>
      <ol v-else class="plain stack" data-testid="outbox">
        <li
          v-for="row in overview.outbox"
          :key="row.sequence"
          class="notice"
          :data-state="row.state"
        >
          <div class="row">
            <strong>{{ titleFor(row.payload.jobId, row.payload.after.title) }}</strong>
            <span
              class="badge"
              :class="{
                'badge-danger': row.state === 'blocked',
                'badge-warn': row.state === 'retry_wait',
              }"
            >
              {{ STATE_LABELS[row.state] }}
            </span>
          </div>
          <p class="small">
            {{ describeOp(row) }} · saved {{ formatDateTime(row.payload.clientCreatedAt) }}
            <template v-if="row.attempts"> · {{ pluralize(row.attempts, 'attempt') }}</template>
          </p>
          <p v-if="row.lastErrorCode" class="small">
            {{ describeErrorCode(row.lastErrorCode) }}
            <span class="muted">({{ row.lastErrorCode }})</span>
          </p>
          <p v-if="row.state === 'retry_wait' && row.nextAttemptAt" class="small muted">
            Next attempt around {{ formatDateTime(row.nextAttemptAt) }}.
          </p>
          <p v-if="isWaitingBehind(row)" class="small muted">
            Waiting for an earlier change to this job.
          </p>
          <template v-if="row.state === 'blocked' && row.lastErrorCode !== 'job_deleted'">
            <p v-if="hasLaterOps(row)" class="small">
              Resolve this change before later edits to this job can sync.
            </p>
            <div class="row">
              <button
                v-if="canRetryBlocked(row.lastErrorCode)"
                class="btn btn-small"
                type="button"
                @click="retryBlocked(row)"
              >
                Try again
              </button>
              <button class="btn btn-small" type="button" @click="checkAndDiscard(row)">
                Check with server and discard
              </button>
            </div>
          </template>
        </li>
      </ol>
    </section>

    <details v-if="history.length" class="card">
      <summary>Earlier conflict outcomes ({{ history.length }})</summary>
      <ul class="small">
        <li v-for="c in history" :key="c.id">
          {{ titleFor(c.jobId, c.retained?.title) }} —
          {{ c.kind === 'deleted' ? 'deleted on another device' : FIELD_LABELS[c.field!] }}
          ({{ formatDateTime(c.createdAt) }})
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.notice {
  border-top: 1px solid var(--border);
  padding-top: 0.75rem;
}

.notice:first-child {
  border-top: 0;
  padding-top: 0;
}

.notice p {
  margin-bottom: 0.4rem;
}
</style>
