<script setup lang="ts">
import { ChevronLeft, CircleAlert, CloudOff, Flag, Pencil, RefreshCw, Trash } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { requireSession } from '../auth'
import EmptyState from '../components/EmptyState.vue'
import StatusDot from '../components/StatusDot.vue'
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
  jobRef,
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
const statusIndex = computed(() => (fields.value ? JOB_STATUSES.indexOf(fields.value.status) : 0))

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
      <header class="sheet-head">
        <div class="head-main">
          <p class="eyebrow">Job sheet · Ref {{ jobRef(id) }}</p>
          <h1>{{ fields.title }}</h1>
          <p class="head-line">
            {{ fields.customerName
            }}<template v-if="fields.siteAddress"> · {{ fields.siteAddress }}</template>
          </p>
          <div class="head-tags">
            <StatusPill :status="fields.status" />
            <SyncBadge :state="syncState" />
          </div>
        </div>
        <div class="head-actions">
          <RouterLink class="btn" :to="`/jobs/${id}/edit`"><Pencil :size="16" />Edit</RouterLink>
          <button class="btn btn-danger" type="button" @click="remove">
            <Trash :size="16" />Delete
          </button>
        </div>
      </header>

      <p v-if="error" class="banner banner-danger" role="alert">
        <CircleAlert :size="18" /><span class="banner-body">{{ error }}</span>
      </p>

      <div class="sheet-grid">
        <div class="sheet-main">
          <section class="card" aria-labelledby="status-h">
            <div class="card-head">
              <h2 id="status-h" class="section-title">Status</h2>
              <span class="saved-note">Saved on this device instantly</span>
            </div>
            <!-- The pressed step sits on a block of its colour that slides between steps. -->
            <div
              class="stepper"
              :class="`at-${fields.status}`"
              :style="{ '--i': statusIndex }"
              role="group"
              aria-label="Job status"
            >
              <span class="stepper-thumb" aria-hidden="true" />
              <button
                v-for="st in JOB_STATUSES"
                :key="st"
                type="button"
                class="step"
                :aria-pressed="fields.status === st"
                :disabled="busy"
                @click="setStatus(st)"
              >
                <StatusDot :status="st" :size="13" />{{ STATUS_LABELS[st] }}
              </button>
            </div>
          </section>

          <section class="card" aria-labelledby="work-h">
            <h2 id="work-h" class="section-title">Work</h2>
            <h3 class="block-label">{{ FIELD_LABELS.description }}</h3>
            <p class="block-text" :class="{ empty: !fields.description }">
              {{ fields.description || 'No description.' }}
            </p>
            <h3 class="block-label">{{ FIELD_LABELS.notes }}</h3>
            <p class="block-text notes" data-testid="job-notes">{{ fields.notes || '—' }}</p>
          </section>
        </div>

        <aside class="sheet-side">
          <section class="card" aria-labelledby="info-h">
            <h2 id="info-h" class="section-title">Job info</h2>
            <dl class="facts">
              <div>
                <dt>{{ FIELD_LABELS.customerName }}</dt>
                <dd>{{ fields.customerName }}</dd>
              </div>
              <div>
                <dt>{{ FIELD_LABELS.siteAddress }}</dt>
                <dd>{{ fields.siteAddress || '—' }}</dd>
              </div>
              <div>
                <dt>{{ FIELD_LABELS.priority }}</dt>
                <dd :class="`prio-${fields.priority}`">
                  <Flag v-if="fields.priority === 'high'" :size="14" />{{
                    PRIORITY_LABELS[fields.priority]
                  }}
                </dd>
              </div>
              <div>
                <dt>{{ FIELD_LABELS.dueDate }}</dt>
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
            <h2 id="sync-h" class="section-title">Sync</h2>
            <dl class="facts">
              <div>
                <dt>Server copy</dt>
                <dd>
                  <template v-if="job.shadow">Revision {{ job.shadow.revision }}</template>
                  <template v-else>Not yet confirmed by the server</template>
                </dd>
              </div>
              <div v-if="job.shadow">
                <dt>Confirmed</dt>
                <dd class="mono small">{{ formatDateTime(job.shadow.updatedAt) }}</dd>
              </div>
              <div>
                <dt>Waiting</dt>
                <dd :class="{ pending: data.ops.length }">
                  {{ data.ops.length ? pluralize(data.ops.length, 'change') : 'Nothing to sync' }}
                </dd>
              </div>
            </dl>
            <p v-if="data.ops.length" class="small sync-link">
              <RouterLink to="/sync">See sync details</RouterLink>
            </p>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ---------- Head ---------- */

/* The sheet's printed header: title block, then a heavy rule. */
.sheet-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem 1.5rem;
  margin-bottom: 1.5rem;
  padding-bottom: 1.25rem;
  border-bottom: 2px solid var(--text);
}

