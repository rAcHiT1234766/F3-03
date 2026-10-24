<script setup lang="ts">
import {
  Building,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  CloudOff,
  Flag,
  MapPin,
  NotebookPen,
  Pencil,
  RefreshCw,
  Trash,
  Wrench,
} from '@lucide/vue'
import { computed, ref, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { requireSession } from '../auth'
import EmptyState from '../components/EmptyState.vue'
import StatusPill from '../components/StatusPill.vue'
import SyncBadge from '../components/SyncBadge.vue'
import { useJob } from '../composables/useJobs'
import { confirmAction } from '../dialog'
import { FIELD_LABELS, JOB_STATUSES, STATUS_LABELS, type JobStatus } from '../domain'
import { deleteJob, editJob } from '../jobs'
import {
  PRIORITY_LABELS,
  announce,
  describeDue,
  formatDateTime,
  formatDueDate,
  jobSyncState,
  pluralize,
} from '../ui'

const props = defineProps<{ id: string }>()
const s = requireSession()
const router = useRouter()
const data = useJob(s.db, () => props.id)
const error = ref<string | null>(null)
const busy = ref(false)

const job = computed(() => data.value.job)
const fields = computed(() => job.value?.view.fields)
const syncState = computed(() => (job.value ? jobSyncState(job.value, data.value.ops) : 'pending'))
const due = computed(() =>
  fields.value ? describeDue(fields.value.dueDate, fields.value.status) : null,
)

const STATUS_ICONS: Record<JobStatus, Component> = {
  scheduled: CalendarClock,
  in_progress: Wrench,
  completed: CircleCheck,
}

async function setStatus(status: JobStatus) {
  if (!job.value || job.value.view.fields.status === status) return
  error.value = null
  busy.value = true
  try {
    const base = job.value.view.fields
    await editJob(s, props.id, base, { ...base, status })
    announce(`Status set to ${STATUS_LABELS[status]}. Saved on this device.`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!job.value) return
  const confirmed = await confirmAction({
    title: `Delete “${job.value.view.fields.title}”?`,
    message:
      'It is removed from this device now, and from every device once the deletion syncs. This cannot be undone.',
    confirmLabel: 'Delete job',
    danger: true,
  })
  if (!confirmed) return
  error.value = null
  try {
    await deleteJob(s, props.id)
    announce('Job deleted on this device. The deletion will sync.')
    await router.replace('/jobs')
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <div class="page">
    <RouterLink to="/jobs" class="back-link"><ChevronLeft :size="18" />All jobs</RouterLink>
    <p v-if="!data.loaded" class="muted delayed">Loading…</p>

    <EmptyState v-else-if="!job" :icon="CloudOff" title="Job not on this device" :heading-level="1">
      <p>
        This job has not been downloaded to this device yet, or it no longer exists. When you are
        online, syncing will download any jobs this account can see.
      </p>
      <template #actions>
        <button class="btn btn-primary" type="button" @click="s.sync.retryNow()">
          <RefreshCw :size="16" />Sync now
        </button>
      </template>
    </EmptyState>

    <EmptyState
      v-else-if="job.view.deleted"
      :icon="Trash"
      :title="job.view.fields.title"
      :heading-level="1"
    >
      <p>This job has been deleted.</p>
      <p v-if="data.ops.length" class="banner banner-warn">
        <CircleAlert :size="18" />
        <span class="banner-body">
          This device still holds {{ pluralize(data.ops.length, 'change') }} for it. See the
          <RouterLink to="/sync">Sync center</RouterLink> for what happens to them.
        </span>
      </p>
    </EmptyState>

    <template v-else-if="fields">
      <header class="detail-head">
        <div class="head-main">
          <div class="row head-badges">
            <StatusPill :status="fields.status" />
            <SyncBadge :state="syncState" />
          </div>
          <h1>{{ fields.title }}</h1>
          <p class="head-line">
            <span><Building :size="16" />{{ fields.customerName }}</span>
            <span v-if="fields.siteAddress"><MapPin :size="16" />{{ fields.siteAddress }}</span>
          </p>
        </div>
        <div class="row head-actions">
          <RouterLink class="btn" :to="`/jobs/${id}/edit`"><Pencil :size="16" />Edit</RouterLink>
          <button class="btn btn-danger" type="button" @click="remove">
            <Trash :size="16" />Delete
          </button>
        </div>
      </header>

      <p v-if="error" class="banner banner-danger" role="alert">
        <CircleAlert :size="18" /><span class="banner-body">{{ error }}</span>
      </p>

      <div class="detail-grid">
        <div class="detail-main">
          <section class="card" aria-labelledby="progress-h">
            <div class="card-head">
              <h2 id="progress-h">Progress</h2>
              <span class="small muted">Saved on this device instantly</span>
            </div>
            <div class="status-switch" role="group" aria-label="Job status">
              <button
                v-for="st in JOB_STATUSES"
                :key="st"
                type="button"
                class="status-option"
                :class="`opt-${st}`"
                :aria-pressed="fields.status === st"
                :disabled="busy"
                @click="setStatus(st)"
              >
                <component :is="STATUS_ICONS[st]" :size="18" />
                {{ STATUS_LABELS[st] }}
              </button>
            </div>
          </section>

          <section class="card" aria-labelledby="details-h">
            <h2 id="details-h" class="section-title"><NotebookPen :size="18" />Details</h2>
            <h3 class="block-label">{{ FIELD_LABELS.description }}</h3>
            <p class="block-text" :class="{ empty: !fields.description }">
              {{ fields.description || 'No description.' }}
            </p>
            <h3 class="block-label">{{ FIELD_LABELS.notes }}</h3>
            <p class="block-text notes" data-testid="job-notes">{{ fields.notes || '—' }}</p>
          </section>
        </div>

        <aside class="detail-side">
          <section class="card" aria-labelledby="info-h">
            <h2 id="info-h">Job info</h2>
            <dl class="info">
              <div>
                <dt><Building :size="16" />{{ FIELD_LABELS.customerName }}</dt>
                <dd>{{ fields.customerName }}</dd>
              </div>
              <div>
                <dt><MapPin :size="16" />{{ FIELD_LABELS.siteAddress }}</dt>
                <dd>{{ fields.siteAddress || '—' }}</dd>
              </div>
              <div>
                <dt><Flag :size="16" />{{ FIELD_LABELS.priority }}</dt>
                <dd :class="{ high: fields.priority === 'high' }">
                  {{ PRIORITY_LABELS[fields.priority] }}
                </dd>
              </div>
              <div>
                <dt><CalendarDays :size="16" />{{ FIELD_LABELS.dueDate }}</dt>
                <dd>
                  {{ formatDueDate(fields.dueDate) }}
                  <span
                    v-if="
                      due && (due.tone === 'overdue' || due.tone === 'today' || due.tone === 'soon')
                    "
                    class="due-rel"
                    :class="`due-${due.tone}`"
                    >{{ due.text }}</span
                  >
                </dd>
              </div>
            </dl>
          </section>

          <section class="card" aria-labelledby="sync-h">
            <h2 id="sync-h" class="section-title"><RefreshCw :size="18" />Sync</h2>
            <p v-if="data.ops.length" class="small">
              {{ pluralize(data.ops.length, 'change') }} saved on this device and waiting to sync.
              <RouterLink to="/sync">See sync details</RouterLink>
            </p>
            <p class="muted small sync-note">
              <template v-if="job.shadow">
                Last confirmed by the server: revision {{ job.shadow.revision }},
                {{ formatDateTime(job.shadow.updatedAt) }}.
              </template>
              <template v-else>Not yet confirmed by the server.</template>
            </p>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem 1.5rem;
  margin-bottom: 1.5rem;
}

.head-main {
  min-width: 0;
  flex: 1 1 24rem;
}

.head-badges {
  margin-bottom: 0.6rem;
}

.detail-head h1 {
  margin-bottom: 0.4rem;
  overflow-wrap: anywhere;
}

.head-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1.25rem;
  margin: 0;
  color: var(--text-2);
}

.head-line span {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  overflow-wrap: anywhere;
}

.head-line svg {
  color: var(--text-3);
}

.detail-grid {
  display: grid;
  gap: 0.875rem;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}

@media (min-width: 900px) {
  .detail-grid {
    grid-template-columns: minmax(0, 1.65fr) minmax(18rem, 1fr);
  }
}

.status-switch {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.status-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 4.75rem;
  padding: 0.75rem 0.5rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-2);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.15s var(--ease),
    border-color 0.15s var(--ease),
    color 0.15s var(--ease);
}

.status-option:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text);
  background: var(--surface-3);
}

