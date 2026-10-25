<script setup lang="ts">
import {
  Bell,
  CircleArrowUp,
  CircleCheck,
  ClipboardList,
  RefreshCw,
  Settings,
  TriangleAlert,
  X,
} from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authPhase, configProblems, getServices, session, storageNotice } from './auth'
import BrandMark from './components/BrandMark.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import SignalBars from './components/SignalBars.vue'
import { useLiveQuery, useOnline } from './composables/useJobs'
import { isUuid, type JobMessage } from './domain'
import { applyUpdate, controlled, needRefresh, offlineReady } from './pwa'
import type { SyncPhase } from './sync/engine'
import { announcement, phaseMessage, pluralize } from './ui'

const router = useRouter()
const route = useRoute()
const online = useOnline()
const pushBanner = ref<JobMessage | null>(null)
const updateMessage = ref<string | null>(null)
const updating = ref(false)
const offlineReadyDismissed = ref(false)
const updateDeferred = ref(false)

const pending = useLiveQuery(
  async () => (session.value ? session.value.db.outbox.count() : 0),
  0,
  () => session.value,
)
const phase = computed(() => session.value?.sync.status.phase ?? 'idle')
const statusText = computed(() => {
  const base = phaseMessage(phase.value, online.value)
  return pending.value ? `${base} · ${pluralize(pending.value, 'change')} waiting to sync` : base
})

type Tone = 'ok' | 'busy' | 'warn' | 'danger'
const PHASE_TONES: Record<SyncPhase, Tone> = {
  idle: 'ok',
  syncing: 'busy',
  offline: 'warn',
  unreachable: 'warn',
  auth_required: 'danger',
  denied: 'danger',
  unsupported: 'danger',
  stopped: 'danger',
}
const statusTone = computed<Tone>(() =>
  !online.value && phase.value !== 'syncing' ? 'warn' : PHASE_TONES[phase.value],
)

// The Jobs tab stays highlighted on job details and the editor.
const section = computed(() => {
  const name = String(route.name ?? '')
  if (name.startsWith('job')) return 'jobs'
  return name
})

