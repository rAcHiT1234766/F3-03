// Sync orchestrator: one coordinator per local account (Web Lock), bounded cycles of
// reconcile → push → reconcile, persisted backoff, and coalesced triggers.
import { reactive, readonly } from 'vue'
import { setMeta, type FieldLogDB } from '../db'
import {
  samePayload,
  type JobSnapshot,
  type OperationPayload,
  type OutboxRow,
  type Receipt,
} from '../domain'
import { classifyError, type SyncError } from './errors'
import {
  acknowledgeReceipt,
  applyRemoteSnapshots,
  clearRetryDelays,
  discardOperation,
  markFailed,
  markSending,
  nextEligible,
  nextRetryAt,
  recoverInterrupted,
} from './local'

/** The only thing the engine knows about the server. Tests inject fakes that pause or fail. */
export type Remote = {
  applyOperation(payload: OperationPayload): Promise<Receipt>
  fetchJobs(): Promise<JobSnapshot[]>
  getReceipt(opId: string): Promise<Receipt | null>
}

export type SyncPhase =
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'unreachable'
  | 'auth_required'
  | 'denied'
  | 'unsupported'
  | 'stopped'

export type SyncStatus = {
  phase: SyncPhase
  running: boolean
  stalled: boolean
  lastError: string | null
}

type CycleSummary = { pulled: boolean; sent: number; acked: number; halted: string | null }

export type EngineOptions = {
  db: FieldLogDB
  remote: Remote
  lockName: string
  locks?: LockManager | null
  isCurrent?: () => boolean
  now?: () => number
  random?: () => number
  onlineHint?: () => boolean
  batchLimit?: number
  batchBudgetMs?: number
  stallAfterMs?: number
}

export type SyncEngine = ReturnType<typeof createSyncEngine>

const PERIODIC_MS = 60_000

/** Exponential backoff from ~2 s, capped at 60 s, with ±20 % jitter. */
export function retryDelay(attempts: number, random: () => number): number {
  const base = Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1))
  return Math.min(60_000, Math.round(base * (0.8 + 0.4 * random())))
}