.status-option:disabled {
  cursor: progress;
}

.opt-scheduled[aria-pressed='true'] {
  background: var(--st-scheduled-soft);
  border-color: var(--st-scheduled);
  color: var(--st-scheduled);
}

.opt-in_progress[aria-pressed='true'] {
  background: var(--st-progress-soft);
  border-color: var(--st-progress);
  color: var(--st-progress);
}

.opt-completed[aria-pressed='true'] {
  background: var(--st-done-soft);
  border-color: var(--st-done);
  color: var(--st-done);
}

.status-option[aria-pressed='true'] {
  box-shadow: inset 0 0 0 1px currentcolor;
}

.block-label {
  margin: 1rem 0 0.3rem;
  color: var(--text-2);
  font-size: 0.8125rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.section-title + .block-label {
  margin-top: 0.75rem;
}

.block-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.6;
}

.block-text.empty {
  color: var(--text-3);
}

.notes {
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.info {
  display: grid;
  gap: 0.9rem;
  margin: 0.75rem 0 0;
}

.info dt {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-2);
  font-size: 0.8125rem;
  font-weight: 600;
}

.info dt svg {
  color: var(--text-3);
}

.info dd {
  margin: 0.15rem 0 0 1.4rem;
  overflow-wrap: anywhere;
}

.info dd.high {
  color: var(--danger);
  font-weight: 600;
}

.due-rel {
  display: inline-block;
  margin-left: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 650;
}

.due-overdue {
  color: var(--danger);
}

.due-today,
.due-soon {
  color: var(--warn);
}

.sync-note {
  margin-bottom: 0;
}

@media (max-width: 640px) {
  .head-actions {
    width: 100%;
  }

  .head-actions .btn {
    flex: 1;
  }

  .status-option {
    min-height: 4.25rem;
    font-size: 0.875rem;
  }
}

@media (forced-colors: active) {
  .status-option[aria-pressed='true'] {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
}
</style>
