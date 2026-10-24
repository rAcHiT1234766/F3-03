// Firebase initialization. Firestore uses memory caching only: the Dexie outbox is the durable
// delivery mechanism, and business writes happen in online transactions.
import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore'

export type AppConfig = {
  firebase: FirebaseOptions & { projectId: string; apiKey: string; appId: string }
  vapidKey: string | null
  emulator: { host: string; authPort: number; firestorePort: number } | null
}

export type FirebaseServices = {
  app: FirebaseApp
  auth: Auth
  firestore: Firestore
  config: AppConfig
}

type Env = Record<string, string | boolean | undefined>

const REQUIRED = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const

/** Public client configuration only. Nothing read here is a secret. */
export function readConfig(
  env: Env,
): { ok: true; config: AppConfig } | { ok: false; problems: string[] } {
  const get = (key: string) => {
    const v = env[key]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  const problems: string[] = REQUIRED.filter((k) => !get(k)).map((k) => `${k} is not set.`)
  const useEmulators = get('VITE_USE_EMULATORS') === 'true'
  const projectId = get('VITE_FIREBASE_PROJECT_ID') ?? ''
  if (useEmulators && !projectId.startsWith('demo-')) {
    problems.push('Emulator mode requires a demo- project ID so it can never reach a real project.')
  }
  if (problems.length) return { ok: false, problems }
  return {
    ok: true,
    config: {
      firebase: {
        apiKey: get('VITE_FIREBASE_API_KEY')!,
        authDomain: get('VITE_FIREBASE_AUTH_DOMAIN')!,
        projectId,
        appId: get('VITE_FIREBASE_APP_ID')!,
        messagingSenderId: get('VITE_FIREBASE_MESSAGING_SENDER_ID') ?? undefined,
        storageBucket: get('VITE_FIREBASE_STORAGE_BUCKET') ?? undefined,
      },
      vapidKey: get('VITE_FIREBASE_VAPID_KEY'),
      emulator: useEmulators
        ? {
            host: get('VITE_EMULATOR_HOST') ?? '127.0.0.1',
            authPort: Number(get('VITE_AUTH_EMULATOR_PORT') ?? 9099),
            firestorePort: Number(get('VITE_FIRESTORE_EMULATOR_PORT') ?? 8086),
          }
        : null,
    },
  }
}

export function initFirebase(config: AppConfig): FirebaseServices {
  const app = initializeApp(config.firebase)
  const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  })
  const firestore = initializeFirestore(app, { localCache: memoryLocalCache() })
  if (config.emulator) {
    const { host, authPort, firestorePort } = config.emulator
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true })
    connectFirestoreEmulator(firestore, host, firestorePort)
  }
  return { app, auth, firestore, config }
}
