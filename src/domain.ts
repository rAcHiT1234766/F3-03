// Domain contracts shared by forms, local commands, sync payloads and remote parsing.
// Kept free of Firebase/Dexie imports so the same rules apply everywhere.

export const PROTOCOL_VERSION = 1
export const SCHEMA_VERSION = 1

export const JOB_STATUSES = ['scheduled', 'in_progress', 'completed'] as const
export const JOB_PRIORITIES = ['low', 'normal', 'high'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]
export type JobPriority = (typeof JOB_PRIORITIES)[number]

export type JobFields = {
  title: string
  customerName: string
  siteAddress: string
  description: string
  notes: string
  status: JobStatus
  priority: JobPriority
  dueDate: string | null // calendar date YYYY-MM-DD, never a timestamp
}
export type FieldKey = keyof JobFields
export type FieldValue = JobFields[FieldKey]

export const FIELD_KEYS: readonly FieldKey[] = [
  'title',
  'customerName',
  'siteAddress',
  'description',
  'notes',
  'status',
  'priority',
  'dueDate',
]

export const FIELD_LABELS: Record<FieldKey, string> = {
  title: 'Title',
  customerName: 'Customer',
  siteAddress: 'Site address',
  description: 'Description',
  notes: 'Notes',
  status: 'Status',
  priority: 'Priority',
  dueDate: 'Due date',
}

export const STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
}

// [min, max] lengths in UTF-16 code units. Firestore rules count characters,
// which is never more than this, so client-valid text always passes the rules.
export const TEXT_LIMITS = {
  title: [1, 120],
  customerName: [1, 120],
  siteAddress: [0, 300],
  description: [0, 2000],
  notes: [0, 4000],
} as const satisfies Partial<Record<FieldKey, readonly [number, number]>>

type TextKey = keyof typeof TEXT_LIMITS
const TEXT_KEYS = Object.keys(TEXT_LIMITS) as TextKey[]

/** Canonical job as confirmed by the server. `updatedAt` is the server commit time in ms. */
export type JobSnapshot = {
  schemaVersion: 1
  id: string
  ownerId: string
  fields: JobFields
  deleted: boolean
  revision: number // per-job, transaction-controlled; the only ordering authority
  lastOpId: string
  updatedAt: number
}

export type JobView = { fields: JobFields; deleted: boolean }

export type LocalJob = {
  id: string
  shadow: JobSnapshot | null // last confirmed server snapshot; null until the create is acknowledged
  view: JobView // shadow + outstanding operations, rebuilt transactionally
  localVersion: number
  localUpdatedAt: number
}

export type OperationKind = 'create' | 'patch' | 'delete'

export type OperationPayload = {
  protocolVersion: 1
  opId: string
  ownerId: string
  deviceId: string
  jobId: string
  kind: OperationKind
  baseRevision: number | null // diagnostic only
  baseValues: Partial<JobFields>
  patch: Partial<JobFields>
  after: JobFields // full intended state, used by the staged record-LWW resolver
  clientCreatedAt: number
}

export type OutboxState = 'pending' | 'sending' | 'retry_wait' | 'blocked'

export type OutboxRow = {
  sequence?: number // allocated by IndexedDB inside the save transaction
  payload: OperationPayload // immutable after insertion
  state: OutboxState
  attempts: number
  nextAttemptAt: number | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
}

export type ReceiptOutcome = 'applied' | 'noop' | 'rejected_deleted'

export type FieldConflict = {
  field: FieldKey
  base: FieldValue
  incoming: FieldValue
  remote: FieldValue
  chosen: FieldValue
}

export type Receipt = {
  protocolVersion: 1
  opId: string
  ownerId: string
  deviceId: string
  jobId: string
  kind: OperationKind
  outcome: ReceiptOutcome
  request: OperationPayload
  result: JobSnapshot
  conflicts: FieldConflict[]
  receivedAt: number
}

export type ConflictNotice = {
  id: string // stable: `${opId}:${field}` or `${opId}:deleted`
  jobId: string
  opId: string
  kind: 'field' | 'deleted'
  field: FieldKey | null
  base: FieldValue
  incoming: FieldValue
  remote: FieldValue
  chosen: FieldValue
  retained: JobFields | null // for 'deleted': the local edits that could not be applied
  createdAt: number
  resolvedAt: number | null
}

export type FieldErrors = Partial<Record<FieldKey, string>>

export function emptyFields(): JobFields {
  return {
    title: '',
    customerName: '',
    siteAddress: '',
    description: '',
    notes: '',
    status: 'scheduled',
    priority: 'normal',
    dueDate: null,
  }
}

/** Trims single-line text and turns an empty due date into null. Multiline text is kept as typed. */
export function normalizeFields(f: JobFields): JobFields {
  return {
    ...f,
    title: f.title.trim(),
    customerName: f.customerName.trim(),
    siteAddress: f.siteAddress.trim(),
    dueDate: f.dueDate ? f.dueDate.trim() || null : null,
  }
}

export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!
  return d <= days
}

