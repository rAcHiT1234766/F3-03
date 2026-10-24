<script setup lang="ts">
import { Building, ClipboardList, MapPin, Plus, Search, SearchX, X } from '@lucide/vue'
import { computed, ref } from 'vue'
import { requireSession } from '../auth'
import EmptyState from '../components/EmptyState.vue'
import JobMeta from '../components/JobMeta.vue'
import StatusPill from '../components/StatusPill.vue'
import SyncBadge from '../components/SyncBadge.vue'
import { useJobList } from '../composables/useJobs'
import { JOB_STATUSES, STATUS_LABELS, type JobStatus, type LocalJob } from '../domain'
import { describeDue, jobSyncState } from '../ui'

const s = requireSession()
const data = useJobList(s.db)
const search = ref('')
const status = ref<JobStatus | ''>('')
const searchInput = ref<HTMLInputElement | null>(null)

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
</script>

<template>
  <div class="page jobs-page">
    <div class="page-head">
      <div>
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
      <RouterLink class="btn btn-primary new-job" to="/jobs/new">
        <Plus :size="18" />New job
      </RouterLink>
    </div>

    <div class="toolbar" role="search">
      <div class="field search-field">
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
          <button
            v-if="search"
            class="btn btn-ghost btn-icon clear"
            type="button"
            @click="clearSearch"
          >
            <X :size="16" /><span class="sr-only">Clear search</span>
          </button>
        </div>
      </div>
      <fieldset class="segmented status-filter">
        <legend class="sr-only">Status</legend>
        <label>
          <input v-model="status" type="radio" name="status-filter" value="" />
          All <span class="seg-count">{{ activeCount }}</span>
        </label>
        <label v-for="st in JOB_STATUSES" :key="st">
          <input v-model="status" type="radio" name="status-filter" :value="st" />
          {{ STATUS_LABELS[st] }} <span class="seg-count">{{ counts[st] }}</span>
        </label>
      </fieldset>
    </div>

    <div v-if="!data.loaded" class="job-grid delayed" aria-hidden="true">
      <div v-for="n in 3" :key="n" class="card job skeleton-card">
        <div class="skeleton" style="width: 6rem; height: 1.4rem" />
        <div class="skeleton" style="width: 70%; height: 1.3rem; margin-top: 0.9rem" />
        <div class="skeleton" style="width: 45%; height: 1rem; margin-top: 0.6rem" />
        <div class="skeleton" style="width: 55%; height: 1rem; margin-top: 0.4rem" />
      </div>
    </div>
    <p v-if="!data.loaded" class="sr-only">Loading jobs from this device…</p>
    <template v-else>
      <p class="muted small result-count" aria-live="polite">
        Showing {{ visible.length }} of {{ activeCount }} jobs stored on this device.
      </p>
      <EmptyState v-if="activeCount === 0" :icon="ClipboardList" title="No jobs yet">
        <p>No jobs on this device yet.</p>
        <p class="small">Create one, or connect and sync to download this account's jobs.</p>
        <template #actions>
          <RouterLink class="btn btn-primary" to="/jobs/new">
            <Plus :size="18" />Create a job
          </RouterLink>
        </template>
      </EmptyState>
      <EmptyState v-else-if="visible.length === 0" :icon="SearchX" title="No matching jobs">
        <p>No jobs match your search.</p>
        <template #actions>
          <button class="btn" type="button" @click="resetFilters">Clear search and filter</button>
        </template>
      </EmptyState>
      <ul v-else class="plain job-grid" data-testid="job-list">
        <li
          v-for="job in visible"
          :key="job.id"
          class="card job"
          :class="`job-${job.view.fields.status}`"
        >
          <div class="job-top">
            <StatusPill :status="job.view.fields.status" />
            <SyncBadge :state="jobSyncState(job, data.opsByJob.get(job.id) ?? [])" quiet />
          </div>
          <h2 class="job-title">
            <RouterLink :to="`/jobs/${job.id}`" class="job-link">{{
              job.view.fields.title
            }}</RouterLink>
          </h2>
          <p class="job-line">
            <Building :size="15" /><span>{{ job.view.fields.customerName }}</span>
          </p>
          <p v-if="job.view.fields.siteAddress" class="job-line">
            <MapPin :size="15" /><span>{{ job.view.fields.siteAddress }}</span>
          </p>
          <div class="job-foot">
            <JobMeta :fields="job.view.fields" />
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.overdue-note {
  color: var(--danger);
  font-weight: 650;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.search-field {
  flex: 1 1 18rem;
  margin: 0;
}

.search-field input {
  padding-right: 2.75rem;
}

.search-field input::-webkit-search-cancel-button {
  display: none;
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

.status-filter {
  flex: 0 1 auto;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
}

.result-count {
  margin: 0.75rem 0;
}

.job-grid {
  display: grid;
  gap: 0.875rem;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
}

.job-grid > .card + .card {
  margin-top: 0;
}

.job {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 1.1rem 1.15rem 1rem;
  border-left: 4px solid var(--border-strong);
  transition:
    border-color 0.15s var(--ease),
    box-shadow 0.15s var(--ease),
    transform 0.15s var(--ease);
}

.job-in_progress {
  border-left-color: var(--st-progress);
}

.job-scheduled {
  border-left-color: var(--st-scheduled);
}

.job-completed {
  border-left-color: var(--st-done);
}

.job:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-1px);
}

/* The title link covers the whole card, so the card is one large touch target. */

.job-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.job-title {
  margin: 0 0 0.2rem;
  font-size: 1.0625rem;
  font-weight: 650;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.job-link {
  color: var(--text);
  text-decoration: none;
}

.job-link::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

/* The focus ring is drawn on the card-sized overlay, so it outlines the whole card. */
.job-link:focus-visible {
  outline: none;
}

.job-link:focus-visible::after {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

.job:hover .job-link {
  color: var(--accent);
}

.job-line {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin: 0;
  color: var(--text-2);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.job-line svg {
  margin-top: 0.2rem;
  color: var(--text-3);
}

.job-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  margin-top: auto;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}

.skeleton-card {
  min-height: 9.5rem;
}

@media (max-width: 640px) {
  .jobs-page {
    padding-bottom: 5rem;
  }

  /* Extended floating action button above the tab bar. */
  .new-job {
    position: fixed;
    right: 1rem;
    bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 1rem);
    z-index: 15;
    min-height: 3.25rem;
    padding: 0.75rem 1.25rem;
    border-radius: 999px;
    box-shadow: var(--shadow-lg);
  }

  .status-filter {
    flex-basis: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}

@media (forced-colors: active) {
  .job-link:focus-visible::after {
    outline-color: Highlight;
  }
}
</style>
