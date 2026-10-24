<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { requireSession } from '../auth'
import { useJob } from '../composables/useJobs'
import {
  FIELD_KEYS,
  FIELD_LABELS,
  JOB_PRIORITIES,
  JOB_STATUSES,
  STATUS_LABELS,
  TEXT_LIMITS,
  emptyFields,
  type FieldErrors,
  type FieldKey,
  type JobFields,
} from '../domain'
import { NotEditableError, ValidationError, createJob, editJob } from '../jobs'
import { announce, hasUnsavedDraft } from '../ui'

const props = defineProps<{ id?: string }>()
const s = requireSession()
const router = useRouter()
const isNew = !props.id

// `initial` is what the editor started from; `draft` is unsaved form state. Neither is the
// persisted record, which stays in Dexie until an explicit Save.
const initial = ref<JobFields | null>(isNew ? emptyFields() : null)
const draft = reactive<JobFields>(emptyFields())
const errors = ref<FieldErrors>({})
const saveError = ref<string | null>(null)
const saving = ref(false)
const missing = ref(false)
let leaving = false

const stored = props.id ? useJob(s.db, () => props.id!) : null

onMounted(async () => {
  if (!props.id) return
  const job = await s.db.jobs.get(props.id)
  if (!job || job.view.deleted) {
    missing.value = true
    return
  }
  initial.value = { ...job.view.fields }
  Object.assign(draft, job.view.fields)
})

const dirty = computed(
  () => !!initial.value && FIELD_KEYS.some((k) => draft[k] !== initial.value![k]),
)
watch(dirty, (value) => (hasUnsavedDraft.value = value), { immediate: true })

/** Fields changed elsewhere (sync or another tab) since this form opened. */
const changedElsewhere = computed(() => {
  const latest = stored?.value.job?.view.fields
  if (!latest || !initial.value) return [] as FieldKey[]
  return FIELD_KEYS.filter((k) => latest[k] !== initial.value![k])
})
const changedElsewhereLabels = computed(() =>
  changedElsewhere.value.map((k) => FIELD_LABELS[k]).join(', '),
)

const onBeforeUnload = (e: BeforeUnloadEvent) => {
  if (dirty.value && !leaving) e.preventDefault()
}
window.addEventListener('beforeunload', onBeforeUnload)
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  hasUnsavedDraft.value = false
})
onBeforeRouteLeave(() => leaving || !dirty.value || confirm('Discard your unsaved changes?'))

const dueDateModel = computed({
  get: () => draft.dueDate ?? '',
  set: (v: string) => (draft.dueDate = v || null),
})

function describedBy(key: FieldKey, hint = false) {
  return (
    [errors.value[key] ? `${key}-error` : '', hint ? `${key}-hint` : '']
      .filter(Boolean)
      .join(' ') || undefined
  )
}

async function focusFirstError() {
  await nextTick()
  const key = FIELD_KEYS.find((k) => errors.value[k])
  if (key) document.getElementById(`f-${key}`)?.focus()
}

async function save() {
  if (!initial.value) return
  errors.value = {}
  saveError.value = null
  saving.value = true
  try {
    let jobId = props.id
    let message = 'Saved on this device — pending sync.'
    if (isNew) {
      jobId = await createJob(s, { ...draft })
    } else if ((await editJob(s, props.id!, initial.value, { ...draft })) === 'unchanged') {
      message = 'No changes to save.'
    }
    announce(message)
    leaving = true
    await router.replace(`/jobs/${jobId}`)
  } catch (e) {
    if (e instanceof ValidationError) {
      errors.value = e.errors
      await focusFirstError()
    } else {
      // NotEditableError or LocalSaveError: the form keeps everything the user typed.
      saveError.value = (e as Error).message
      if (!(e instanceof NotEditableError)) announce(saveError.value)
    }
  } finally {
    saving.value = false
  }
}

function cancel() {
  void router.back()
}
</script>

