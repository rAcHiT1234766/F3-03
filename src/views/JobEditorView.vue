<script setup lang="ts">
import {
  ArrowDown,
  Briefcase,
  CalendarClock,
  Check,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  Flag,
  NotebookPen,
  TriangleAlert,
  Wrench,
} from '@lucide/vue'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type Component,
} from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { requireSession } from '../auth'
import EmptyState from '../components/EmptyState.vue'
import { useJob } from '../composables/useJobs'
import { confirmAction } from '../dialog'
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
  type JobPriority,
  type JobStatus,
} from '../domain'
import { ValidationError, createJob, editJob } from '../jobs'
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
onBeforeRouteLeave(
  () =>
    leaving ||
    !dirty.value ||
    confirmAction({
      title: 'Discard your unsaved changes?',
      message: 'What you typed in this form has not been saved.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true,
    }),
)

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
  if (!key) return
  const target =
    document.getElementById(`f-${key}`) ??
    document.querySelector<HTMLInputElement>(`input[name="f-${key}"]:checked`)
  target?.focus()
}

/** "123 / 2,000" counters; highlighted near the limit. */
function counter(key: 'description' | 'notes') {
  const max = TEXT_LIMITS[key][1]
  const used = draft[key].length
  return { text: `${used.toLocaleString()} / ${max.toLocaleString()}`, near: used > max * 0.9 }
}

const PRIORITY_SHORT: Record<JobPriority, string> = { low: 'Low', normal: 'Normal', high: 'High' }

