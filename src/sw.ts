/// <reference lib="webworker" />
// The app's only service worker: Workbox precache + offline navigation, the update handshake,
// and FCM background messages. It never caches Firebase/API traffic; job data lives in Dexie.
import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { isUuid, parseJobMessage } from './domain'

declare let self: ServiceWorkerGlobalScope

// Registered before Firebase Messaging initializes, so this handler runs first.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const jobId = (event.notification.data as { jobId?: unknown } | null)?.jobId
  event.waitUntil(openJob(isUuid(jobId) ? jobId : null))
})

/** Focuses an existing app window (the page then routes and checks access) or opens one. */
async function openJob(jobId: string | null): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = windows.find((c) => new URL(c.url).origin === self.location.origin)
  if (existing) {
    await existing.focus()
    if (jobId) existing.postMessage({ type: 'OPEN_JOB', jobId })
    return
  }
  await self.clients.openWindow(
    new URL(jobId ? `jobs/${jobId}` : 'jobs', self.registration.scope).href,
  )
}

// Prompt-based updates: the waiting worker activates only when the page asks.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting()
})

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches() // removes only Workbox precaches from older builds
clientsClaim()

// In-scope navigations get the cached app shell so deep links work offline.
// Firebase reserved paths (/__/auth/…) must never receive the SPA shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/__\//] }))

// FCM must be set up during the worker's initial evaluation so its push handler is registered.
const env = import.meta.env
if (env.VITE_USE_EMULATORS !== 'true' && env.VITE_FIREBASE_MESSAGING_SENDER_ID) {
  try {
    const app = initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    })
    // Data-only messages: this handler shows exactly one notification. When a FieldLog window
    // is visible, the SDK delivers to the page instead, which shows an in-app banner.
    onBackgroundMessage(getMessaging(app), (payload) => {
      const message = parseJobMessage(payload.data)
      if (!message) return
      return self.registration.showNotification('FieldLog update available', {
        body: 'A job was updated. Open FieldLog to sync and view it.',
        tag: message.tag,
        icon: '/icons/icon-192.png',
        data: { jobId: message.jobId },
      })
    })
  } catch (e) {
    console.warn('FieldLog: push messaging is unavailable in this worker.', e)
  }
}
