<script setup lang="ts">
import {
  Bell,
  BellOff,
  BellRing,
  CircleCheck,
  Clock,
  Download,
  HardDrive,
  Info,
  LogOut,
  Monitor,
  MonitorSmartphone,
  Moon,
  Palette,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  TriangleAlert,
  UserRound,
} from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { getServices, requireSession, signOutUser } from '../auth'
import { usePendingCount } from '../composables/useJobs'
import { buildExport } from '../jobs'
import {
  disableNotifications,
  enableNotifications,
  pushSupport,
  type PushSupport,
} from '../notifications'
import { getMeta } from '../db'
import {
  applyUpdate,
  controlled,
  installPrompt,
  isStandalone,
  needRefresh,
  offlineReady,
  promptInstall,
} from '../pwa'
import { setTheme, themePreference, type ThemePreference } from '../theme'
import { pluralize } from '../ui'

const s = requireSession()
const services = getServices()!
const pending = usePendingCount(s.db)
const emulator = !!services.config.emulator
const appVersion = __APP_VERSION__

const signOutStep = ref<'idle' | 'confirm' | 'remove'>('idle')
const removeConfirmed = ref(false)
const busy = ref(false)
const message = ref<string | null>(null)

const push = ref<PushSupport | null>(null)
const pushEnabled = ref(false)
const storage = ref<{ usage: number; quota: number; persisted: boolean | null } | null>(null)

onMounted(async () => {
  push.value = await pushSupport(services)
  pushEnabled.value = !!(await getMeta<boolean>(s.db, 'notificationsEnabled'))
  await refreshStorage()
})

async function refreshStorage() {
  if (!navigator.storage?.estimate) return
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null
  storage.value = { usage, quota, persisted }
}

/** Shown in the page's role="status" banner, which announces it. */
function say(text: string) {
  message.value = text
}

async function guarded(action: () => Promise<void>) {
  busy.value = true
  try {
    await action()
  } catch (e) {
    say((e as Error).message || 'Something went wrong.')
  } finally {
    busy.value = false
  }
}