// Keep the screen consistent with the auth state, including sign-outs from other tabs.
watch(authPhase, (phase) => {
  if (phase === 'signed_out' && !route.meta.public) {
    void router.replace({ name: 'sign-in', query: { redirect: route.fullPath } })
  } else if (phase === 'signed_in' && route.name === 'sign-in') {
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/jobs'
    void router.replace(redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/jobs')
  }
})

// Per-session notification wiring, disposed when the account changes or signs out.
// Firebase Messaging is loaded on demand so it is not part of the first screen's bundle.
let detachNotifications: (() => void) | null = null
watch(
  session,
  async (s) => {
    detachNotifications?.()
    detachNotifications = null
    pushBanner.value = null
    const services = getServices()
    if (!s || !services) return
    const { attachNotifications } = await import('./notifications')
    if (session.value !== s) return
    detachNotifications = attachNotifications(services, s, (message) => {
      pushBanner.value = message
      s.sync.request('push')
    })
  },
  { immediate: true },
)

// Notification clicks: the worker focuses this window and asks it to open a job route.
function onWorkerMessage(event: MessageEvent) {
  const data = event.data as { type?: string; jobId?: unknown } | null
  if (data?.type === 'OPEN_JOB' && isUuid(data.jobId)) void router.push(`/jobs/${data.jobId}`)
}
navigator.serviceWorker?.addEventListener('message', onWorkerMessage)
onBeforeUnmount(() => {
  navigator.serviceWorker?.removeEventListener('message', onWorkerMessage)
  detachNotifications?.()
})

async function update() {
  // Messages appear inside the role="status" banner, which announces them.
  updating.value = true
  updateMessage.value = null
  updateMessage.value = await applyUpdate(session.value)
  if (updateMessage.value) updating.value = false // otherwise the page reloads
}

function openPushedJob() {
  const jobId = pushBanner.value?.jobId
  pushBanner.value = null
  if (jobId) void router.push(`/jobs/${jobId}`)
}
</script>

<template>
  <div class="shell" :class="{ 'with-tabbar': !!session }">
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="app-header">
      <div class="container header-row">
        <RouterLink to="/jobs" class="brand">
          <BrandMark :size="28" />
          <span>FieldLog</span>
        </RouterLink>
        <nav v-if="session" aria-label="Main" class="main-nav">
          <RouterLink to="/jobs" class="nav-link" :class="{ active: section === 'jobs' }">
            <ClipboardList :size="20" />
            <span>Jobs</span>
          </RouterLink>
          <RouterLink to="/sync" class="nav-link" :class="{ active: section === 'sync' }">
            <RefreshCw :size="20" />
            <span>Sync center</span>
            <span v-if="pending" class="count num" :aria-label="`${pending} waiting`">{{
              pending
            }}</span>
          </RouterLink>
          <RouterLink to="/settings" class="nav-link" :class="{ active: section === 'settings' }">
            <Settings :size="20" />
            <span>Settings</span>
          </RouterLink>
        </nav>
        <RouterLink
          v-if="session"
          to="/sync"
          class="sync-status"
          :class="`tone-${statusTone}`"
          :title="statusText"
          data-testid="status-line"
        >
          <span class="lamp" aria-hidden="true" />
          <span class="sr-only">Sync status: </span>
          <span class="sync-text">{{ statusText }}</span>
        </RouterLink>
      </div>
    </header>

    <div v-if="storageNotice" class="container">
      <p class="banner banner-warn" role="alert">
        <TriangleAlert :size="18" />
        <span class="banner-body">{{ storageNotice }}</span>
      </p>
    </div>

    <main id="main" class="container" tabindex="-1">
      <div v-if="authPhase === 'unconfigured'" class="page container-narrow">
        <p class="eyebrow">Setup needed</p>
        <h1>FieldLog needs configuration</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env.local</code> and fill in the public Firebase
          web config, or run in emulator mode.
        </p>
        <ul>
          <li v-for="p in configProblems" :key="p">{{ p }}</li>
        </ul>
      </div>
      <p v-else-if="authPhase === 'starting' || authPhase === 'opening'" class="opening">
        <SignalBars :size="18" motion="seek" /> Opening FieldLog…
      </p>
      <div v-else-if="authPhase === 'storage_error'" class="page container-narrow">
        <p class="eyebrow">This device</p>
        <h1>Local storage unavailable</h1>
        <p>{{ storageNotice }}</p>
      </div>
      <RouterView
        v-else-if="session || route.meta.public"
        :key="session?.generation ?? 'signed-out'"
      />
    </main>

    <!-- Transient notices come after the page content, so they never push it down. -->
    <div
      class="toasts container"
      :class="{ 'clear-fab': route.name === 'jobs', 'over-page': route.name === 'sign-in' }"
    >
      <div v-if="needRefresh && !updateDeferred" class="toast toast-update" role="status">
        <CircleArrowUp :size="20" class="toast-icon" />
        <div class="toast-body">
          <p class="toast-title">A new version of FieldLog is ready.</p>
          <p v-if="updateMessage" class="small toast-detail">{{ updateMessage }}</p>
        </div>
        <div class="toast-actions">
          <button
            class="btn btn-small btn-primary"
            type="button"
            :disabled="updating"
            @click="update"
          >
            {{ updating ? 'Updating…' : 'Update now' }}
          </button>
          <button
            class="btn btn-small btn-ghost"
            type="button"
            :disabled="updating"
            @click="updateDeferred = true"
          >
            Later
          </button>
        </div>
      </div>
      <div
        v-if="offlineReady && controlled && !offlineReadyDismissed && !needRefresh"
        class="toast toast-ok"
        role="status"
        data-testid="offline-ready"
      >
        <CircleCheck :size="20" class="toast-icon" />
        <div class="toast-body">
          <p class="toast-title">FieldLog is ready to work offline on this device.</p>
        </div>
        <div class="toast-actions">
          <button
            class="btn btn-small btn-ghost btn-icon"
            type="button"
            @click="offlineReadyDismissed = true"
          >
            <X :size="18" /><span class="sr-only">Dismiss</span>
          </button>
        </div>
      </div>
      <div v-if="pushBanner" class="toast" role="status">
        <Bell :size="20" class="toast-icon" />
        <div class="toast-body">
          <p class="toast-title">A job was updated.</p>
        </div>
        <div class="toast-actions">
          <button class="btn btn-small btn-primary" type="button" @click="openPushedJob">
            Open job
          </button>
          <button class="btn btn-small btn-ghost" type="button" @click="pushBanner = null">
            Dismiss
          </button>
        </div>
      </div>
    </div>

    <ConfirmDialog />
    <div class="sr-only" aria-live="polite" aria-atomic="true">{{ announcement }}</div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  /* Full-bleed panels (the sign-in cover) reach the window edges and the end of the page without
     adding a scroll. "clip" is not a scroll container, so the sticky header still sticks. */
  overflow: clip;
}