const STATUS_ICONS: Record<JobStatus, Component> = {
  scheduled: CalendarClock,
  in_progress: Wrench,
  completed: CircleCheck,
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
      // The role="alert" banner announces the message.
      saveError.value = (e as Error).message
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
  <div class="page container-narrow editor">
    <RouterLink :to="isNew ? '/jobs' : `/jobs/${id}`" class="back-link"
      ><ChevronLeft :size="18" />Back</RouterLink
    >
    <EmptyState v-if="missing" :icon="CircleAlert" title="Job not available" :heading-level="1">
      <p>This job is not on this device or has been deleted, so it cannot be edited.</p>
    </EmptyState>
    <form v-else-if="initial" novalidate @submit.prevent="save">
      <div class="page-head">
        <div>
          <h1>{{ isNew ? 'New job' : 'Edit job' }}</h1>
          <p class="page-sub">Saved on this device first, then synced when you are online.</p>
        </div>
        <span v-if="dirty" class="badge badge-warn" role="status">Unsaved changes</span>
      </div>

      <p v-if="changedElsewhere.length" class="banner banner-warn" role="status">
        <TriangleAlert :size="18" />
        <span class="banner-body">
          This job changed elsewhere after you opened it ({{ changedElsewhereLabels }}). Saving
          changes only the fields you edited; other fields keep their latest values.
        </span>
      </p>
      <p v-if="saveError" class="banner banner-danger" role="alert" data-testid="save-error">
        <CircleAlert :size="18" />
        <span class="banner-body">{{ saveError }}</span>
      </p>

      <section class="card" aria-labelledby="sec-job">
        <h2 id="sec-job" class="section-title"><Briefcase :size="18" />Job</h2>
        <div class="field">
          <div class="label-row">
            <label for="f-title">Title</label>
            <span class="req" aria-hidden="true">Required</span>
          </div>
          <input
            id="f-title"
            v-model="draft.title"
            :maxlength="TEXT_LIMITS.title[1]"
            required
            placeholder="e.g. Boiler annual service"
            :aria-invalid="!!errors.title"
            :aria-describedby="describedBy('title')"
          />
          <p v-if="errors.title" id="title-error" class="error-text">
            <CircleAlert :size="15" />{{ errors.title }}
          </p>
        </div>
        <div class="field-grid">
          <div class="field">
            <div class="label-row">
              <label for="f-customerName">Customer</label>
              <span class="req" aria-hidden="true">Required</span>
            </div>
            <input
              id="f-customerName"
              v-model="draft.customerName"
              :maxlength="TEXT_LIMITS.customerName[1]"
              required
              autocomplete="organization"
              :aria-invalid="!!errors.customerName"
              :aria-describedby="describedBy('customerName')"
            />
            <p v-if="errors.customerName" id="customerName-error" class="error-text">
              <CircleAlert :size="15" />{{ errors.customerName }}
            </p>
          </div>
          <div class="field">
            <label for="f-siteAddress">Site address</label>
            <input
              id="f-siteAddress"
              v-model="draft.siteAddress"
              :maxlength="TEXT_LIMITS.siteAddress[1]"
              autocomplete="street-address"
              :aria-invalid="!!errors.siteAddress"
              :aria-describedby="describedBy('siteAddress')"
            />
            <p v-if="errors.siteAddress" id="siteAddress-error" class="error-text">
              <CircleAlert :size="15" />{{ errors.siteAddress }}
            </p>
          </div>
        </div>
      </section>

      <section class="card" aria-labelledby="sec-schedule">
        <h2 id="sec-schedule" class="section-title">
          <CalendarClock :size="18" />Status and schedule
        </h2>
        <fieldset class="field choice" :aria-describedby="describedBy('status')">
          <legend class="label">Status</legend>
          <div class="segmented">
            <label v-for="st in JOB_STATUSES" :key="st">
              <input v-model="draft.status" type="radio" name="f-status" :value="st" />
              <component :is="STATUS_ICONS[st]" :size="16" />{{ STATUS_LABELS[st] }}
            </label>
          </div>
          <p v-if="errors.status" id="status-error" class="error-text">
            <CircleAlert :size="15" />{{ errors.status }}
          </p>
        </fieldset>
        <div class="field-grid">
          <fieldset class="field choice" :aria-describedby="describedBy('priority')">
            <legend class="label">Priority</legend>
            <div class="segmented">
              <label v-for="p in JOB_PRIORITIES" :key="p" :class="`prio-${p}`">
                <input v-model="draft.priority" type="radio" name="f-priority" :value="p" />
                <ArrowDown v-if="p === 'low'" :size="16" /><Flag v-else :size="16" />{{
                  PRIORITY_SHORT[p]
                }}
              </label>
            </div>
            <p v-if="errors.priority" id="priority-error" class="error-text">
              <CircleAlert :size="15" />{{ errors.priority }}
            </p>
          </fieldset>
          <div class="field">
            <label for="f-dueDate">Due date (optional)</label>
            <input
              id="f-dueDate"
              v-model="dueDateModel"
              type="date"
              :aria-invalid="!!errors.dueDate"
              :aria-describedby="describedBy('dueDate')"
            />
            <p v-if="errors.dueDate" id="dueDate-error" class="error-text">
              <CircleAlert :size="15" />{{ errors.dueDate }}
            </p>
          </div>
        </div>
      </section>

      <section class="card" aria-labelledby="sec-details">
        <h2 id="sec-details" class="section-title"><NotebookPen :size="18" />Work details</h2>
        <div class="field">
          <div class="label-row">
            <label for="f-description">Description</label>
            <span
              class="counter"
              :class="{ near: counter('description').near }"
              aria-hidden="true"
              >{{ counter('description').text }}</span
            >
          </div>
          <textarea
            id="f-description"
            v-model="draft.description"
            :maxlength="TEXT_LIMITS.description[1]"
            placeholder="What needs doing on site?"
            :aria-invalid="!!errors.description"
            :aria-describedby="describedBy('description')"
          />
          <p v-if="errors.description" id="description-error" class="error-text">
            <CircleAlert :size="15" />{{ errors.description }}
          </p>
        </div>
        <div class="field">
          <div class="label-row">
            <label for="f-notes">Notes</label>
            <span class="counter" :class="{ near: counter('notes').near }" aria-hidden="true">{{
              counter('notes').text
            }}</span>
          </div>
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
          <p v-if="errors.notes" id="notes-error" class="error-text">
            <CircleAlert :size="15" />{{ errors.notes }}
          </p>
        </div>
      </section>

      <div class="actions">
        <button class="btn btn-primary" type="submit" :disabled="saving">
          <Check :size="18" />{{ saving ? 'Saving…' : 'Save' }}
        </button>
        <button class="btn" type="button" @click="cancel">Cancel</button>
      </div>
    </form>
    <p v-else class="muted delayed">Loading…</p>
  </div>
</template>

<style scoped>
.editor .page-head {
  align-items: flex-start;
}

.choice {
  border: 0;
  padding: 0;
  margin-inline: 0;
}

.choice legend {
  margin-bottom: 0.35rem;
}

.choice .segmented label {
  flex: 1 1 0;
}

.prio-high:has(input:checked) {
  color: var(--danger);
}

.card .field:last-child {
  margin-bottom: 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1.25rem;
}

.actions .btn {
  min-width: 8rem;
}

@media (max-width: 640px) {
  .actions .btn {
    flex: 1 1 100%;
    min-height: 3rem;
  }
}
</style>
