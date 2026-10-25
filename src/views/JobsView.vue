<script setup lang="ts">
import { ChevronRight, ClipboardList, Plus, Search, SearchX, X } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { requireSession } from '../auth'
import EmptyState from '../components/EmptyState.vue'
import JobMeta from '../components/JobMeta.vue'
import StatusPill from '../components/StatusPill.vue'
import SyncBadge from '../components/SyncBadge.vue'
import { useJobList } from '../composables/useJobs'
import { JOB_STATUSES, STATUS_LABELS, type JobStatus, type LocalJob } from '../domain'
import { describeDue, jobRef, jobSyncState } from '../ui'

const s = requireSession()
const data = useJobList(s.db)
const search = ref('')
const status = ref<JobStatus | ''>('')
const searchInput = ref<HTMLInputElement | null>(null)

const today = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
}).format(new Date())

const STATUS_ORDER: Record<JobStatus, number> = { in_progress: 0, scheduled: 1, completed: 2 }

function matches(job: LocalJob, needle: string): boolean {
  if (!needle) return true
  const f = job.view.fields
  return [f.title, f.customerName, f.siteAddress, f.description, f.notes].some((t) =>
    t.toLowerCase().includes(needle),
  )
}

const active = computed(() => data.value.jobs.filter((j) => !j.view.deleted))
const counts = computed(() => {
  const result: Record<JobStatus, number> = { scheduled: 0, in_progress: 0, completed: 0 }
  for (const job of active.value) result[job.view.fields.status]++
  return result
})
const overdue = computed(
  () =>
    active.value.filter(
      (j) => describeDue(j.view.fields.dueDate, j.view.fields.status).tone === 'overdue',
    ).length,
)

// Search and filtering run on local records only; no network involved.
const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return active.value
    .filter((j) => !status.value || j.view.fields.status === status.value)
    .filter((j) => matches(j, needle))
    .sort((a, b) => {
      const fa = a.view.fields
      const fb = b.view.fields
      return (
        STATUS_ORDER[fa.status] - STATUS_ORDER[fb.status] ||
        (fa.dueDate ?? '9999').localeCompare(fb.dueDate ?? '9999') ||
        fa.title.localeCompare(fb.title)
      )
    })
})
const activeCount = computed(() => active.value.length)

function clearSearch() {
  search.value = ''
  searchInput.value?.focus()
}

function resetFilters() {
  search.value = ''
  status.value = ''
}

