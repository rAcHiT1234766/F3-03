<script setup lang="ts">
import { ArrowDown, Check, ChevronLeft, CircleAlert, Flag, TriangleAlert } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { requireSession } from '../auth'
import EmptyState from '../components/EmptyState.vue'
import StatusDot from '../components/StatusDot.vue'
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
} from '../domain'
import { ValidationError, createJob, editJob } from '../jobs'
import { announce, hasUnsavedDraft, jobRef } from '../ui'

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
          <p class="eyebrow">{{ isNew ? 'New entry' : `Job sheet · Ref ${jobRef(id!)}` }}</p>
          <h1>{{ isNew ? 'New job' : 'Edit job' }}</h1>
          <p class="page-sub">Saved on this device first, then synced when you are online.</p>
        </div>
        <span v-if="dirty" class="unsaved" role="status">Unsaved changes</span>
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

      <!-- One sheet in three numbered parts, like a printed job form. -->
      <div class="card form-sheet">
        <section class="part" aria-labelledby="sec-job">
          <div class="part-intro">
            <h2 id="sec-job" class="part-title">
              <span class="part-num" aria-hidden="true">01</span>Job
            </h2>
            <p class="part-note">What the job is and who it is for.</p>
          </div>
          <div class="part-fields">
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
          </div>
        </section>

        <section class="part" aria-labelledby="sec-schedule">
          <div class="part-intro">
            <h2 id="sec-schedule" class="part-title">
              <span class="part-num" aria-hidden="true">02</span>Status and schedule
            </h2>
            <p class="part-note">Where it stands and when it is due.</p>
          </div>
          <div class="part-fields">
            <fieldset class="field choice status-choice" :aria-describedby="describedBy('status')">
              <legend class="label">Status</legend>
              <div class="segmented">
                <label v-for="st in JOB_STATUSES" :key="st" class="tone-choice" :class="`st-${st}`">
                  <input v-model="draft.status" type="radio" name="f-status" :value="st" />
                  <StatusDot :status="st" :size="12" />{{ STATUS_LABELS[st] }}
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
                  <label
                    v-for="p in JOB_PRIORITIES"
                    :key="p"
                    :class="[`prio-${p}`, { 'tone-choice': p === 'high' }]"
                  >
                    <input v-model="draft.priority" type="radio" name="f-priority" :value="p" />
                    <ArrowDown v-if="p === 'low'" :size="15" /><Flag
                      v-else-if="p === 'high'"
                      :size="15"
                    />{{ PRIORITY_SHORT[p] }}
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
          </div>
        </section>

        <section class="part" aria-labelledby="sec-details">
          <div class="part-intro">
            <h2 id="sec-details" class="part-title">
              <span class="part-num" aria-hidden="true">03</span>Work details
            </h2>
            <p class="part-note">What needs doing, and anything worth knowing on site.</p>
          </div>
          <div class="part-fields">
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
                class="ruled"
                rows="6"
                :maxlength="TEXT_LIMITS.notes[1]"
                :aria-invalid="!!errors.notes"
                :aria-describedby="describedBy('notes', true)"
              />
              <p id="notes-hint" class="hint">
                Notes sync as one field: if two devices change notes at the same time, one version
                is kept and the other is shown in the Sync center.
              </p>
              <p v-if="errors.notes" id="notes-error" class="error-text">
                <CircleAlert :size="15" />{{ errors.notes }}
              </p>
            </div>
          </div>
        </section>
      </div>

      <div class="actions">
        <button class="btn btn-primary save" type="submit" :disabled="saving">
          <Check :size="18" :stroke-width="2.5" />{{ saving ? 'Saving…' : 'Save' }}
        </button>
        <button class="btn" type="button" @click="cancel">Cancel</button>
      </div>
    </form>
    <p v-else class="muted delayed">Loading…</p>
  </div>
</template>

<style scoped>
.editor .page-head {
  align-items: flex-end;
}

/* A live "unsaved" tag with a slowly breathing dot. */
.unsaved {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border));
  border-radius: var(--radius-xs);
  background: var(--warn-soft);
  color: var(--warn);
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  animation: tag-in var(--dur-2) var(--ease-out);
}

.unsaved::before {
  content: '';
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: currentcolor;
  animation: breathe 1.8s var(--ease) infinite;
}

@keyframes tag-in {
  from {
    transform: translateY(4px);
  }
}

@keyframes breathe {
  50% {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--warn) 22%, transparent);
  }
}

/* ---------- The sheet ---------- */

.form-sheet {
  padding: 0;
}

.part {
  display: grid;
  gap: 0.25rem 2rem;
  padding: 1.5rem 1.5rem 1.6rem;
}

.part + .part {
  border-top: 1px solid var(--border);
}

@media (min-width: 760px) {
  .part {
    grid-template-columns: 11rem minmax(0, 1fr);
  }
}

.part-title {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  margin: 0 0 0.35rem;
  font-size: 1.0625rem;
  font-weight: 650;
}

.part-num {
  color: var(--accent-ink);
  font-family: var(--mono);
  font-size: 0.8125rem;
  font-weight: 600;
}

.part-note {
  margin: 0 0 1rem;
  color: var(--text-3);
  font-size: 0.875rem;
}

/* Side-by-side fields space their rows with a gap, so they stay apart when they stack. */
.part-fields .field-grid {
  row-gap: 1.2rem;
  margin-bottom: 1.2rem;
}

.part-fields .field-grid > .field {
  margin-bottom: 0;
}

.part-fields > :last-child {
  margin-bottom: 0;
}

/* ---------- Choices ---------- */

.choice {
  border: 0;
  padding: 0;
  margin-inline: 0;
}

.choice legend {
  margin-bottom: 0.4rem;
}

.choice .segmented label {
  flex: 1 1 0;
}

/* The chosen status takes its own colour, as on the job sheet; a high priority is printed red. */
.st-scheduled {
  --tone: var(--st-scheduled);
}

.st-in_progress {
  --tone: var(--st-progress);
}

.st-completed {
  --tone: var(--st-done);
}

.prio-high {
  --tone: var(--danger);
}

.prio-high:hover {
  color: var(--danger);
}

.segmented .tone-choice:has(input:checked) {
  background: var(--tone);
  color: var(--on-tone);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--tone) 55%, #000);
}

/* ---------- Notes on ruled paper ---------- */

.ruled {
  --line: 1.75rem;
  padding-top: 0.3rem;
  padding-bottom: 0.3rem;
  line-height: var(--line);
  background:
    repeating-linear-gradient(
        transparent 0,
        transparent calc(var(--line) - 1px),
        var(--border) calc(var(--line) - 1px),
        var(--border) var(--line)
      )
      0 0 / 100% var(--line),
    var(--surface);
  background-attachment: local;
}

/* ---------- Actions ---------- */

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1.25rem;
}

.actions .btn {
  min-width: 8rem;
}

.actions .save {
  min-width: 10rem;
}

@media (max-width: 640px) {
  .part {
    padding: 1.15rem 1rem 1.25rem;
  }

  /* Three statuses in one row: the dot sits above the word, as on the job sheet. */
  .status-choice .segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }

  .status-choice .segmented label {
    flex-direction: column;
    gap: 0.3rem;
    min-height: 3.5rem;
    padding: 0.5rem 0.3rem;
    white-space: normal;
    text-align: center;
  }

  .actions .btn {
    flex: 1 1 100%;
    min-height: 3rem;
  }
}

@media (forced-colors: active) {
  .segmented .tone-choice:has(input:checked) {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
}
</style>