export function validateFields(f: JobFields): FieldErrors {
  const errors: FieldErrors = {}
  for (const key of TEXT_KEYS) {
    const [min, max] = TEXT_LIMITS[key]
    const len = f[key].length
    if (len < min) errors[key] = `${FIELD_LABELS[key]} is required.`
    else if (len > max) errors[key] = `${FIELD_LABELS[key]} must be at most ${max} characters.`
  }
  if (!JOB_STATUSES.includes(f.status)) errors.status = 'Choose a valid status.'
  if (!JOB_PRIORITIES.includes(f.priority)) errors.priority = 'Choose a valid priority.'
  if (f.dueDate !== null && !isCalendarDate(f.dueDate)) {
    errors.dueDate = 'Enter a real calendar date (YYYY-MM-DD).'
  }
  return errors
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function newId(): string {
  return crypto.randomUUID()
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isFieldValue(key: FieldKey, v: unknown): v is FieldValue {
  if (key === 'dueDate') return v === null || typeof v === 'string'
  return typeof v === 'string'
}

/** Structural parse of untrusted data (remote documents, stored payloads). Returns null if invalid. */
export function parseFields(x: unknown): JobFields | null {
  if (!isRecord(x)) return null
  const keys = Object.keys(x)
  if (keys.length !== FIELD_KEYS.length || !FIELD_KEYS.every((k) => k in x)) return null
  if (!FIELD_KEYS.every((k) => isFieldValue(k, x[k]))) return null
  const fields = x as JobFields
  return hasErrors(validateFields(fields)) ? null : { ...fields }
}

function parsePartial(x: unknown): Partial<JobFields> | null {
  if (!isRecord(x)) return null
  for (const [k, v] of Object.entries(x)) {
    if (!FIELD_KEYS.includes(k as FieldKey) || !isFieldValue(k as FieldKey, v)) return null
  }
  return x as Partial<JobFields>
}

/** Validates a canonical snapshot whose timestamp has already been converted to ms. */
export function parseSnapshot(x: unknown, ownerId: string, id?: string): JobSnapshot | null {
  if (!isRecord(x)) return null
  const fields = parseFields(x.fields)
  if (
    x.schemaVersion !== SCHEMA_VERSION ||
    !isUuid(x.id) ||
    (id !== undefined && x.id !== id) ||
    x.ownerId !== ownerId ||
    !fields ||
    typeof x.deleted !== 'boolean' ||
    !Number.isInteger(x.revision) ||
    (x.revision as number) < 1 ||
    !isUuid(x.lastOpId) ||
    typeof x.updatedAt !== 'number'
  ) {
    return null
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: x.id,
    ownerId,
    fields,
    deleted: x.deleted,
    revision: x.revision as number,
    lastOpId: x.lastOpId,
    updatedAt: x.updatedAt,
  }
}

/** Returns a reason string if the payload must not be sent, or null if it is well formed. */
export function payloadProblem(p: OperationPayload): string | null {
  if (p.protocolVersion !== PROTOCOL_VERSION) return 'Unsupported protocol version.'
  if (!isUuid(p.opId) || !isUuid(p.jobId)) return 'Operation or job ID is not a UUID.'
  if (typeof p.ownerId !== 'string' || !p.ownerId || p.ownerId.length > 128) return 'Bad owner.'
  if (typeof p.deviceId !== 'string' || !p.deviceId || p.deviceId.length > 64) return 'Bad device.'
  if (!['create', 'patch', 'delete'].includes(p.kind)) return 'Unknown operation kind.'
  if (p.baseRevision !== null && !(Number.isInteger(p.baseRevision) && p.baseRevision >= 1)) {
    return 'Bad base revision.'
  }
  if (!parseFields(p.after)) return 'Intended job state is invalid.'
  const patch = parsePartial(p.patch)
  const base = parsePartial(p.baseValues)
  if (!patch || !base) return 'Patch contains unknown fields.'
  const patchKeys = Object.keys(patch)
  if (p.kind === 'patch') {
    if (patchKeys.length === 0) return 'Patch is empty.'
    if (!patchKeys.every((k) => k in base) || Object.keys(base).length !== patchKeys.length) {
      return 'Patch and base values do not match.'
    }
    if (!patchKeys.every((k) => patch[k as FieldKey] === p.after[k as FieldKey])) {
      return 'Patch and intended state disagree.'
    }
  } else if (patchKeys.length > 0 || Object.keys(base).length > 0) {
    return `A ${p.kind} operation carries no field patch.`
  }
  if (typeof p.clientCreatedAt !== 'number') return 'Bad client time.'
  return null
}

/** Fields the user actually changed in an editor, with the values they started from. */
export function diffFields(
  base: JobFields,
  draft: JobFields,
): { patch: Partial<JobFields>; baseValues: Partial<JobFields> } {
  const patch: Partial<JobFields> = {}
  const baseValues: Partial<JobFields> = {}
  for (const key of FIELD_KEYS) {
    if (draft[key] !== base[key]) {
      ;(patch as Record<FieldKey, FieldValue>)[key] = draft[key]
      ;(baseValues as Record<FieldKey, FieldValue>)[key] = base[key]
    }
  }
  return { patch, baseValues }
}

export function sameFields(a: JobFields, b: JobFields): boolean {
  return FIELD_KEYS.every((k) => a[k] === b[k])
}

/** Key-order independent serialization, used to compare small immutable requests. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function samePayload(a: OperationPayload, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

/** Validated data-only push message (see scripts/send-test-push.mjs). No HTML, no external URLs. */
export type JobMessage = { jobId: string; tag: string }

export function parseJobMessage(data: Record<string, string> | undefined): JobMessage | null {
  if (data?.type !== 'job_update' || !isUuid(data.jobId)) return null
  const tag = /^[a-z0-9-]{1,64}$/.test(data.tag ?? '') ? data.tag! : `job-${data.jobId}`
  return { jobId: data.jobId, tag }
}
