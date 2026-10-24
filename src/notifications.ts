// Web push through Firebase Cloud Messaging, using the app's single Workbox service worker.
// Firebase 13 deprecates token registration; this uses Firebase Installation ID (FID)
// registration. Permission is requested only from a user action, and the FID is stored only
// in the owner's own device document.
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import {
  getMessaging,
  isSupported,
  onMessage,
  onRegistered,
  onUnregistered,
  register,
  unregister,
  type Messaging,
} from 'firebase/messaging'
import type { Session } from './auth'
import { getMeta, setMeta } from './db'
import { parseJobMessage, type JobMessage } from './domain'
import type { FirebaseServices } from './firebase'

export type PushState = 'unsupported' | 'unconfigured' | 'default' | 'granted' | 'denied'
export type PushSupport = { state: PushState; reason: string | null }

let messaging: Messaging | null = null
const messagingFor = (services: FirebaseServices) => (messaging ??= getMessaging(services.app))

export async function pushSupport(services: FirebaseServices): Promise<PushSupport> {
  if (
    !('serviceWorker' in navigator) ||
    !('Notification' in window) ||
    !('PushManager' in window)
  ) {
    return { state: 'unsupported', reason: 'This browser does not support web push notifications.' }
  }
  if (services.config.emulator) {
    return {
      state: 'unconfigured',
      reason:
        'Push needs a real Firebase project. The local emulators do not deliver FCM messages.',
    }
  }
  if (!services.config.vapidKey || !services.config.firebase.messagingSenderId) {
    return { state: 'unconfigured', reason: 'The public VAPID key or sender ID is not configured.' }
  }
  if (!(await isSupported().catch(() => false))) {
    return { state: 'unsupported', reason: 'Firebase Messaging is not supported in this browser.' }
  }
  const permission = Notification.permission
  return { state: permission === 'default' ? 'default' : permission, reason: null }
}

function deviceRef(services: FirebaseServices, s: Session) {
  return doc(services.firestore, 'users', s.uid, 'devices', s.deviceId)
}

// One document per device ID, so FID changes overwrite instead of piling up stale records.
async function saveDevice(services: FirebaseServices, s: Session, fid: string): Promise<void> {
  await setDoc(deviceRef(services, s), {
    deviceId: s.deviceId,
    fid,
    enabled: true,
    userAgent: navigator.userAgent.slice(0, 300),
    updatedAt: serverTimestamp(),
  })
}

/** Starts FCM registration on the existing worker and waits for the FID callback. */
async function registerFid(services: FirebaseServices): Promise<string> {
  const m = messagingFor(services)
  const registration = await navigator.serviceWorker.ready // the Workbox worker, not a second one
  return new Promise<string>((resolve, reject) => {
    let done = false
    let unsubscribe = () => {}
    const finish = () => {
      done = true
      clearTimeout(timer)
      unsubscribe()
    }
    const timer = setTimeout(() => {
      finish()
      reject(
        new Error(
          'Notification registration did not complete. Check the connection and try again.',
        ),
      )
    }, 30_000)
    unsubscribe = onRegistered(m, (fid) => {
      finish()
      resolve(fid)
    })
    if (done) unsubscribe()
    register(m, {
      vapidKey: services.config.vapidKey!,
      serviceWorkerRegistration: registration,
    }).catch((e: unknown) => {
      finish()
      reject(e)
    })
  })
}

/** Must be called from a user gesture (Settings → Enable notifications). */
export async function enableNotifications(
  services: FirebaseServices,
  s: Session,
): Promise<PushState> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default'
  await saveDevice(services, s, await registerFid(services))
  await setMeta(s.db, 'notificationsEnabled', true)
  return 'granted'
}

export async function disableNotifications(services: FirebaseServices, s: Session): Promise<void> {
  await setMeta(s.db, 'notificationsEnabled', false)
  await unregister(messagingFor(services)).catch(() => {})
  await deleteDoc(deviceRef(services, s))
}

/**
 * For the lifetime of a session: keeps the device document in step with FCM registration
 * changes, shows foreground messages as an in-app banner (never a second system notification),
 * and re-registers on startup if the user opted in and permission remains.
 */
export function attachNotifications(
  services: FirebaseServices,
  s: Session,
  onJob: (message: JobMessage) => void,
): () => void {
  let active = true
  let unsubscribers: (() => void)[] = []
  void (async () => {
    const support = await pushSupport(services)
    if (!active || support.state === 'unsupported' || support.state === 'unconfigured') return
    const m = messagingFor(services)
    unsubscribers = [
      onMessage(m, (payload) => {
        const message = parseJobMessage(payload.data)
        if (message) onJob(message)
      }),
      onRegistered(m, async (fid) => {
        if (active && (await getMeta<boolean>(s.db, 'notificationsEnabled'))) {
          await saveDevice(services, s, fid).catch(() => {})
        }
      }),
      onUnregistered(m, () => {
        if (active) void deleteDoc(deviceRef(services, s)).catch(() => {})
      }),
    ]
    if (!(await getMeta<boolean>(s.db, 'notificationsEnabled'))) return
    if (support.state === 'granted') await registerFid(services).catch(() => {})
    else if (support.state === 'denied') await disableNotifications(services, s).catch(() => {})
  })()
  return () => {
    active = false
    unsubscribers.forEach((fn) => fn())
  }
}

/**
 * Best effort while still authenticated. If the device is offline the server registration
 * may remain until notifications are disabled online; message wording is generic for that reason.
 */
export async function cleanupNotificationsBeforeSignOut(
  services: FirebaseServices,
  s: Session,
): Promise<void> {
  if (!(await getMeta<boolean>(s.db, 'notificationsEnabled').catch(() => false))) return
  // Waiting is bounded for the UI only; the cleanup itself is not assumed cancelled.
  const cleanup = disableNotifications(services, s).catch(() => {})
  await Promise.race([cleanup, new Promise((resolve) => setTimeout(resolve, 5000))])
}
