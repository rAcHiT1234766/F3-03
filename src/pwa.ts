// Service-worker registration, update prompt, offline readiness and install prompt.
import { ref, shallowRef } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import type { Session } from './auth'
import { hasUnsavedDraft } from './ui'

export const needRefresh = ref(false)
/** Essential files are precached. Shown to the user only once the page is also controlled. */
export const offlineReady = ref(false)
export const controlled = ref(false)
let updateServiceWorker: (() => Promise<void>) | null = null
let reloadOnControllerChange = false

type InstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
export const installPrompt = shallowRef<InstallPromptEvent | null>(null)
export const isStandalone = ref(false)

const UPDATE_CHECK_MS = 60 * 60 * 1000

export function startPwa(): void {
  isStandalone.value =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installPrompt.value = e as InstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    installPrompt.value = null
    isStandalone.value = true
  })

  if (!('serviceWorker' in navigator)) return
  controlled.value = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    controlled.value = !!navigator.serviceWorker.controller
    // Reload exactly once, and only after the user asked for the update. (workbox-window
    // decides "is this an update?" at registration, so on a page first loaded uncontrolled it
    // would never reload; a first install's controller change must not reload either.)
    if (reloadOnControllerChange) {
      reloadOnControllerChange = false
      window.location.reload()
    }
  })
  updateServiceWorker = registerSW({
    onNeedReload: () => {}, // the controllerchange handler above owns the reload
    onNeedRefresh: () => (needRefresh.value = true),
    onOfflineReady: () => (offlineReady.value = true),
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => {
        if (navigator.onLine && document.visibilityState === 'visible') void registration.update()
      }, UPDATE_CHECK_MS)
    },
    onRegisterError: (error) => console.error('Service worker registration failed', error),
  })
}

/**
 * Applies a waiting update: never while a form has unsaved input, and only after any
 * in-flight sync acknowledgement has finished. The page reloads once the new worker controls it.
 */
export async function applyUpdate(s: Session | null): Promise<string | null> {
  if (hasUnsavedDraft.value) return 'Save or discard your unsaved changes before updating.'
  if (!updateServiceWorker) return 'No update is waiting.'
  if (s) await s.sync.whenIdle()
  reloadOnControllerChange = true
  await updateServiceWorker()
  return null
}

/** Shows the browser's install dialog. Reports what the user chose; offering is not installing. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = installPrompt.value
  if (!event) return 'unavailable'
  installPrompt.value = null
  await event.prompt()
  return (await event.userChoice).outcome
}
