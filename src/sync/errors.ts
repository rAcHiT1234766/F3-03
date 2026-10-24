// Failure classes from the retry table: transient → back off and retry the same opId;
// auth → pause delivery until the user signs in again; blocked → stop retrying this operation.
export type SyncErrorKind = 'transient' | 'auth' | 'blocked'

export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SyncError'
  }
}

const TRANSIENT_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'aborted',
  'cancelled',
  'internal',
  'unknown',
  'resource-exhausted',
  'failed-precondition',
])
const BLOCKED_CODES = new Set([
  'permission-denied',
  'invalid-argument',
  'out-of-range',
  'not-found',
  'already-exists',
  'unimplemented',
  'data-loss',
])

export function classifyError(e: unknown): SyncError {
  if (e instanceof SyncError) return e
  const raw = (e as { code?: unknown })?.code
  const detail = String((e as { message?: unknown })?.message ?? e).slice(0, 200)
  const code = typeof raw === 'string' ? raw.replace(/^(firestore|auth)\//, '') : 'unknown'
  if (code === 'unauthenticated' || code === 'user-token-expired' || code === 'user-disabled') {
    return new SyncError('auth', code, detail)
  }
  if (BLOCKED_CODES.has(code)) return new SyncError('blocked', code, detail)
  if (code === 'network-request-failed' || TRANSIENT_CODES.has(code)) {
    return new SyncError('transient', code, detail)
  }
  // Unknown failures keep the operation and retry with backoff; nothing is discarded.
  return new SyncError('transient', code, detail)
}

/** Blocked codes where a deliberate manual retry of the same payload can make sense. */
export function canRetryBlocked(code: string | null): boolean {
  return code === 'permission-denied' || code === 'missing_job' || code === 'unavailable'
}

export function describeErrorCode(code: string | null): string {
  switch (code) {
    case null:
      return ''
    case 'interrupted':
      return 'The app closed before this change was confirmed. It will be retried safely.'
    case 'local_ack_failed':
      return 'The server accepted this change but this device could not record it yet. Retrying safely.'
    case 'receipt_unconfirmed':
      return 'The server has not confirmed this change yet.'
    case 'unauthenticated':
    case 'user-token-expired':
      return 'Sign in again to sync this change.'
    case 'permission-denied':
      return 'The server refused this change for this account.'
    case 'missing_job':
      return 'This job does not exist on the server.'
    case 'job_exists':
      return 'A different job already uses this ID on the server.'
    case 'job_deleted':
      return 'This job was deleted on another device. Your edit is kept on this device.'
    case 'receipt_mismatch':
      return 'Protocol error: this change ID was already used for a different change.'
    case 'invalid_operation':
    case 'wrong_owner':
    case 'invalid_remote_job':
      return 'This change is invalid and cannot be sent as it is.'
    default:
      return 'Cannot reach the server. Retrying automatically.'
  }
}
