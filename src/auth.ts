// Auth lifecycle and the active-account session. Each signed-in UID gets its own Dexie database
// and sync engine; a generation counter stops late work for one account touching another.
import Dexie from 'dexie'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { markRaw, ref, shallowRef } from 'vue'
import { ensureDeviceId, openAccountDb, type FieldLogDB } from './db'
import { initFirebase, readConfig, type FirebaseServices } from './firebase'
import type { LocalContext } from './jobs'
import { cleanupNotificationsBeforeSignOut } from './notifications'
import { createSyncEngine, type SyncEngine } from './sync/engine'
import { createFirestoreRemote } from './sync/remote'

export type Session = LocalContext & {
  generation: number
  uid: string
  email: string | null
  projectId: string
  db: FieldLogDB
  sync: SyncEngine
}

export type AuthPhase =
  | 'starting' // waiting for Firebase to restore a persisted session
  | 'unconfigured'
  | 'signed_out'
  | 'opening' // opening the account's local database
  | 'signed_in'
  | 'storage_error'

export const authPhase = ref<AuthPhase>('starting')
export const session = shallowRef<Session | null>(null)
export const configProblems = ref<string[]>([])
export const storageNotice = ref<string | null>(null)

let services: FirebaseServices | null = null
let generation = 0
let targetUid: string | null | undefined
let disposal: Promise<void> = Promise.resolve()
let markReady: () => void
export const authReady = new Promise<void>((resolve) => (markReady = resolve))

export function getServices(): FirebaseServices | null {
  return services
}

/** For signed-in screens. App.vue renders them only with a session and remounts on account change. */
export function requireSession(): Session {
  const s = session.value
  if (!s) throw new Error('No active session.')
  return s
}

export async function startAuth(): Promise<void> {
  const result = readConfig(import.meta.env)
  if (!result.ok) {
    configProblems.value = result.problems
    authPhase.value = 'unconfigured'
    markReady()
    return
  }
  services = initFirebase(result.config)
  // Distinguish "identity still loading" from "signed out" before choosing a database.
  await services.auth.authStateReady()
  await switchUser(services.auth.currentUser)
  markReady()
  // Also handles sign-in/out propagated from other tabs.
  onAuthStateChanged(services.auth, (user) => void switchUser(user))
}

async function switchUser(user: User | null): Promise<void> {
  const uid = user?.uid ?? null
  if (uid === targetUid) return
  targetUid = uid
  const gen = ++generation
  const previous = session.value
  session.value = null
  if (previous) disposal = endSession(previous)
  if (!user || !services) {
    authPhase.value = 'signed_out'
    return
  }
  authPhase.value = 'opening'
  const { projectId } = services.config.firebase
  try {
    const db = openAccountDb(projectId, user.uid, (message) => (storageNotice.value = message))
    const deviceId = await ensureDeviceId(db)
    if (gen !== generation) {
      db.close()
      return
    }
    const sync = createSyncEngine({
      db,
      remote: createFirestoreRemote(services.firestore, user.uid),
      lockName: `fieldlog-sync:${projectId}:${user.uid}`,
      isCurrent: () => gen === generation,
    })
    session.value = markRaw({
      generation: gen,
      uid: user.uid,
      ownerId: user.uid,
      email: user.email,
      projectId,
      db,
      deviceId,
      sync,
      requestSync: (reason: string) => sync.request(reason),
    })
    authPhase.value = 'signed_in'
    sync.start()
    sync.request('sign-in')
  } catch (e) {
    if (gen !== generation) return
    console.error(e)
    authPhase.value = 'storage_error'
    storageNotice.value =
      'FieldLog could not open its storage on this device. Private browsing or blocked site data can cause this.'
  }
}

/** Stops new work, lets an in-flight attempt settle against its own database, then closes it. */
async function endSession(s: Session): Promise<void> {
  await s.sync.stop()
  s.db.close()
}

export async function signIn(email: string, password: string): Promise<void> {
  if (!services) throw new Error('Firebase is not configured.')
  await signInWithEmailAndPassword(services.auth, email, password)
}

/**
 * Signs out. Local account data is retained by default so unsynced work is never silently
 * destroyed; `removeLocalData` deletes this account's database after the session has closed.
 */
export async function signOutUser(options: { removeLocalData?: boolean } = {}): Promise<void> {
  if (!services) return
  const s = session.value
  if (s) await cleanupNotificationsBeforeSignOut(services, s)
  await signOut(services.auth)
  await switchUser(null)
  await disposal
  if (s && options.removeLocalData) await Dexie.delete(s.db.name)
}