// "/" jumps to the search box, unless the user is already typing somewhere.
function onKeydown(event: KeyboardEvent) {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return
  event.preventDefault()
  searchInput.value?.focus()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="page jobs-page">
    <div class="page-head">
      <div class="head-title">
        <p class="eyebrow">{{ today }}</p>
        <h1>Jobs</h1>
        <p class="page-sub">
          <template v-if="data.loaded && activeCount">
            {{ counts.in_progress }} in progress · {{ counts.scheduled }} scheduled
            <template v-if="overdue">
              · <span class="overdue-note">{{ overdue }} overdue</span></template
            >
          </template>
          <template v-else>Your jobs, stored on this device and synced when online.</template>
        </p>
      </div>
      <div class="head-actions">
        <div class="search" role="search">
          <label for="search" class="sr-only">Search</label>
          <div class="input-icon">
            <Search :size="18" />
            <input
              id="search"
              ref="searchInput"
              v-model="search"
              type="search"
              placeholder="Search title, customer, notes…"
              autocomplete="off"
            />
            <kbd v-if="!search" class="kbd-hint" aria-hidden="true">/</kbd>
            <button v-else class="btn btn-ghost btn-icon clear" type="button" @click="clearSearch">
              <X :size="16" /><span class="sr-only">Clear search</span>
            </button>
          </div>
        </div>
        <RouterLink class="btn btn-primary new-job" to="/jobs/new">
          <Plus :size="18" :stroke-width="2.5" />New job
        </RouterLink>
      </div>
    </div>

    <fieldset class="tabs status-filter">
      <legend class="sr-only">Status</legend>
      <label>
        <input v-model="status" type="radio" name="status-filter" value="" />
        All <span class="tab-count">{{ activeCount }}</span>
      </label>
      <label v-for="st in JOB_STATUSES" :key="st">
        <input v-model="status" type="radio" name="status-filter" :value="st" />
        {{ STATUS_LABELS[st] }} <span class="tab-count">{{ counts[st] }}</span>
      </label>
    </fieldset>

    <div v-if="!data.loaded" class="ledger delayed" aria-hidden="true">
      <div v-for="n in 4" :key="n" class="skeleton-row">
        <div class="skeleton" style="width: 6.5rem; height: 1.25rem" />
        <div>
          <div class="skeleton" style="width: 55%; height: 1.1rem" />
          <div class="skeleton" style="width: 35%; height: 0.9rem; margin-top: 0.45rem" />
        </div>
      </div>
    </div>
    <p v-if="!data.loaded" class="sr-only">Loading jobs from this device…</p>
    <template v-else>
      <p class="result-count" aria-live="polite">
        Showing {{ visible.length }} of {{ activeCount }} jobs stored on this device.
      </p>
      <EmptyState v-if="activeCount === 0" :icon="ClipboardList" title="No jobs yet">
        <p>No jobs on this device yet.</p>
        <p class="small">Create one, or connect and sync to download this account's jobs.</p>
        <template #actions>
          <RouterLink class="btn btn-primary" to="/jobs/new">
            <Plus :size="18" :stroke-width="2.5" />Create a job
          </RouterLink>
        </template>
      </EmptyState>
      <EmptyState v-else-if="visible.length === 0" :icon="SearchX" title="No matching jobs">
        <p>No jobs match your search.</p>
        <template #actions>
          <button class="btn" type="button" @click="resetFilters">Clear search and filter</button>
        </template>
      </EmptyState>
      <div v-else class="ledger">
        <!-- Column heads for the wide layout; each row is still read as a list item. -->
        <div class="ledger-head" aria-hidden="true">
          <span>Status</span><span>Job</span><span>Due</span><span>Priority</span><span>Sync</span>
        </div>
        <ul class="plain" data-testid="job-list">
          <li
            v-for="(job, i) in visible"
            :key="job.id"
            class="job"
            :class="`job-${job.view.fields.status}`"
            :style="{ '--i': Math.min(i, 8) }"
          >
            <div class="job-status">
              <StatusPill :status="job.view.fields.status" />
              <span class="job-ref" aria-hidden="true">Ref {{ jobRef(job.id) }}</span>
            </div>
            <div class="job-main">
              <h2 class="job-title">
                <RouterLink :to="`/jobs/${job.id}`" class="job-link">{{
                  job.view.fields.title
                }}</RouterLink>
              </h2>
              <p class="job-sub">
                {{ job.view.fields.customerName
                }}<template v-if="job.view.fields.siteAddress">
                  · {{ job.view.fields.siteAddress }}</template
                >
              </p>
            </div>
            <div class="job-meta">
              <JobMeta :fields="job.view.fields" />
            </div>
            <div class="job-sync">
              <SyncBadge :state="jobSyncState(job, data.opsByJob.get(job.id) ?? [])" quiet />
            </div>
            <ChevronRight :size="18" class="job-go" />
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ---------- Head ---------- */

.page-head {
  align-items: flex-end;
  margin-bottom: 1.5rem;
}

.overdue-note {
  color: var(--danger);
  font-weight: 650;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.search {
  width: 23rem;
  max-width: 100%;
}

.search input {
  padding-right: 2.75rem;
}

.search input::-webkit-search-cancel-button {
  display: none;
}

.kbd-hint {
  position: absolute;
  right: 0.65rem;
  top: 50%;
  transform: translateY(-50%);
  min-width: 1.4rem;
  padding: 0.05rem 0.35rem;
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: var(--radius-xs);
  color: var(--text-2);
  font-family: var(--mono);
  font-size: 0.75rem;
  line-height: 1.3;
  text-align: center;
  pointer-events: none;
}

.search input:focus + .kbd-hint {
  visibility: hidden;
}

.clear {
  position: absolute;
  right: 0.3rem;
  top: 50%;
  transform: translateY(-50%);
  min-height: 2.1rem;
  min-width: 2.1rem;
  padding: 0.25rem;
  color: var(--text-2);
}

.clear:active:not(:disabled) {
  transform: translateY(-50%);
}

.new-job :deep(svg) {
  transition: transform var(--dur-2) var(--ease-out);
}

.new-job:hover :deep(svg) {
  transform: rotate(90deg);
}

/* ---------- Filter and count ---------- */

.status-filter {
  margin-bottom: 0;
}

.result-count {
  margin: 0.85rem 0 0.75rem;
  color: var(--text-3);
  font-family: var(--mono);
  font-size: 0.75rem;
}

/* ---------- Ledger ---------- */

/* One ruled sheet; each job is a line on it. */
.ledger {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.ledger-head {
  display: none;
}

.job {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'status sync'
    'main go'
    'meta meta';
  align-items: center;
  gap: 0.4rem 0.75rem;
  padding: 0.95rem 1rem 1rem 1.15rem;
  border-top: 1px solid var(--border);
  transition: background-color var(--dur-1) var(--ease);
  animation: settle var(--dur-3) var(--ease-out) backwards;
  animation-delay: calc(var(--i, 0) * 32ms);
}

.job:first-child {
  border-top: 0;
}

/* A marker slides in along the edge of the line under the pointer. */
.job::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent);
  transform: scaleY(0);
  transition: transform var(--dur-2) var(--ease-out);
}

.job:hover {
  background: var(--surface-2);
}

.job:hover::before {
  transform: scaleY(1);
}

.job-status {
  grid-area: status;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}

.job-ref {
  color: var(--text-3);
  font-family: var(--mono);
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.job-main {
  grid-area: main;
  min-width: 0;
}

.job-title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 650;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.job-completed .job-title {
  font-weight: 600;
}

.job-link {
  color: var(--text);
  text-decoration: underline;
  text-decoration-color: transparent;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.18em;
  transition: text-decoration-color var(--dur-1) var(--ease);
}

.job:hover .job-link {
  color: var(--text);
  text-decoration-color: var(--accent);
}

/* The title link covers the whole line, so the line is one large touch target. */
.job-link::after {
  content: '';
  position: absolute;
  inset: 0;
}

.job-link:focus-visible {
  outline: none;
}

.job-link:focus-visible::after {
  outline: 3px solid var(--focus);
  outline-offset: -3px;
}

.job-sub {
  margin: 0.15rem 0 0;
  color: var(--text-2);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}

.job-meta {
  grid-area: meta;
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 1rem;
  padding-top: 0.1rem;
}

.job-sync {
  grid-area: sync;
  justify-self: end;
}

.job-go {
  grid-area: go;
  color: var(--text-3);
  transition:
    transform var(--dur-2) var(--ease-out),
    color var(--dur-1) var(--ease);
}

.job:hover .job-go {
  color: var(--text);
  transform: translateX(3px);
}

.skeleton-row {
  display: grid;
  gap: 0.75rem;
  padding: 1rem 1.15rem;
  border-top: 1px solid var(--border);
}

.skeleton-row:first-child {
  border-top: 0;
}

/* Wide screens: a ledger with columns. */
@media (min-width: 1024px) {
  .ledger-head,
  .job,
  .skeleton-row {
    display: grid;
    grid-template-columns: 8.5rem minmax(0, 1fr) 9.25rem 8.75rem 10.5rem 1.125rem;
    grid-template-areas: none;
    column-gap: 1.25rem;
    align-items: center;
  }

  .ledger-head {
    padding: 0.55rem 1rem 0.5rem 1.25rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-3);
    font-family: var(--mono);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .job {
    padding: 0.85rem 1rem 0.85rem 1.25rem;
  }

  .job > * {
    grid-area: auto;
  }

  .job-status {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
  }

  /* Due date and priority fill their own columns. */
  .job-meta {
    display: contents;
  }

  .job-sync {
    justify-self: start;
  }

  .skeleton-row {
    padding: 1rem 1.25rem;
  }
}

/* ---------- Phones ---------- */

@media (max-width: 640px) {
  .jobs-page {
    padding-bottom: 5.5rem;
  }

  /* The head does not slide in here: a moving ancestor would carry the fixed button with it. */
  .jobs-page > .page-head {
    animation: none;
  }

  .head-title {
    animation: settle var(--dur-3) var(--ease-out) backwards;
  }

  .head-actions,
  .search {
    width: 100%;
  }

  .page-head {
    margin-bottom: 1rem;
  }

  /* All four filters fit across the screen (count over label), instead of a scrolling strip that
     hides "Completed" past the edge with nothing to say it is there. */
  .status-filter {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .status-filter label {
    flex-direction: column;
    justify-content: flex-start;
    gap: 0.3rem;
    padding: 0.5rem 0.2rem 0.6rem;
    font-size: 0.875rem;
    font-stretch: var(--condensed);
    line-height: 1.15;
    text-align: center;
    white-space: normal;
  }

  .status-filter .tab-count {
    order: -1;
  }

  /* Floating action button above the tab bar. */
  .new-job {
    position: fixed;
    right: 1rem;
    bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 1rem);
    z-index: 15;
    min-height: 3.25rem;
    padding: 0.75rem 1.2rem;
    border-radius: var(--radius);
    box-shadow:
      0 2px 0 var(--edge),
      0 14px 28px -10px rgb(0 0 0 / 50%);
    animation: fab-in var(--dur-3) var(--ease-out) 150ms backwards;
  }

  .new-job:active:not(:disabled) {
    box-shadow:
      0 0 0 var(--edge),
      0 8px 18px -10px rgb(0 0 0 / 50%);
  }

  .job {
    padding: 0.9rem 0.9rem 0.95rem 1rem;
  }
}

@keyframes fab-in {
  from {
    transform: translateY(12px) scale(0.92);
  }
}

/* The shortcut hint is for keyboards: hidden on touch screens and phone widths. */
@media (hover: none), (pointer: coarse), (max-width: 640px) {
  .kbd-hint {
    display: none;
  }
}

@media (forced-colors: active) {
  .job-link:focus-visible::after {
    outline-color: Highlight;
  }

  .job::before {
    background: Highlight;
  }
}
</style>
