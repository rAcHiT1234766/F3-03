// Dexie definition and account-scoped lifecycle. One database per Firebase project + UID.
import Dexie, { type DexieOptions, type Table } from 'dexie'
import { newId, type ConflictNotice, type LocalJob, type OutboxRow } from './domain'

export type MetaRow = { key: string; value: unknown }

// Versioned schema. Add a new entry (with an upgrade function if data must change) for every
// change; never delete the database to resolve a mismatch.
export const DB_VERSIONS: { version: number; stores: Record<string, string> }[] = [
  {
    version: 1,
    stores: {
      jobs: 'id',
      outbox: '++sequence, &payload.opId, payload.jobId, state',
      conflicts: 'id, jobId, opId',
      meta: 'key',
    },
  },
]

export class FieldLogDB extends Dexie {
  jobs!: Table<LocalJob, string>
  outbox!: Table<OutboxRow, number>
  conflicts!: Table<ConflictNotice, string>
  meta!: Table<MetaRow, string>

  constructor(name: string, options?: DexieOptions) {
    super(name, options)
    for (const v of DB_VERSIONS) this.version(v.version).stores(v.stores)
  }
}

export function accountDbName(projectId: string, uid: string): string {
  return `fieldlog:${projectId}:${uid}`.replace(/[^A-Za-z0-9:_-]/g, '_')
}

/**
 * Opens the account database and reports schema-upgrade coordination problems.
 * Dexie closes this connection itself when another tab needs a newer version.
 */
export function openAccountDb(
  projectId: string,
  uid: string,
  onNotice: (message: string) => void,
): FieldLogDB {
  const db = new FieldLogDB(accountDbName(projectId, uid))
  db.on('versionchange', () => {
    onNotice('FieldLog was updated in another tab. Reload this tab to keep working.')
  })
  db.on('blocked', () => {
    onNotice('Close other FieldLog tabs so local storage can finish updating.')
  })
  return db
}

export async function getMeta<T>(db: FieldLogDB, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(db: FieldLogDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

/** Durable installation ID for this browser profile + account database. */
export async function ensureDeviceId(db: FieldLogDB): Promise<string> {
  return db.transaction('rw', db.meta, async () => {
    const existing = await getMeta<string>(db, 'deviceId')
    if (existing) return existing
    const id = newId()
    await setMeta(db, 'deviceId', id)
    return id
  })
}