.head-main {
  min-width: 0;
  flex: 1 1 24rem;
}

.sheet-head h1 {
  margin-bottom: 0.45rem;
  overflow-wrap: anywhere;
}

.head-line {
  margin: 0;
  color: var(--text-2);
  font-size: 1.0625rem;
  overflow-wrap: anywhere;
}

.head-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.9rem;
}

.head-actions {
  display: flex;
  gap: 0.5rem;
}

/* ---------- Body ---------- */

.sheet-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}

@media (min-width: 900px) {
  .sheet-grid {
    grid-template-columns: minmax(0, 1.65fr) minmax(18rem, 1fr);
    gap: 1.25rem;
  }
}

.saved-note {
  color: var(--text-3);
  font-size: 0.8125rem;
  white-space: nowrap;
}

/* ---------- Status stepper ---------- */

.stepper {
  --gap: 4px;
  --tone: var(--st-scheduled);
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--gap);
  padding: var(--gap);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.at-in_progress {
  --tone: var(--st-progress);
}

.at-completed {
  --tone: var(--st-done);
}

.stepper-thumb {
  position: absolute;
  top: var(--gap);
  bottom: var(--gap);
  left: var(--gap);
  width: calc((100% - 4 * var(--gap)) / 3);
  border-radius: var(--radius-sm);
  background: var(--tone);
  box-shadow: 0 2px 0 color-mix(in srgb, var(--tone) 55%, #000);
  transform: translateX(calc(var(--i, 0) * (100% + var(--gap))));
  transition:
    transform var(--dur-3) var(--ease-out),
    background-color var(--dur-3) var(--ease),
    box-shadow var(--dur-3) var(--ease);
}

.step {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 3.25rem;
  padding: 0.5rem 0.6rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    color var(--dur-2) var(--ease) 60ms,
    background-color var(--dur-1) var(--ease);
}

.step:hover:not([aria-pressed='true'], :disabled) {
  background: var(--surface-3);
  color: var(--text);
}

.step[aria-pressed='true'] {
  color: var(--on-tone);
}

.step:disabled {
  cursor: progress;
}

.step:focus-visible {
  outline-offset: 3px;
}

/* ---------- Work ---------- */

.block-label {
  margin: 1.1rem 0 0.4rem;
  color: var(--text-2);
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.section-title + .block-label {
  margin-top: 0;
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

/* Notes are written on ruled paper with a margin line. */
.notes {
  --line: 1.75rem;
  min-height: calc(var(--line) * 3 + 0.5rem);
  padding: 0.25rem 0.9rem 0.25rem 1.6rem;
  line-height: var(--line);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background:
    linear-gradient(
        90deg,
        transparent 0.85rem,
        color-mix(in srgb, var(--accent) 55%, transparent) 0.85rem,
        color-mix(in srgb, var(--accent) 55%, transparent) calc(0.85rem + 1.5px),
        transparent calc(0.85rem + 1.5px)
      )
      no-repeat,
    repeating-linear-gradient(
        transparent 0,
        transparent calc(var(--line) - 1px),
        var(--border) calc(var(--line) - 1px),
        var(--border) var(--line)
      )
      0 -1px / 100% var(--line),
    var(--surface-2);
}

/* ---------- Facts ---------- */

.facts {
  display: grid;
  margin: 0;
}

.facts > div {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.6rem 0;
  border-top: 1px dashed var(--border);
}

.facts > div:first-child {
  padding-top: 0;
  border-top: 0;
}

.facts dt {
  padding-top: 0.2rem;
  color: var(--text-3);
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.facts dd.prio-high {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--danger);
  font-weight: 600;
}

.facts dd.prio-low {
  color: var(--text-2);
}

.facts dd.pending {
  color: var(--info);
  font-weight: 600;
}

.due-rel {
  display: inline-block;
  margin-left: 0.35rem;
  padding: 0 0.35rem;
  border: 1px solid currentcolor;
  border-radius: var(--radius-xs);
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1.5;
  text-transform: uppercase;
  vertical-align: 0.1em;
}

.due-overdue {
  color: var(--danger);
}

.due-today {
  color: var(--accent-ink);
}

.due-soon {
  color: var(--text-2);
}

.sync-link {
  margin: 0.75rem 0 0;
}

@media (max-width: 640px) {
  .head-actions {
    width: 100%;
  }

  .head-actions .btn {
    flex: 1;
  }

  .saved-note {
    display: none;
  }

  .step {
    flex-direction: column;
    gap: 0.3rem;
    min-height: 3.75rem;
    font-size: 0.875rem;
  }
}

@media (forced-colors: active) {
  .stepper-thumb {
    forced-color-adjust: none;
    background: Highlight;
  }

  .step[aria-pressed='true'] {
    forced-color-adjust: none;
    color: HighlightText;
  }
}
</style>
