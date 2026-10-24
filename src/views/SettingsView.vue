<script setup lang="ts">
import { onMounted, ref } from 'vue'
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
import { announce, pluralize } from '../ui'

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

function say(text: string) {
  message.value = text
  announce(text)
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

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

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
  <div class="page">
    <h1>Settings</h1>
    <p v-if="message" class="banner" role="status">{{ message }}</p>

    <section class="card" aria-labelledby="account-h">
      <h2 id="account-h">Account</h2>
      <dl class="details small">
        <dt>Signed in as</dt>
        <dd data-testid="account-email">{{ s.email }}</dd>
        <dt>Project</dt>
        <dd>{{ s.projectId }}<template v-if="emulator"> (local emulators)</template></dd>
        <dt>This device</dt>
        <dd>{{ s.deviceId.slice(0, 8) }}</dd>
        <dt>App version</dt>
        <dd data-testid="app-version">{{ appVersion }}</dd>
      </dl>

      <div v-if="signOutStep === 'idle'" class="row actions">
        <button class="btn" type="button" :disabled="busy" @click="startSignOut">Sign out</button>
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
        class="banner banner-warn"
        role="alertdialog"
        aria-labelledby="so-h"
      >
        <p id="so-h">
          <strong>{{ pluralize(pending, 'change') }} not synced yet.</strong>
        </p>
        <p>
          If you sign out now, these changes stay on this device but will not sync until this
          account signs in here again.
        </p>
        <div class="row">
          <button class="btn btn-primary" type="button" @click="stayAndSync">
            Stay signed in and sync
          </button>
          <button class="btn" type="button" :disabled="busy" @click="signOutKeep">
            Sign out and keep changes on this device
          </button>
        </div>
      </div>

      <div v-else class="banner banner-danger" role="alertdialog" aria-labelledby="rm-h">
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
            Export local data first
          </button>
        </p>
        <label class="row">
          <input v-model="removeConfirmed" type="checkbox" class="check" />
          I understand unsynced changes on this device will be deleted.
        </label>
        <div class="row actions">
          <button
            class="btn btn-danger"
            type="button"
            :disabled="!removeConfirmed || busy"
            @click="signOutRemove"
          >
            Sign out and remove data
          </button>
          <button class="btn" type="button" @click="signOutStep = 'idle'">Cancel</button>
        </div>
      </div>
    </section>

    <section class="card" aria-labelledby="app-h">
      <h2 id="app-h">App and offline use</h2>
      <p v-if="needRefresh" class="banner banner-warn">
        A new version is ready.
        <button class="btn btn-small" type="button" :disabled="busy" @click="update">
          Update now
        </button>
      </p>
      <p class="small">
        <template v-if="offlineReady && controlled"
          >This app is ready to open offline on this device.</template
        >
        <template v-else>Offline readiness is confirmed once the app's files are cached.</template>
      </p>
      <template v-if="isStandalone">
        <p class="small">Running as an installed app.</p>
      </template>
      <template v-else>
        <button v-if="installPrompt" class="btn" type="button" @click="install">
          Install FieldLog
        </button>
        <div v-else class="small">
          <p>To install FieldLog:</p>
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
      <h2 id="push-h">Notifications</h2>
      <p class="small muted">
        Optional. A notification says a job was updated and opens it; it is a hint, not the data
        itself, and delivery is not guaranteed.
      </p>
      <p v-if="!push" class="small">Checking support…</p>
      <template v-else-if="push.state === 'unsupported' || push.state === 'unconfigured'">
        <p class="small" data-testid="push-state">Not available here: {{ push.reason }}</p>
      </template>
      <template v-else>
        <p class="small" data-testid="push-state">
          <template v-if="push.state === 'denied'"
            >Blocked in browser settings. Allow notifications for this site to turn them
            on.</template
          >
          <template v-else-if="pushEnabled">On for this device.</template>
          <template v-else>Off.</template>
        </p>
        <button
          v-if="!pushEnabled && push.state !== 'denied'"
          class="btn"
          type="button"
          :disabled="busy"
          @click="enablePush"
        >
          Enable notifications
        </button>
        <button v-if="pushEnabled" class="btn" type="button" :disabled="busy" @click="disablePush">
          Disable notifications
        </button>
      </template>
    </section>

    <section class="card" aria-labelledby="storage-h">
      <h2 id="storage-h">Storage on this device</h2>
      <p v-if="!storage" class="small">Storage details are not available in this browser.</p>
      <template v-else>
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
          Ask the browser to keep this data
        </button>
      </template>
      <p class="small muted">
        Browser storage can still be cleared by you or evicted by the browser. Unsynced changes are
        never deleted automatically by FieldLog.
      </p>
      <button class="btn" type="button" @click="exportData">Export local data (JSON)</button>
    </section>
  </div>
</template>

<style scoped>
.actions {
  margin-top: 0.75rem;
}

.check {
  width: auto;
  min-height: auto;
}
</style>
