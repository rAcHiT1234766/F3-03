<script setup lang="ts">
import { computed, ref } from 'vue'
import { requireSession } from '../auth'
import SyncBadge from '../components/SyncBadge.vue'
import { useJobList } from '../composables/useJobs'
import { JOB_STATUSES, STATUS_LABELS, type JobStatus, type LocalJob } from '../domain'
import { formatDueDate, jobSyncState } from '../ui'

const s = requireSession()
const data = useJobList(s.db)
const search = ref('')
const status = ref<JobStatus | ''>('')

const STATUS_ORDER: Record<JobStatus, number> = { in_progress: 0, scheduled: 1, completed: 2 }

function matches(job: LocalJob, needle: string): boolean {
  if (!needle) return true
  const f = job.view.fields
  return [f.title, f.customerName, f.siteAddress, f.description, f.notes].some((t) =>
    t.toLowerCase().includes(needle),
  )
}

// Search and filtering run on local records only; no network involved.
const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return data.value.jobs
    .filter((j) => !j.view.deleted && (!status.value || j.view.fields.status === status.value))
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
const activeCount = computed(() => data.value.jobs.filter((j) => !j.view.deleted).length)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Jobs</h1>
      <RouterLink class="btn btn-primary" to="/jobs/new">New job</RouterLink>
    </div>

    <div class="filters" role="search">
      <div class="field">
        <label for="search">Search</label>
        <input
          id="search"
          v-model="search"
          type="search"
          placeholder="Title, customer, address, notes…"
        />
      </div>
      <div class="field">
        <label for="status-filter">Status</label>
        <select id="status-filter" v-model="status">
          <option value="">All statuses</option>
          <option v-for="st in JOB_STATUSES" :key="st" :value="st">{{ STATUS_LABELS[st] }}</option>
        </select>
      </div>
    </div>

    <p v-if="!data.loaded" class="muted">Loading jobs from this device…</p>
    <template v-else>
      <p class="muted small" aria-live="polite">
        Showing {{ visible.length }} of {{ activeCount }} jobs stored on this device.
      </p>
      <div v-if="activeCount === 0" class="card">
        <p>No jobs on this device yet.</p>
        <p class="muted small">Create one, or connect and sync to download this account's jobs.</p>
      </div>
      <p v-else-if="visible.length === 0" class="card">No jobs match your search.</p>
      <ul v-else class="plain stack" data-testid="job-list">
        <li v-for="job in visible" :key="job.id" class="card job">
          <div class="job-head">
            <RouterLink :to="`/jobs/${job.id}`" class="job-title">{{
              job.view.fields.title
            }}</RouterLink>
            <SyncBadge :state="jobSyncState(job, data.opsByJob.get(job.id) ?? [])" />
          </div>
          <p class="muted small job-meta">
            {{ job.view.fields.customerName }}
            <template v-if="job.view.fields.siteAddress">
              · {{ job.view.fields.siteAddress }}</template
            >
          </p>
          <div class="row small">
            <span class="badge">{{ STATUS_LABELS[job.view.fields.status] }}</span>
            <span class="badge">Priority: {{ job.view.fields.priority }}</span>
            <span class="muted">{{ formatDueDate(job.view.fields.dueDate) }}</span>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: 1fr minmax(10rem, 14rem);
  gap: 0 1rem;
}

@media (max-width: 520px) {
  .filters {
    grid-template-columns: 1fr;
  }
}

.job-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
}

.job-title {
  font-weight: 700;
  font-size: 1.05rem;
  overflow-wrap: anywhere;
}

.job-meta {
  margin: 0.2rem 0 0.5rem;
  overflow-wrap: anywhere;
}
</style>
