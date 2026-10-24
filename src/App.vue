<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authPhase, configProblems, getServices, session, storageNotice } from './auth'
import { useLiveQuery, useOnline } from './composables/useJobs'
import { isUuid, type JobMessage } from './domain'
import { attachNotifications } from './notifications'
import { applyUpdate, controlled, needRefresh, offlineReady } from './pwa'
import { announce, announcement, phaseMessage, pluralize } from './ui'

const router = useRouter()
const route = useRoute()
const online = useOnline()
const pushBanner = ref<JobMessage | null>(null)
const updateMessage = ref<string | null>(null)
const offlineReadyDismissed = ref(false)

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
let detachNotifications: (() => void) | null = null
watch(
  session,
  (s) => {
    detachNotifications?.()
    detachNotifications = null
    pushBanner.value = null
    const services = getServices()
    if (s && services) {
      detachNotifications = attachNotifications(services, s, (message) => {
        pushBanner.value = message
        s.sync.request('push')
      })
    }
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
  updateMessage.value = await applyUpdate(session.value)
  if (updateMessage.value) announce(updateMessage.value)
}

function openPushedJob() {
  const jobId = pushBanner.value?.jobId
  pushBanner.value = null
  if (jobId) void router.push(`/jobs/${jobId}`)
}
</script>

<template>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="app-header">
    <div class="container header-row">
      <RouterLink to="/jobs" class="brand">FieldLog</RouterLink>
      <nav v-if="session" aria-label="Main">
        <RouterLink to="/jobs">Jobs</RouterLink>
        <RouterLink to="/sync">
          Sync center<span v-if="pending" class="count" :aria-label="`${pending} waiting`">{{
            pending
          }}</span>
        </RouterLink>
        <RouterLink to="/settings">Settings</RouterLink>
      </nav>
    </div>
    <div v-if="session" class="status-line" data-testid="status-line">
      <div class="container small">
        <span aria-hidden="true">{{ online ? '◉' : '○' }}</span> {{ statusText }}
      </div>
    </div>
  </header>

  <div class="container">
    <p v-if="storageNotice" class="banner banner-warn" role="alert">{{ storageNotice }}</p>
    <div v-if="needRefresh" class="banner banner-warn row" role="status">
      <span>A new version of FieldLog is ready.</span>
      <button class="btn btn-small" type="button" @click="update">Update now</button>
      <span v-if="updateMessage" class="small">{{ updateMessage }}</span>
    </div>
    <div
      v-if="offlineReady && controlled && !offlineReadyDismissed && !needRefresh"
      class="banner banner-ok row"
      role="status"
      data-testid="offline-ready"
    >
      <span>FieldLog is ready to work offline on this device.</span>
      <button class="btn btn-small" type="button" @click="offlineReadyDismissed = true">
        Dismiss
      </button>
    </div>
    <div v-if="pushBanner" class="banner row" role="status">
      <span>A job was updated.</span>
      <button class="btn btn-small" type="button" @click="openPushedJob">Open job</button>
      <button class="btn btn-small" type="button" @click="pushBanner = null">Dismiss</button>
    </div>
  </div>

  <main id="main" class="container" tabindex="-1">
    <div v-if="authPhase === 'unconfigured'" class="page">
      <h1>FieldLog needs configuration</h1>
      <p>
        Copy <code>.env.example</code> to <code>.env.local</code> and fill in the public Firebase
        web config, or run in emulator mode.
      </p>
      <ul>
        <li v-for="p in configProblems" :key="p">{{ p }}</li>
      </ul>
    </div>
    <p v-else-if="authPhase === 'starting' || authPhase === 'opening'" class="page muted">
      Opening FieldLog…
    </p>
    <div v-else-if="authPhase === 'storage_error'" class="page">
      <h1>Local storage unavailable</h1>
      <p>{{ storageNotice }}</p>
    </div>
    <RouterView
      v-else-if="session || route.meta.public"
      :key="session?.generation ?? 'signed-out'"
    />
  </main>

  <div class="sr-only" aria-live="polite" aria-atomic="true">{{ announcement }}</div>
</template>

<style scoped>
.app-header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.header-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  padding-top: 0.6rem;
  padding-bottom: 0.6rem;
}

.brand {
  font-weight: 800;
  font-size: 1.15rem;
  color: var(--text);
  text-decoration: none;
}

nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
}

nav a {
  color: var(--text);
  text-decoration: none;
  padding: 0.25rem 0;
  border-bottom: 2px solid transparent;
}

nav a.router-link-active {
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.count {
  display: inline-block;
  margin-left: 0.35rem;
  min-width: 1.4rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--warn-soft);
  border: 1px solid var(--warn);
  font-size: 0.8rem;
  text-align: center;
}

.status-line {
  background: var(--surface-2);
  border-top: 1px solid var(--border);
  padding: 0.3rem 0;
}

main:focus {
  outline: none;
}
</style>