/* The app bar: ink in both themes, like the cover of a job book. */
.app-header {
  --focus: var(--header-text);
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--header);
  color: var(--header-text);
  border-bottom: 1px solid var(--header-border);
}

.header-row {
  display: flex;
  align-items: center;
  gap: 0.75rem 2rem;
  min-height: var(--header-h);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  margin-left: -0.25rem;
  padding: 0.25rem;
  border-radius: var(--radius-sm);
  color: var(--header-text);
  font-size: 1.3125rem;
  font-weight: 700;
  font-stretch: var(--condensed);
  letter-spacing: -0.01em;
  text-decoration: none;
}

.brand:hover {
  color: var(--header-text);
}

.brand :deep(.brand-mark) {
  transition: transform var(--dur-3) var(--ease-out);
}

.brand:hover :deep(.brand-mark) {
  transform: rotate(-6deg);
}

.main-nav {
  display: flex;
  align-self: stretch;
  gap: 0.25rem;
}

.nav-link {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.75rem;
  color: var(--header-text-2);
  font-size: 0.9375rem;
  font-weight: 550;
  text-decoration: none;
  transition: color var(--dur-1) var(--ease);
}

/* Words only in the app bar; the icons are for the phone tab bar. */
.nav-link > svg {
  display: none;
}

.nav-link::after {
  content: '';
  position: absolute;
  left: 0.75rem;
  right: 0.75rem;
  bottom: -1px;
  height: 3px;
  background: var(--accent);
  transform: scaleX(0);
  transition: transform var(--dur-2) var(--ease-out);
}

.nav-link:hover {
  color: var(--header-text);
}

.nav-link:hover::after {
  transform: scaleX(0.35);
}

.nav-link.active {
  color: var(--header-text);
}

.nav-link.active::after {
  transform: scaleX(1);
}

.nav-link:focus-visible {
  outline-offset: -4px;
}

.count {
  display: inline-grid;
  place-items: center;
  min-width: 1.3rem;
  height: 1.3rem;
  padding: 0 0.3rem;
  border-radius: var(--radius-xs);
  background: var(--accent);
  color: var(--accent-text);
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
  animation: pop var(--dur-2) var(--ease-out);
}

@keyframes pop {
  from {
    transform: scale(0.6);
  }
}

/* The sync readout: a lamp and the state in plain words. */
.sync-status {
  --lamp: #7ed29b;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  margin-left: auto;
  padding: 0.35rem 0.75rem;
  white-space: nowrap;
  border: 1px solid var(--header-border);
  border-radius: var(--radius-sm);
  background: var(--header-2);
  color: var(--header-text-2);
  font-family: var(--mono);
  font-size: 0.75rem;
  text-decoration: none;
  transition:
    color var(--dur-1) var(--ease),
    border-color var(--dur-1) var(--ease);
}

.sync-status:hover {
  color: var(--header-text);
  border-color: color-mix(in srgb, var(--header-text) 35%, transparent);
}

.lamp {
  flex-shrink: 0;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--lamp);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--lamp) 22%, transparent);
}

.tone-busy {
  --lamp: #97b3ff;
}

.tone-busy .lamp {
  animation: pulse 1.1s var(--ease) infinite;
}

.tone-warn {
  --lamp: #f2c063;
  color: var(--header-text);
  border-color: color-mix(in srgb, #f2c063 45%, transparent);
}

.tone-danger {
  --lamp: #ff8a7e;
  color: var(--header-text);
  border-color: color-mix(in srgb, #ff8a7e 50%, transparent);
}

@keyframes pulse {
  50% {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--lamp) 0%, transparent);
  }
}

/* Long states shorten with an ellipsis here; the full text stays in the DOM and the tooltip,
   and the Sync center shows every detail. */
.sync-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

main {
  flex: 1;
}

main:focus {
  outline: none;
}

.opening {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin: 0;
  padding: 2.25rem 0;
  color: var(--text-2);
  font-family: var(--mono);
  font-size: 0.875rem;
}

.opening :deep(.signal) {
  color: var(--accent-ink);
}