export function createSyncEngine(options: EngineOptions) {
  const { db, remote, lockName } = options
  const locks = options.locks === undefined ? (globalThis.navigator?.locks ?? null) : options.locks
  const isCurrent = options.isCurrent ?? (() => true)
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const onlineHint = options.onlineHint ?? (() => globalThis.navigator?.onLine ?? true)
  const batchLimit = options.batchLimit ?? 25
  const batchBudgetMs = options.batchBudgetMs ?? 15_000
  const stallAfterMs = options.stallAfterMs ?? 20_000

  const status = reactive<SyncStatus>({
    phase: locks ? 'idle' : 'unsupported',
    running: false,
    stalled: false,
    lastError: locks
      ? null
      : 'This browser cannot coordinate sync between tabs (Web Locks API missing).',
  })

  let stopped = false
  let authPaused = false
  let requested = false
  let loop: Promise<void> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const cleanups: (() => void)[] = []

  const active = () => !stopped && isCurrent()

  function setFailurePhase(err: SyncError) {
    if (err.kind === 'auth') {
      authPaused = true
      status.phase = 'auth_required'
    } else if (err.kind === 'transient') {
      status.phase = onlineHint() ? 'unreachable' : 'offline'
    } else {
      status.phase = 'denied'
    }
    status.lastError = err.message
  }

  async function pull(): Promise<boolean> {
    try {
      const snapshots = await remote.fetchJobs()
      if (!active()) return false
      await applyRemoteSnapshots(db, snapshots, now()) // also records lastSuccessfulPullAt
      return true
    } catch (e) {
      setFailurePhase(classifyError(e))
      return false
    }
  }

  async function recordFailure(row: OutboxRow, err: SyncError): Promise<void> {
    const state = err.kind === 'blocked' ? 'blocked' : 'retry_wait'
    const nextAttemptAt =
      err.kind === 'transient'
        ? now() + retryDelay(row.attempts, random)
        : err.kind === 'auth'
          ? now()
          : null
    await markFailed(db, row.sequence!, {
      state,
      nextAttemptAt,
      lastErrorCode: err.code,
      lastErrorMessage: err.message,
    })
  }

  /** Sends one operation. Returns false when the cycle should stop (network/auth trouble). */
  async function deliver(row: OutboxRow): Promise<'acked' | 'blocked' | 'halt'> {
    const sending = await markSending(db, row.sequence!)
    if (!sending) return 'blocked'
    // No timeout race: an unresolved request keeps its identity and the lock until it settles.
    const stallTimer = setTimeout(() => (status.stalled = true), stallAfterMs)
    let receipt: Receipt
    try {
      receipt = await remote.applyOperation(sending.payload)
    } catch (e) {
      const err = classifyError(e)
      await recordFailure(sending, err)
      if (err.kind === 'blocked') return 'blocked'
      setFailurePhase(err)
      return 'halt'
    } finally {
      clearTimeout(stallTimer)
      status.stalled = false
    }
    try {
      await acknowledgeReceipt(db, receipt, now())
      return 'acked'
    } catch {
      // The server committed; this device could not record it. The same opId will find the
      // receipt on retry, so nothing is applied twice.
      await markFailed(db, sending.sequence!, {
        state: 'retry_wait',
        nextAttemptAt: now(),
        lastErrorCode: 'local_ack_failed',
        lastErrorMessage: 'Could not record the confirmed change on this device.',
      }).catch(() => {})
      status.lastError =
        'Could not record a confirmed change on this device. It will be retried safely.'
      return 'halt'
    }
  }

  async function cycle(): Promise<CycleSummary> {
    const summary: CycleSummary = { pulled: false, sent: 0, acked: 0, halted: null }
    if (!active()) return summary
    status.running = true
    status.phase = 'syncing'
    try {
      await recoverInterrupted(db, now())
      summary.pulled = await pull()
      if (!summary.pulled) {
        summary.halted = status.phase
        return summary
      }
      const started = now()
      while (summary.sent < batchLimit && now() - started < batchBudgetMs && active()) {
        const row = await nextEligible(db, now())
        if (!row) break
        const result = await deliver(row)
        summary.sent++
        if (result === 'acked') summary.acked++
        if (result === 'halt') {
          summary.halted = status.phase
          break
        }
      }
      if (!summary.halted && (summary.sent >= batchLimit || now() - started >= batchBudgetMs)) {
        requested = true // yield the lock, then continue with the remaining work
      }
      if (summary.acked > 0) {
        await setMeta(db, 'lastSuccessfulPushAt', now())
        if (!summary.halted && !(await pull())) summary.halted = status.phase
      }
      if (!summary.halted) {
        status.phase = 'idle'
        status.lastError = null
      }
      return summary
    } catch (e) {
      // A local storage failure. Queue contents are untouched; try again later.
      status.phase = 'unreachable'
      status.lastError = `Local sync step failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`
      summary.halted = 'local_error'
      return summary
    } finally {
      status.running = false
    }
  }

  async function scheduleRetryWake(): Promise<void> {
    clearTimeout(retryTimer)
    if (!active()) return
    const at = await nextRetryAt(db).catch(() => null)
    if (at === null || !active()) return
    retryTimer = setTimeout(() => request('retry'), Math.max(0, at - now()))
  }

  async function runLoop(): Promise<void> {
    while (requested && active()) {
      requested = false
      if (!locks) {
        status.phase = 'unsupported'
        return
      }
      try {
        await locks.request(lockName, async () => {
          await cycle()
        })
      } catch (e) {
        status.lastError = `Could not start sync: ${String((e as Error)?.message ?? e).slice(0, 200)}`
      }
      await scheduleRetryWake()
    }
  }

  /** Coalesces any number of triggers into at most one queued cycle. */
  function request(reason: string): void {
    if (stopped) return
    const deliberate = reason === 'manual' || reason === 'sign-in'
    if (authPaused && !deliberate) return
    if (deliberate) authPaused = false
    requested = true
    loop ??= runLoop().finally(() => {
      loop = null
    })
  }

  async function retryNow(): Promise<void> {
    await clearRetryDelays(db, now())
    request('manual')
  }

  /**
   * Forget a blocked operation only once the server has confirmed it had no effect.
   * If a receipt exists, the change did apply and is acknowledged instead.
   */
  async function discardBlocked(
    sequence: number,
  ): Promise<'discarded' | 'acknowledged' | 'unknown'> {
    if (!locks) return 'unknown'
    return locks.request(lockName, async () => {
      const row = await db.outbox.get(sequence)
      if (!row || row.state !== 'blocked') return 'unknown'
      let receipt: Receipt | null
      try {
        receipt = await remote.getReceipt(row.payload.opId)
      } catch {
        return 'unknown'
      }
      if (receipt && samePayload(row.payload, receipt.request)) {
        await acknowledgeReceipt(db, receipt, now())
        return 'acknowledged'
      }
      await discardOperation(db, sequence)
      return 'discarded'
    })
  }

  function start(): void {
    if (typeof window === 'undefined') return
    const onOnline = () => request('online')
    const onVisible = () => document.visibilityState === 'visible' && request('visible')
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') request('timer')
    }, PERIODIC_MS)
    cleanups.push(
      () => window.removeEventListener('online', onOnline),
      () => document.removeEventListener('visibilitychange', onVisible),
      () => clearInterval(timer),
    )
  }

  /** Stops scheduling new work. An in-flight request is allowed to settle, never "cancelled". */
  async function stop(): Promise<void> {
    stopped = true
    clearTimeout(retryTimer)
    cleanups.splice(0).forEach((fn) => fn())
    await loop
    status.phase = 'stopped'
  }

  return {
    status: readonly(status),
    request,
    retryNow,
    discardBlocked,
    start,
    stop,
    whenIdle: async () => {
      while (loop) await loop
    },
  }
}
