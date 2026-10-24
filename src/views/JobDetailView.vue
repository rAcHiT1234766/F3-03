<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { requireSession } from '../auth'
import SyncBadge from '../components/SyncBadge.vue'
import { useJob } from '../composables/useJobs'
import { FIELD_LABELS, JOB_STATUSES, STATUS_LABELS, type JobStatus } from '../domain'
import { deleteJob, editJob } from '../jobs'
import { announce, formatDateTime, formatDueDate, jobSyncState, pluralize } from '../ui'

const props = defineProps<{ id: string }>()
const s = requireSession()
const router = useRouter()
const data = useJob(s.db, () => props.id)
const error = ref<string | null>(null)
const busy = ref(false)

const job = computed(() => data.value.job)
const fields = computed(() => job.value?.view.fields)
const syncState = computed(() => (job.value ? jobSyncState(job.value, data.value.ops) : 'pending'))

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
  if (
    !confirm(
      `Delete “${job.value.view.fields.title}”? This removes it from every device once synced.`,
    )
  )
    return
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
    <p><RouterLink to="/jobs">← All jobs</RouterLink></p>
    <p v-if="!data.loaded" class="muted">Loading…</p>

    <div v-else-if="!job" class="card">
      <h1>Job not on this device</h1>
      <p>
        This job has not been downloaded to this device yet, or it no longer exists. When you are
        online, syncing will download any jobs this account can see.
      </p>
      <button class="btn" type="button" @click="s.sync.retryNow()">Sync now</button>
    </div>

    <div v-else-if="job.view.deleted" class="card">
      <h1>{{ job.view.fields.title }}</h1>
      <p>This job has been deleted.</p>
      <p v-if="data.ops.length" class="banner banner-warn">
        This device still holds {{ pluralize(data.ops.length, 'change') }} for it. See the
        <RouterLink to="/sync">Sync center</RouterLink> for what happens to them.
      </p>
    </div>

    <template v-else-if="fields">
      <div class="page-head">
        <h1>{{ fields.title }}</h1>
        <div class="row">
          <RouterLink class="btn" :to="`/jobs/${id}/edit`">Edit</RouterLink>
          <button class="btn btn-danger" type="button" @click="remove">Delete</button>
        </div>
      </div>

      <p v-if="error" class="banner banner-danger" role="alert">{{ error }}</p>

      <section class="card" aria-labelledby="progress-h">
        <h2 id="progress-h">Progress</h2>
        <div class="row" role="group" aria-label="Job status">
          <button
            v-for="st in JOB_STATUSES"
            :key="st"
            type="button"
            class="btn"
            :class="{ 'btn-primary': fields.status === st }"
            :aria-pressed="fields.status === st"
            :disabled="busy"
            @click="setStatus(st)"
          >
            {{ STATUS_LABELS[st] }}
          </button>
        </div>
      </section>

      <section class="card" aria-labelledby="details-h">
        <h2 id="details-h">Details</h2>
        <dl class="details">
          <dt>{{ FIELD_LABELS.customerName }}</dt>
          <dd>{{ fields.customerName }}</dd>
          <dt>{{ FIELD_LABELS.siteAddress }}</dt>
          <dd>{{ fields.siteAddress || '—' }}</dd>
          <dt>{{ FIELD_LABELS.priority }}</dt>
          <dd>{{ fields.priority }}</dd>
          <dt>{{ FIELD_LABELS.dueDate }}</dt>
          <dd>{{ formatDueDate(fields.dueDate) }}</dd>
          <dt>{{ FIELD_LABELS.description }}</dt>
          <dd>{{ fields.description || '—' }}</dd>
          <dt>{{ FIELD_LABELS.notes }}</dt>
          <dd data-testid="job-notes">{{ fields.notes || '—' }}</dd>
        </dl>
      </section>

      <section class="card" aria-labelledby="sync-h">
        <h2 id="sync-h">Sync</h2>
        <p class="row"><SyncBadge :state="syncState" /></p>
        <p v-if="data.ops.length" class="small">
          {{ pluralize(data.ops.length, 'change') }} saved on this device and waiting to sync.
          <RouterLink to="/sync">Details</RouterLink>
        </p>
        <p class="muted small">
          <template v-if="job.shadow">
            Last confirmed by the server: revision {{ job.shadow.revision }},
            {{ formatDateTime(job.shadow.updatedAt) }}.
          </template>
          <template v-else>Not yet confirmed by the server.</template>
        </p>
      </section>
    </template>
  </div>
</template>