.toasts {
  /* In normal flow at the end of the page and sticky to the viewport bottom: it never pushes
     content down (no layout shift) and never permanently covers controls (its space is reserved). */
  position: sticky;
  bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 0.75rem);
  z-index: 20;
  display: grid;
  justify-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;
  pointer-events: none;
}

/* No notices: no reserved space (full-height screens such as sign-in end at the window edge). */
.toasts:empty {
  margin-block: 0;
}

/* The wide sign-in screen pins its form while the cover scrolls (SignInView). Reserved space
   would add scrolling past the form's column and carry the form away, so notices float there. */
@media (min-width: 900px) {
  .toasts.over-page {
    position: fixed;
    inset: auto 0 calc(env(safe-area-inset-bottom, 0px) + 0.75rem);
    margin-block: 0;
  }
}

/* A dark slip, whatever the theme. */
.toast {
  --focus: var(--header-text);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem 0.85rem;
  width: min(100%, 40rem);
  padding: 0.7rem 0.7rem 0.7rem 1rem;
  border: 1px solid var(--header-border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
  background: var(--header);
  color: var(--header-text);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
  animation: toast-in var(--dur-3) var(--ease-out);
}

.toast-icon {
  color: #97b3ff;
}

.toast-ok {
  border-left-color: #7ed29b;
}

.toast-ok .toast-icon {
  color: #7ed29b;
}

.toast-update .toast-icon {
  color: var(--accent);
}

.toast-body {
  flex: 1 1 14rem;
  min-width: 0;
}

.toast-title {
  margin: 0;
  font-weight: 600;
  font-size: 0.9375rem;
}

.toast-detail {
  margin: 0.2rem 0 0;
  color: var(--header-text-2);
}

.toast-actions {
  display: flex;
  gap: 0.4rem;
  margin-left: auto;
}

.toast .btn-ghost {
  --btn-fg: var(--header-text);
  --btn-hover: var(--header-2);
}

/* Slide only: fading text would briefly fall below the contrast minimum. */
@keyframes toast-in {
  from {
    transform: translateY(16px);
  }
}

/* Phones: the main navigation becomes a bottom tab bar within thumb reach. */
@media (max-width: 640px) {
  .with-tabbar {
    padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
  }

  .shell:not(.with-tabbar) {
    --tabbar-h: 0px;
  }

  /* The jobs list floats its "New job" button above the tab bar; notices stack above that button
     instead of covering it (the list reserves blank space at its end for both). */
  .toasts.clear-fab {
    bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 5rem);
  }

  .header-row {
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
    min-height: calc(var(--header-h) - 1px);
  }

  .main-nav {
    --focus: var(--header-text);
    position: fixed;
    inset: auto 0 0;
    z-index: 40;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0;
    height: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
    padding: 0 0.5rem env(safe-area-inset-bottom, 0px);
    background: var(--header);
    border-top: 1px solid var(--header-border);
  }

  .nav-link {
    flex-direction: column;
    justify-content: center;
    gap: 0.2rem;
    padding: 0.25rem;
    font-size: 0.75rem;
  }

  .nav-link > svg {
    display: block;
    transition: transform var(--dur-2) var(--ease-out);
  }

  .nav-link.active > svg {
    color: var(--accent);
    transform: translateY(-1px);
  }

  .nav-link::after {
    top: -1px;
    bottom: auto;
    left: 28%;
    right: 28%;
  }

  .nav-link:hover::after {
    transform: scaleX(0);
  }

  .nav-link.active::after {
    transform: scaleX(1);
  }

  .count {
    position: absolute;
    top: 0.45rem;
    left: calc(50% + 0.55rem);
    min-width: 1.15rem;
    height: 1.15rem;
    padding: 0 0.25rem;
    box-shadow: 0 0 0 2px var(--header);
    font-size: 0.6875rem;
  }

  .sync-status {
    padding: 0.3rem 0.65rem;
    font-size: 0.6875rem;
  }
}

/* Narrow phones: the sync state gets its own full-width line and is never shortened. */
@media (max-width: 480px) {
  .sync-status {
    flex-basis: 100%;
    margin: -0.1rem 0 0;
    padding: 0.15rem 0;
    border: 0;
    background: none;
    white-space: normal;
  }

  .sync-text {
    overflow: visible;
  }
}

@media (forced-colors: active) {
  .nav-link.active {
    outline: 2px solid Highlight;
  }

  .lamp {
    forced-color-adjust: none;
    border: 1px solid CanvasText;
  }
}
</style>
