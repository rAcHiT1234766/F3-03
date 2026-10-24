<script setup lang="ts">
import {
  Bell,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Cloud,
  CloudAlert,
  CloudOff,
  LoaderCircle,
  RefreshCw,
  Settings,
  Sparkles,
  TriangleAlert,
  X,
} from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authPhase, configProblems, getServices, session, storageNotice } from './auth'
import BrandMark from './components/BrandMark.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
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
const statusIcon = computed<Component>(() => {
  if (!online.value) return CloudOff
  if (phase.value === 'syncing') return LoaderCircle
  if (phase.value === 'unreachable') return CloudAlert
  if (statusTone.value === 'danger') return CircleAlert
  return Cloud
})

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
          <BrandMark :size="30" />
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
          <component :is="statusIcon" :size="16" :class="{ spin: statusIcon === LoaderCircle }" />
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
        <h1>FieldLog needs configuration</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env.local</code> and fill in the public Firebase
          web config, or run in emulator mode.
        </p>
        <ul>
          <li v-for="p in configProblems" :key="p">{{ p }}</li>
        </ul>
      </div>
      <p v-else-if="authPhase === 'starting' || authPhase === 'opening'" class="page muted opening">
        <LoaderCircle :size="18" class="spin" /> Opening FieldLog…
      </p>
      <div v-else-if="authPhase === 'storage_error'" class="page container-narrow">
        <h1>Local storage unavailable</h1>
        <p>{{ storageNotice }}</p>
      </div>
      <RouterView
        v-else-if="session || route.meta.public"
        :key="session?.generation ?? 'signed-out'"
      />
    </main>

    <!-- Transient notices come after the page content, so they never push it down. -->
    <div class="toasts container">
      <div v-if="needRefresh && !updateDeferred" class="toast toast-update" role="status">
        <Sparkles :size="20" class="toast-icon" />
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
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: saturate(1.4) blur(10px);
  border-bottom: 1px solid var(--border);
}

.header-row {
  display: flex;
  align-items: center;
  gap: 0.75rem 1.5rem;
  min-height: var(--header-h);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  margin-left: -0.25rem;
  padding: 0.25rem;
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 1.125rem;
  font-weight: 750;
  letter-spacing: -0.02em;
  text-decoration: none;
}

.brand:hover {
  color: var(--text);
}

.main-nav {
  display: flex;
  gap: 0.25rem;
}

.nav-link {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0.4rem 0.8rem;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: 0.9375rem;
  font-weight: 550;
  text-decoration: none;
  transition:
    background-color 0.15s var(--ease),
    color 0.15s var(--ease);
}

.nav-link:hover {
  background: var(--surface-3);
  color: var(--text);
}

.nav-link.active {
  background: var(--accent-soft);
  color: var(--accent-soft-text);
  font-weight: 650;
}

.count {
  display: inline-grid;
  place-items: center;
  min-width: 1.3rem;
  height: 1.3rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--warn);
  color: var(--surface);
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1;
}

.sync-status {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  margin-left: auto;
  padding: 0.35rem 0.8rem;
  white-space: nowrap;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  font-size: 0.8125rem;
  font-weight: 550;
  text-decoration: none;
}

.sync-status:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

/* Long states shorten with an ellipsis here; the full text stays in the DOM and the tooltip,
   and the Sync center shows every detail. */
.sync-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tone-ok svg {
  color: var(--ok);
}

.tone-busy svg {
  color: var(--info);
}

.tone-warn {
  background: var(--warn-soft);
  border-color: color-mix(in srgb, var(--warn) 35%, transparent);
  color: var(--text);
}

.tone-warn svg {
  color: var(--warn);
}

.tone-danger {
  background: var(--danger-soft);
  border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  color: var(--text);
}

.tone-danger svg {
  color: var(--danger);
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
  gap: 0.5rem;
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

.toast {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem 0.8rem;
  width: min(100%, 40rem);
  padding: 0.75rem 0.75rem 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
  animation: toast-in 0.2s var(--ease);
}

.toast-icon {
  color: var(--info);
}

.toast-ok .toast-icon {
  color: var(--ok);
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
  color: var(--text-2);
}

.toast-actions {
  display: flex;
  gap: 0.4rem;
  margin-left: auto;
}

/* Slide only: fading text would briefly fall below the contrast minimum. */
@keyframes toast-in {
  from {
    transform: translateY(12px);
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

  /* backdrop-filter would make the header the containing block of the fixed tab bar. */
  .app-header {
    background: var(--surface);
    backdrop-filter: none;
  }

  .header-row {
    flex-wrap: wrap;
    gap: 0.5rem;
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
    min-height: calc(var(--header-h) - 1px);
  }

  .main-nav {
    position: fixed;
    inset: auto 0 0;
    z-index: 40;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0;
    height: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
    padding: 0.35rem 0.5rem env(safe-area-inset-bottom, 0px);
    background: var(--surface);
    border-top: 1px solid var(--border);
    box-shadow: 0 -4px 16px rgb(0 0 0 / 6%);
  }

  .nav-link {
    flex-direction: column;
    justify-content: center;
    gap: 0.2rem;
    padding: 0.25rem;
    font-size: 0.75rem;
    border-radius: var(--radius);
  }

  .nav-link.active {
    background: transparent;
  }

  .nav-link.active svg {
    background: var(--accent-soft);
    border-radius: 999px;
    padding: 0.15rem 1rem;
    box-sizing: content-box;
  }

  .count {
    position: absolute;
    top: 0.15rem;
    left: calc(50% + 0.45rem);
    min-width: 1.15rem;
    height: 1.15rem;
    padding: 0 0.25rem;
    border: 2px solid var(--surface);
    box-sizing: content-box;
    font-size: 0.6875rem;
  }

  .sync-status {
    padding: 0.3rem 0.7rem;
    font-size: 0.75rem;
  }
}

/* Narrow phones: the sync state gets its own full-width line and is never shortened. */
@media (max-width: 480px) {
  .sync-status {
    flex-basis: 100%;
    justify-content: center;
    margin-left: 0;
    white-space: normal;
    text-align: center;
  }

  .sync-text {
    overflow: visible;
  }
}

@media (forced-colors: active) {
  .nav-link.active {
    outline: 2px solid Highlight;
  }
}
</style>
