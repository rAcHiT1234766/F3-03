// Dexie live queries for the UI. Dexie is the source for rendered jobs; nothing is mirrored
// into a second store. Subscriptions end with the component's scope.
import { liveQuery } from 'dexie'
import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import type { FieldLogDB } from '../db'
import type { ConflictNotice, LocalJob, OutboxRow } from '../domain'

export function useLiveQuery<T>(
  query: () => Promise<T>,
  initial: T,
  source?: () => unknown,
): Ref<T> {
  const result = shallowRef(initial) as Ref<T>
  let subscription: { unsubscribe(): void } | null = null
  const subscribe = () => {
    subscription?.unsubscribe()
    subscription = liveQuery(query).subscribe({
      next: (value) => (result.value = value),
      error: (e) => console.error('Local query failed', e),
    })
  }
  if (source) watch(source, subscribe, { immediate: true })
  else subscribe()
  onScopeDispose(() => subscription?.unsubscribe())
  return result
}

export type JobListData = { loaded: boolean; jobs: LocalJob[]; opsByJob: Map<string, OutboxRow[]> }

function groupOps(rows: OutboxRow[]): Map<string, OutboxRow[]> {
  const map = new Map<string, OutboxRow[]>()
  for (const row of rows) map.set(row.payload.jobId, [...(map.get(row.payload.jobId) ?? []), row])
  return map
}

export function useJobList(db: FieldLogDB) {
  return useLiveQuery<JobListData>(
    async () => {
      const [jobs, rows] = await Promise.all([db.jobs.toArray(), db.outbox.toArray()])
      return { loaded: true, jobs, opsByJob: groupOps(rows) }
    },
    { loaded: false, jobs: [], opsByJob: new Map() },
  )
}

export function useJob(db: FieldLogDB, id: () => string) {
  return useLiveQuery(
    async () => {
      const jobId = id()
      const [job, ops] = await Promise.all([
        db.jobs.get(jobId),
        db.outbox.where('payload.jobId').equals(jobId).sortBy('sequence'),
      ])
      return { loaded: true, job: job ?? null, ops }
    },
    { loaded: false, job: null as LocalJob | null, ops: [] as OutboxRow[] },
    id,
  )
}

export type SyncOverview = {
  outbox: OutboxRow[]
  conflicts: ConflictNotice[]
  jobs: Map<string, LocalJob>
  lastPullAt: number | null
  lastPushAt: number | null
}

export function useSyncOverview(db: FieldLogDB) {
  return useLiveQuery<SyncOverview>(
    async () => {
      const [outbox, conflicts, jobs, pull, push] = await Promise.all([
        db.outbox.toArray(),
        db.conflicts.toArray(),
        db.jobs.toArray(),
        db.meta.get('lastSuccessfulPullAt'),
        db.meta.get('lastSuccessfulPushAt'),
      ])
      return {
        outbox,
        conflicts: conflicts.sort((a, b) => b.createdAt - a.createdAt),
        jobs: new Map(jobs.map((j) => [j.id, j])),
        lastPullAt: (pull?.value as number | undefined) ?? null,
        lastPushAt: (push?.value as number | undefined) ?? null,
      }
    },
    { outbox: [], conflicts: [], jobs: new Map(), lastPullAt: null, lastPushAt: null },
  )
}

export function usePendingCount(db: FieldLogDB) {
  return useLiveQuery(() => db.outbox.count(), 0)
}

export function useOnline(): Ref<boolean> {
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const update = () => (online.value = navigator.onLine)
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
  onScopeDispose(() => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })
  return online
}
