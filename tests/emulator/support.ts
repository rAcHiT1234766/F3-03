// Shared emulator helpers. They fail closed: nothing runs unless every target is a local
// emulator for a demo- project, so a misconfigured run can never touch a real Firebase project.
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectAuthEmulator,
  initializeAuth,
  inMemoryPersistence,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  terminate,
  type Firestore,
} from 'firebase/firestore'

export const PROJECT_ID = 'demo-fieldlog'

function localHost(name: string, required: boolean): { host: string; port: number } | null {
  const value = process.env[name]
  if (!value) {
    if (required)
      throw new Error(`Refusing to run: ${name} is not set (use npm run test:sync / test:rules).`)
    return null
  }
  const m = /^(127\.0\.0\.1|localhost|\[::1\]):(\d+)$/.exec(value)
  if (!m) throw new Error(`Refusing to run: ${name}=${value} is not a local emulator address.`)
  return { host: m[1]!, port: Number(m[2]) }
}

export function emulatorTargets(needAuth: boolean) {
  if (!PROJECT_ID.startsWith('demo-'))
    throw new Error('Refusing to run against a non-demo project.')
  const firestore = localHost('FIRESTORE_EMULATOR_HOST', true)!
  const auth = localHost('FIREBASE_AUTH_EMULATOR_HOST', needAuth)
  return { firestore, auth }
}

export async function clearFirestore(): Promise<void> {
  const { firestore } = emulatorTargets(false)
  const url = `http://${firestore.host}:${firestore.port}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Could not clear the Firestore emulator: ${res.status}`)
}

/** Creates a user in the Auth emulator and returns its UID. */
export async function createUser(
  email = `tech-${crypto.randomUUID()}@example.test`,
  password = 'demo-password',
) {
  const { auth } = emulatorTargets(true)
  const res = await fetch(
    `http://${auth!.host}:${auth!.port}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  )
  const body = (await res.json()) as { localId?: string }
  if (!res.ok || !body.localId)
    throw new Error(`Could not create emulator user: ${JSON.stringify(body)}`)
  return { uid: body.localId, email, password }
}

export type DeviceClient = {
  app: FirebaseApp
  firestore: Firestore
  uid: string
  close(): Promise<void>
}

/** An independent client "device": its own Firebase app, signed in as the given user. */
export async function signedInClient(user: {
  email: string
  password: string
}): Promise<DeviceClient> {
  const { firestore: fsTarget, auth: authTarget } = emulatorTargets(true)
  const app = initializeApp(
    {
      apiKey: 'demo-api-key',
      projectId: PROJECT_ID,
      appId: 'demo-app',
      authDomain: 'demo-fieldlog.firebaseapp.com',
    },
    `device-${crypto.randomUUID()}`,
  )
  const auth = initializeAuth(app, { persistence: inMemoryPersistence })
  connectAuthEmulator(auth, `http://${authTarget!.host}:${authTarget!.port}`, {
    disableWarnings: true,
  })
  const firestore = initializeFirestore(app, { localCache: memoryLocalCache() })
  connectFirestoreEmulator(firestore, fsTarget.host, fsTarget.port)
  const credential = await signInWithEmailAndPassword(auth, user.email, user.password)
  return {
    app,
    firestore,
    uid: credential.user.uid,
    async close() {
      await terminate(firestore)
      await deleteApp(app)
    },
  }
}
