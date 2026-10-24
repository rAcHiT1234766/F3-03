<script setup lang="ts">
import {
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  CloudAlert,
  CloudCheck,
  CloudOff,
  CloudUpload,
  Download,
  GitMerge,
  Info,
  ListTodo,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  Trash,
  Undo2,
  Upload,
} from '@lucide/vue'
import { computed, ref, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { requireSession } from '../auth'
import { useOnline, useSyncOverview } from '../composables/useJobs'
import { confirmAction } from '../dialog'
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

const STATE_ICONS: Record<OutboxRow['state'], Component> = {
  pending: CloudUpload,
  sending: LoaderCircle,
  retry_wait: RotateCw,
  blocked: CircleAlert,
}

type Tone = 'ok' | 'busy' | 'warn' | 'danger'
const tone = computed<Tone>(() => {
  if (status.phase === 'syncing') return 'busy'
  if (!online.value || status.phase === 'offline' || status.phase === 'unreachable') return 'warn'
  if (status.phase === 'idle') return 'ok'
  return 'danger'
})
const toneIcon = computed<Component>(() => {
  if (tone.value === 'busy') return RefreshCw
  if (!online.value || status.phase === 'offline') return CloudOff
  if (status.phase === 'unreachable') return CloudAlert
  if (tone.value === 'danger') return CircleAlert
  return CloudCheck
})

/** Plain-language explanation of the phase; raw errors live under "Technical details". */
const help = computed(() => {
  if (!online.value && status.phase !== 'syncing')
    return 'Changes are saved on this device and upload when you are back online.'
  switch (status.phase) {
    case 'syncing':
      return 'Uploading changes and checking the server for updates.'
    case 'unreachable':
      return 'The server could not be reached. Changes stay on this device and are retried automatically.'
    case 'auth_required':
      return 'Your sign-in needs renewing. Sign in again to resume syncing; nothing on this device is lost.'
    case 'denied':
      return 'The server refused some changes. Review them in the list below.'
    case 'unsupported':
      return 'Use a current version of Chrome, Edge, Firefox or Safari to sync from this device.'
    case 'stopped':
      return 'Sync is stopped for this session.'
    default:
      return 'Changes you make are saved on this device first and upload automatically.'
  }
})

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
  const ok = await confirmAction({
    title: 'Check with the server and discard?',
    message:
      'FieldLog will first ask the server whether this change was applied. It is only removed from this device if the server confirms it had no effect.',
    confirmLabel: 'Check and discard',
    danger: true,
  })
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

async function discardDeleted(c: ConflictNotice) {
  const ok = await confirmAction({
    title: 'Discard your edits to this deleted job?',
    message: 'The values you kept on this device are removed. This cannot be undone.',
    confirmLabel: 'Discard my edits',
    danger: true,
  })
  if (!ok) return
  return run(
    () => resolveDeletedJob(s, c.id, 'discard'),
    'Your edits to the deleted job were discarded.',
  )
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Sync center</h1>
        <p class="page-sub">What this device has uploaded, what is waiting, and what needs you.</p>
      </div>
      <button class="btn btn-primary" type="button" :disabled="status.running" @click="syncNow">
        <RefreshCw :size="18" :class="{ spin: status.running }" />
        {{ status.running ? 'Syncing…' : 'Sync now' }}
      </button>
    </div>

    <section class="card status-card" :class="`tone-${tone}`" aria-labelledby="status-h">
      <div class="status-hero">
        <div class="status-icon">
          <component :is="toneIcon" :size="26" :class="{ spin: tone === 'busy' }" />
        </div>
        <div class="status-main">
          <h2 id="status-h" class="eyebrow">Status</h2>
          <p data-testid="sync-phase" class="phase">
            <strong>{{ phaseMessage(status.phase, online) }}</strong>
            <template v-if="status.stalled">
              — the server is taking a long time to answer. You can keep working.</template
            >
          </p>
          <p class="help">{{ help }}</p>
          <p data-testid="pending-count" class="pending" :class="{ none: pendingCount === 0 }">
            {{
              pendingCount === 0
                ? 'No changes waiting to sync.'
                : `${pluralize(pendingCount, 'change')} waiting to sync.`
            }}
          </p>
          <p v-if="upToDate" class="uptodate">
            <CircleCheck :size="16" />Up to date as of {{ formatDateTime(overview.lastPullAt) }}.
          </p>
        </div>
      </div>

      <dl class="stats">
        <div class="stat">
          <dt><Download :size="15" />Last server check</dt>
          <dd data-testid="last-pull">{{ formatDateTime(overview.lastPullAt) }}</dd>
        </div>
        <div class="stat">
          <dt><Upload :size="15" />Last upload</dt>
          <dd>{{ formatDateTime(overview.lastPushAt) }}</dd>
        </div>
      </dl>
      <details v-if="status.lastError && status.phase !== 'idle'" class="tech">
        <summary>Technical details</summary>
        <p class="small muted">{{ status.lastError }}</p>
      </details>
      <p class="hint note">
        <Info :size="15" />
        <span
          >“No changes waiting” only covers this device's uploads. Changes made on other devices
          arrive at the next successful server check.</span
        >
      </p>
      <p v-if="message" class="banner" role="status">
        <Info :size="18" /><span class="banner-body">{{ message }}</span>
      </p>
    </section>

    <section v-if="deletedNotices.length" class="card attention" aria-labelledby="deleted-h">
      <h2 id="deleted-h" class="section-title"><Trash :size="18" />Deleted on another device</h2>
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
            <button class="btn btn-primary btn-small" type="button" @click="recover(c)">
              <Undo2 :size="16" />Recover as a new job
            </button>
            <button class="btn btn-danger btn-small" type="button" @click="discardDeleted(c)">
              Discard my edits
            </button>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="fieldConflicts.length" class="card" aria-labelledby="conflicts-h">
      <h2 id="conflicts-h" class="section-title">
        <GitMerge :size="18" />Conflicting edits resolved
        <span class="badge badge-warn num">{{ fieldConflicts.length }}</span>
      </h2>
      <p class="small muted">
        Two devices changed the same field. The change that reached the server last was kept. These
        values are what happened at that time; the job may have changed again since.
      </p>
      <ul class="plain stack">
        <li v-for="c in fieldConflicts" :key="c.id" class="notice conflict" data-testid="conflict">
          <p class="conflict-head">
            <strong>{{ titleFor(c.jobId) }}</strong>
            <span class="badge">{{ c.field ? FIELD_LABELS[c.field] : '' }}</span>
          </p>
          <div class="compare">
            <div class="side" :class="{ kept: c.chosen === c.incoming }">
              <p class="side-label">
                This change
                <span v-if="c.chosen === c.incoming" class="badge badge-ok kept-badge"
                  ><Check :size="13" />Kept then</span
                >
              </p>
              <p class="side-value">{{ show(c.incoming, c.field) }}</p>
            </div>
            <div class="side" :class="{ kept: c.chosen === c.remote }">
              <p class="side-label">
                Other device
                <span v-if="c.chosen === c.remote" class="badge badge-ok kept-badge"
                  ><Check :size="13" />Kept then</span
                >
              </p>
              <p class="side-value">{{ show(c.remote, c.field) }}</p>
            </div>
          </div>
          <dl class="details small">
            <template v-if="c.chosen !== c.incoming && c.chosen !== c.remote">
              <dt>Value kept then</dt>
              <dd>{{ show(c.chosen, c.field) }}</dd>
            </template>
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
              class="btn btn-small btn-ghost"
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
      <h2 id="queue-h" class="section-title">
        <ListTodo :size="18" />Changes waiting to sync
        <span v-if="overview.outbox.length" class="badge num">{{ overview.outbox.length }}</span>
      </h2>
      <div v-if="!overview.outbox.length" class="queue-empty">
        <CircleCheck :size="20" />
        <p class="muted">Nothing waiting.</p>
      </div>
      <ol v-else class="plain queue" data-testid="outbox">
        <li
          v-for="row in overview.outbox"
          :key="row.sequence"
          class="op"
          :class="`op-${row.state}`"
          :data-state="row.state"
        >
          <span class="op-dot">
            <component
              :is="STATE_ICONS[row.state]"
              :size="16"
              :class="{ spin: row.state === 'sending' }"
            />
          </span>
          <div class="op-body">
            <div class="op-head">
              <strong>{{ titleFor(row.payload.jobId, row.payload.after.title) }}</strong>
              <span
                class="badge"
                :class="{
                  'badge-danger': row.state === 'blocked',
                  'badge-warn': row.state === 'retry_wait',
                  'badge-info': row.state === 'sending',
                }"
              >
                {{ STATE_LABELS[row.state] }}
              </span>
            </div>
            <p class="small muted op-meta">
              {{ describeOp(row) }} · saved {{ formatDateTime(row.payload.clientCreatedAt) }}
              <template v-if="row.attempts"> · {{ pluralize(row.attempts, 'attempt') }}</template>
            </p>
            <p v-if="row.lastErrorCode" class="small op-error">
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
                <button
                  class="btn btn-small btn-danger"
                  type="button"
                  @click="checkAndDiscard(row)"
                >
                  Check with server and discard
                </button>
              </div>
            </template>
          </div>
        </li>
      </ol>
    </section>

    <details v-if="history.length" class="card history">
      <summary>
        <Clock :size="18" />Earlier conflict outcomes
        <span class="badge num">{{ history.length }}</span>
      </summary>
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
.status-card {
  --tone: var(--ok);
  --tone-soft: var(--ok-soft);
  border-top: 4px solid var(--tone);
}

.tone-busy {
  --tone: var(--info);
  --tone-soft: var(--info-soft);
}

.tone-warn {
  --tone: var(--warn);
  --tone-soft: var(--warn-soft);
}

.tone-danger {
  --tone: var(--danger);
  --tone-soft: var(--danger-soft);
}

.status-hero {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.status-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 14px;
  background: var(--tone-soft);
  color: var(--tone);
}

.status-main {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 0.15rem;
  color: var(--text-2);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.phase {
  margin: 0 0 0.3rem;
  font-size: 1.1875rem;
  line-height: 1.35;
}

.help {
  margin: 0 0 0.6rem;
  color: var(--text-2);
}

.pending {
  margin: 0;
  font-weight: 600;
}

.pending.none {
  font-weight: 500;
  color: var(--text-2);
}

.uptodate {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0.5rem 0 0;
  color: var(--ok);
  font-weight: 600;
  font-size: 0.9375rem;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
  margin: 1.25rem 0 0;
}

.stat {
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.stat dt {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-2);
  font-size: 0.8125rem;
  font-weight: 600;
}

.stat dd {
  margin: 0.2rem 0 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.tech {
  margin-top: 0.9rem;
  font-size: 0.875rem;
}

.tech summary {
  cursor: pointer;
  color: var(--text-2);
  font-weight: 600;
}

.tech p {
  margin: 0.4rem 0 0;
  font-family: var(--mono);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}

.note {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.9rem;
}

.note svg {
  margin-top: 0.15rem;
  color: var(--text-3);
}

.attention {
  border-color: color-mix(in srgb, var(--warn) 45%, var(--border));
  background: linear-gradient(var(--warn-soft), var(--surface) 5rem);
}

.section-title .badge {
  margin-left: 0.15rem;
}

.notice {
  border-top: 1px solid var(--border);
  padding-top: 1rem;
}

.notice:first-child {
  border-top: 0;
  padding-top: 0;
}

.notice p {
  margin-bottom: 0.5rem;
}

.conflict-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.compare {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.6rem;
  margin: 0.6rem 0 0.75rem;
}

.side {
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.side.kept {
  border-color: color-mix(in srgb, var(--ok) 45%, var(--border));
  background: var(--ok-soft);
}

.side-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  margin: 0 0 0.3rem;
  color: var(--text-2);
  font-size: 0.8125rem;
  font-weight: 650;
}

.kept-badge {
  font-size: 0.75rem;
  padding: 0.05rem 0.45rem;
}

.side-value {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.conflict .details {
  margin-bottom: 0.75rem;
}

.queue-empty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ok);
}

.queue-empty p {
  margin: 0;
}

.queue {
  position: relative;
  display: grid;
  gap: 0;
}

.op {
  position: relative;
  display: flex;
  gap: 0.85rem;
  padding: 0.25rem 0 1rem;
}

.op:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 0.95rem;
  top: 2.25rem;
  bottom: 0.25rem;
  width: 2px;
  background: var(--border);
}

.op-dot {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  background: var(--info-soft);
  color: var(--info);
}

.op-retry_wait .op-dot {
  background: var(--warn-soft);
  color: var(--warn);
}

.op-blocked .op-dot {
  background: var(--danger-soft);
  color: var(--danger);
}

.op-body {
  flex: 1;
  min-width: 0;
  padding-top: 0.2rem;
}

.op-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.op-head strong {
  overflow-wrap: anywhere;
}

.op-body p {
  margin: 0.25rem 0 0;
}

.op-error {
  color: var(--danger);
}

.op-body .row {
  margin-top: 0.6rem;
}

.history summary {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  cursor: pointer;
  font-weight: 650;
}

.history summary svg {
  color: var(--text-3);
}

.history ul {
  margin: 0.75rem 0 0;
  color: var(--text-2);
}

@media (max-width: 640px) {
  .status-icon {
    width: 2.75rem;
    height: 2.75rem;
  }

  .phase {
    font-size: 1.0625rem;
  }
}
</style>