const mb = (bytes: number) => {
  const megabytes = bytes / 1024 / 1024
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes.toFixed(1)} MB`
}
const usagePercent = computed(() =>
  storage.value?.quota ? Math.min(100, (storage.value.usage / storage.value.quota) * 100) : 0,
)
const initial = (s.email?.trim()[0] ?? '?').toUpperCase()

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

function startSignOut() {
  if (pending.value > 0) signOutStep.value = 'confirm'
  else void guarded(() => signOutUser())
}

const stayAndSync = () => {
  signOutStep.value = 'idle'
  void s.sync.retryNow()
  say('Staying signed in. Sync requested.')
}

const signOutKeep = () => guarded(() => signOutUser())
const signOutRemove = () => guarded(() => signOutUser({ removeLocalData: true }))

async function exportData() {
  const data = await buildExport(s, s.projectId)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `fieldlog-export-${stamp}.json`,
  })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  say('Export downloaded. It is a readable snapshot, not an encrypted backup.')
}

async function install() {
  const outcome = await promptInstall()
  say(
    outcome === 'accepted'
      ? 'Installation accepted by the browser.'
      : outcome === 'dismissed'
        ? 'Installation was dismissed. You can keep using FieldLog in the browser.'
        : 'The browser is not offering installation right now.',
  )
}

const enablePush = () =>
  guarded(async () => {
    const result = await enableNotifications(services, s)
    push.value = await pushSupport(services)
    pushEnabled.value = result === 'granted'
    say(
      result === 'granted'
        ? 'Notifications are on for this device.'
        : result === 'denied'
          ? 'Notifications are blocked in browser settings. FieldLog works normally without them.'
          : 'Notification permission was not granted.',
    )
  })

const disablePush = () =>
  guarded(async () => {
    await disableNotifications(services, s)
    pushEnabled.value = false
    say('Notifications are off for this device.')
  })

const requestPersistence = () =>
  guarded(async () => {
    const granted = await navigator.storage.persist()
    await refreshStorage()
    say(
      granted
        ? 'The browser granted persistent storage.'
        : 'The browser did not grant persistent storage. Data is still saved, but may be evicted under storage pressure.',
    )
  })

const update = () =>
  guarded(async () => {
    const blocked = await applyUpdate(s)
    if (blocked) say(blocked)
  })
</script>

<template>
  <div class="page container-narrow">
    <div class="page-head">
      <div>
        <h1>Settings</h1>
        <p class="page-sub">This account, this device, and how FieldLog looks and works here.</p>
      </div>
    </div>
    <p v-if="message" class="banner" role="status">
      <Info :size="18" /><span class="banner-body">{{ message }}</span>
    </p>

    <section class="card" aria-labelledby="account-h">
      <h2 id="account-h" class="section-title"><UserRound :size="18" />Account</h2>
      <div class="account">
        <span class="avatar" aria-hidden="true">{{ initial }}</span>
        <div class="account-main">
          <p class="account-email" data-testid="account-email">{{ s.email }}</p>
          <p class="small muted">
            {{ s.projectId }}<template v-if="emulator"> (local emulators)</template>
          </p>
        </div>
      </div>
      <dl class="details small facts">
        <dt>This device</dt>
        <dd class="num">{{ s.deviceId.slice(0, 8) }}</dd>
        <dt>App version</dt>
        <dd data-testid="app-version" class="num">{{ appVersion }}</dd>
      </dl>

      <div v-if="signOutStep === 'idle'" class="row actions">
        <button class="btn" type="button" :disabled="busy" @click="startSignOut">
          <LogOut :size="16" />Sign out
        </button>
        <button
          class="btn btn-danger"
          type="button"
          :disabled="busy"
          @click="signOutStep = 'remove'"
        >
          Remove this account's data from this device…
        </button>
      </div>

      <div
        v-else-if="signOutStep === 'confirm'"
        class="banner banner-warn panel"
        role="alertdialog"
        aria-labelledby="so-h"
      >
        <TriangleAlert :size="18" />
        <div class="banner-body">
          <p id="so-h">
            <strong>{{ pluralize(pending, 'change') }} not synced yet.</strong>
          </p>
          <p>
            If you sign out now, these changes stay on this device but will not sync until this
            account signs in here again.
          </p>
          <div class="row">
            <button class="btn btn-primary" type="button" @click="stayAndSync">
              <RefreshCw :size="16" />Stay signed in and sync
            </button>
            <button class="btn" type="button" :disabled="busy" @click="signOutKeep">
              Sign out and keep changes on this device
            </button>
          </div>
        </div>
      </div>

      <div v-else class="banner banner-danger panel" role="alertdialog" aria-labelledby="rm-h">
        <TriangleAlert :size="18" />
        <div class="banner-body">
          <p id="rm-h">
            <strong>Remove {{ s.email }}'s data from this device</strong>
          </p>
          <p>
            This signs out and deletes this account's jobs and queue from this browser. Data already
            on the server is not affected.
            <strong v-if="pending > 0"
              >{{ pluralize(pending, 'change') }} have not synced and will be lost.</strong
            >
          </p>
          <p>
            <button class="btn btn-small" type="button" @click="exportData">
              <Download :size="16" />Export local data first
            </button>
          </p>
          <label class="check-row">
            <input v-model="removeConfirmed" type="checkbox" />
            I understand unsynced changes on this device will be deleted.
          </label>
          <div class="row actions">
            <button
              class="btn btn-danger-solid"
              type="button"
              :disabled="!removeConfirmed || busy"
              @click="signOutRemove"
            >
              Sign out and remove data
            </button>
            <button class="btn" type="button" @click="signOutStep = 'idle'">Cancel</button>
          </div>
        </div>
      </div>
    </section>

    <section class="card" aria-labelledby="appearance-h">
      <h2 id="appearance-h" class="section-title"><Palette :size="18" />Appearance</h2>
      <fieldset class="segmented theme-choice">
        <legend class="sr-only">Theme</legend>
        <label v-for="option in THEME_OPTIONS" :key="option.value">
          <input
            type="radio"
            name="theme"
            :value="option.value"
            :checked="themePreference === option.value"
            @change="setTheme(option.value)"
          />
          <component :is="option.icon" :size="16" />{{ option.label }}
        </label>
      </fieldset>
      <p class="hint">
        “System” follows your device's light or dark setting. The choice is kept in this browser
        only.
      </p>
    </section>

    <section class="card" aria-labelledby="app-h">
      <h2 id="app-h" class="section-title"><Smartphone :size="18" />App and offline use</h2>
      <p v-if="needRefresh" class="banner banner-warn">
        <Sparkles :size="18" />
        <span class="banner-body row">
          A new version is ready.
          <button class="btn btn-small btn-primary" type="button" :disabled="busy" @click="update">
            Update now
          </button>
        </span>
      </p>
      <p class="status-row" :class="{ ok: offlineReady && controlled }">
        <CircleCheck v-if="offlineReady && controlled" :size="18" />
        <Clock v-else :size="18" />
        <span>
          <template v-if="offlineReady && controlled"
            >This app is ready to open offline on this device.</template
          >
          <template v-else
            >Offline readiness is confirmed once the app's files are cached.</template
          >
        </span>
      </p>
      <template v-if="isStandalone">
        <p class="status-row ok"><MonitorSmartphone :size="18" />Running as an installed app.</p>
      </template>
      <template v-else>
        <button v-if="installPrompt" class="btn btn-primary" type="button" @click="install">
          <Download :size="16" />Install FieldLog
        </button>
        <div v-else class="small install-help">
          <p class="label">To install FieldLog:</p>
          <ul>
            <li>
              Chrome or Edge (desktop or Android): browser menu → <em>Install FieldLog</em> or
              <em>Add to Home screen</em>.
            </li>
            <li>Safari on iPhone/iPad: Share → <em>Add to Home Screen</em>.</li>
            <li>
              Other browsers may not support installation; FieldLog still works in the browser.
            </li>
          </ul>
        </div>
      </template>
    </section>

    <section class="card" aria-labelledby="push-h">
      <h2 id="push-h" class="section-title"><Bell :size="18" />Notifications</h2>
      <p class="small muted">
        Optional. A notification says a job was updated and opens it; it is a hint, not the data
        itself, and delivery is not guaranteed.
      </p>
      <p v-if="!push" class="small">Checking support…</p>
      <template v-else-if="push.state === 'unsupported' || push.state === 'unconfigured'">
        <p class="status-row" data-testid="push-state">
          <BellOff :size="18" /><span>Not available here: {{ push.reason }}</span>
        </p>
      </template>
      <template v-else>
        <p
          class="status-row"
          :class="{ ok: pushEnabled && push.state !== 'denied' }"
          data-testid="push-state"
        >
          <BellOff v-if="push.state === 'denied' || !pushEnabled" :size="18" />
          <BellRing v-else :size="18" />
          <span>
            <template v-if="push.state === 'denied'"
              >Blocked in browser settings. Allow notifications for this site to turn them
              on.</template
            >
            <template v-else-if="pushEnabled">On for this device.</template>
            <template v-else>Off.</template>
          </span>
        </p>
        <button
          v-if="!pushEnabled && push.state !== 'denied'"
          class="btn"
          type="button"
          :disabled="busy"
          @click="enablePush"
        >
          <Bell :size="16" />Enable notifications
        </button>
        <button v-if="pushEnabled" class="btn" type="button" :disabled="busy" @click="disablePush">
          <BellOff :size="16" />Disable notifications
        </button>
      </template>
    </section>

    <section class="card" aria-labelledby="storage-h">
      <h2 id="storage-h" class="section-title"><HardDrive :size="18" />Storage on this device</h2>
      <p v-if="!storage" class="small">Storage details are not available in this browser.</p>
      <template v-else>
        <div class="usage" aria-hidden="true">
          <div class="usage-bar" :style="{ width: `${usagePercent}%` }" />
        </div>
        <p class="small">
          Using {{ mb(storage.usage) }} of about {{ mb(storage.quota) }} available to this site.
          Persistent storage:
          {{
            storage.persisted === null ? 'unknown' : storage.persisted ? 'granted' : 'not granted'
          }}.
        </p>
        <button
          v-if="storage.persisted === false"
          class="btn"
          type="button"
          :disabled="busy"
          @click="requestPersistence"
        >
          <ShieldCheck :size="16" />Ask the browser to keep this data
        </button>
      </template>
      <p class="small muted storage-note">
        Browser storage can still be cleared by you or evicted by the browser. Unsynced changes are
        never deleted automatically by FieldLog.
      </p>
      <button class="btn" type="button" @click="exportData">
        <Download :size="16" />Export local data (JSON)
      </button>
    </section>
  </div>
</template>

<style scoped>
.account {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin: 0.25rem 0 1rem;
}

.avatar {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  background: linear-gradient(150deg, #1f6f5c, #12483b);
  color: #fff;
  font-size: 1.25rem;
  font-weight: 700;
}

.account-main {
  min-width: 0;
}

.account-main p {
  margin: 0;
}

.account-email {
  font-weight: 650;
  overflow-wrap: anywhere;
}

.facts {
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.actions {
  margin-top: 1rem;
}

.panel {
  margin-top: 1rem;
}

.panel p {
  margin-bottom: 0.6rem;
}

.check-row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  font-weight: 500;
  cursor: pointer;
}

.check-row input {
  margin-top: 0.2rem;
}

.theme-choice {
  max-width: 26rem;
  margin-bottom: 0.6rem;
}

.theme-choice label {
  flex: 1 1 0;
}

.status-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.9375rem;
}

.status-row svg {
  margin-top: 0.15rem;
  color: var(--text-3);
}

.status-row.ok svg {
  color: var(--ok);
}

.install-help ul {
  margin: 0.3rem 0 0;
  padding-left: 1.2rem;
  color: var(--text-2);
}

.install-help li + li {
  margin-top: 0.25rem;
}

.usage {
  height: 0.6rem;
  margin: 0.25rem 0 0.75rem;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.usage-bar {
  height: 100%;
  min-width: 0.6rem;
  border-radius: inherit;
  background: var(--accent);
}

.storage-note {
  margin-top: 0.75rem;
}

@media (forced-colors: active) {
  .usage {
    border: 1px solid CanvasText;
  }

  .usage-bar {
    background: Highlight;
  }
}
</style>