<template>
  <div class="page">
    <p><RouterLink :to="isNew ? '/jobs' : `/jobs/${id}`">← Back</RouterLink></p>
    <div v-if="missing" class="card">
      <h1>Job not available</h1>
      <p>This job is not on this device or has been deleted, so it cannot be edited.</p>
    </div>
    <form v-else-if="initial" novalidate @submit.prevent="save">
      <div class="page-head">
        <h1>{{ isNew ? 'New job' : 'Edit job' }}</h1>
        <span v-if="dirty" class="badge badge-warn" role="status">Unsaved changes</span>
      </div>

      <p v-if="changedElsewhere.length" class="banner banner-warn" role="status">
        This job changed elsewhere after you opened it ({{ changedElsewhereLabels }}). Saving
        changes only the fields you edited; other fields keep their latest values.
      </p>
      <p v-if="saveError" class="banner banner-danger" role="alert" data-testid="save-error">
        {{ saveError }}
      </p>

      <div class="card">
        <div class="field">
          <label for="f-title">Title</label>
          <input
            id="f-title"
            v-model="draft.title"
            :maxlength="TEXT_LIMITS.title[1]"
            required
            :aria-invalid="!!errors.title"
            :aria-describedby="describedBy('title')"
          />
          <p v-if="errors.title" id="title-error" class="error-text">{{ errors.title }}</p>
        </div>
        <div class="field-grid">
          <div class="field">
            <label for="f-customerName">Customer</label>
            <input
              id="f-customerName"
              v-model="draft.customerName"
              :maxlength="TEXT_LIMITS.customerName[1]"
              required
              :aria-invalid="!!errors.customerName"
              :aria-describedby="describedBy('customerName')"
            />
            <p v-if="errors.customerName" id="customerName-error" class="error-text">
              {{ errors.customerName }}
            </p>
          </div>
          <div class="field">
            <label for="f-siteAddress">Site address</label>
            <input
              id="f-siteAddress"
              v-model="draft.siteAddress"
              :maxlength="TEXT_LIMITS.siteAddress[1]"
              :aria-invalid="!!errors.siteAddress"
              :aria-describedby="describedBy('siteAddress')"
            />
            <p v-if="errors.siteAddress" id="siteAddress-error" class="error-text">
              {{ errors.siteAddress }}
            </p>
          </div>
        </div>
        <div class="field-grid">
          <div class="field">
            <label for="f-status">Status</label>
            <select id="f-status" v-model="draft.status" :aria-describedby="describedBy('status')">
              <option v-for="st in JOB_STATUSES" :key="st" :value="st">
                {{ STATUS_LABELS[st] }}
              </option>
            </select>
            <p v-if="errors.status" id="status-error" class="error-text">{{ errors.status }}</p>
          </div>
          <div class="field">
            <label for="f-priority">Priority</label>
            <select
              id="f-priority"
              v-model="draft.priority"
              :aria-describedby="describedBy('priority')"
            >
              <option v-for="p in JOB_PRIORITIES" :key="p" :value="p">{{ p }}</option>
            </select>
            <p v-if="errors.priority" id="priority-error" class="error-text">
              {{ errors.priority }}
            </p>
          </div>
          <div class="field">
            <label for="f-dueDate">Due date (optional)</label>
            <input
              id="f-dueDate"
              v-model="dueDateModel"
              type="date"
              :aria-invalid="!!errors.dueDate"
              :aria-describedby="describedBy('dueDate')"
            />
            <p v-if="errors.dueDate" id="dueDate-error" class="error-text">{{ errors.dueDate }}</p>
          </div>
        </div>
        <div class="field">
          <label for="f-description">Description</label>
          <textarea
            id="f-description"
            v-model="draft.description"
            :maxlength="TEXT_LIMITS.description[1]"
            :aria-invalid="!!errors.description"
            :aria-describedby="describedBy('description')"
          />
          <p v-if="errors.description" id="description-error" class="error-text">
            {{ errors.description }}
          </p>
        </div>
        <div class="field">
          <label for="f-notes">Notes</label>
          <textarea
            id="f-notes"
            v-model="draft.notes"
            rows="6"
            :maxlength="TEXT_LIMITS.notes[1]"
            :aria-invalid="!!errors.notes"
            :aria-describedby="describedBy('notes', true)"
          />
          <p id="notes-hint" class="hint">
            Notes sync as one field: if two devices change notes at the same time, one version is
            kept and the other is shown in the Sync center.
          </p>
          <p v-if="errors.notes" id="notes-error" class="error-text">{{ errors.notes }}</p>
        </div>
      </div>

      <div class="row actions">
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <button class="btn" type="button" @click="cancel">Cancel</button>
      </div>
    </form>
    <p v-else class="muted">Loading…</p>
  </div>
</template>

<style scoped>
.actions {
  margin-top: 1rem;
}
</style>
