<script setup lang="ts">
import { createUserWithEmailAndPassword } from 'firebase/auth'
import {
  CircleAlert,
  CloudOff,
  Eye,
  EyeOff,
  FlaskConical,
  GitMerge,
  LoaderCircle,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from '@lucide/vue'
import { ref } from 'vue'
import { getServices, signIn } from '../auth'
import BrandMark from '../components/BrandMark.vue'
import { useOnline } from '../composables/useJobs'

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const online = useOnline()
const emulator = !!getServices()?.config.emulator

function describe(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  if (code === 'auth/network-request-failed')
    return 'Cannot reach the sign-in service. Signing in needs a network connection.'
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return 'That email and password do not match an account.'
  }
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a moment and try again.'
  if (code === 'auth/email-already-in-use')
    return 'An account with this email already exists. Sign in instead.'
  if (code === 'auth/weak-password') return 'Choose a password with at least 6 characters.'
  return 'Sign-in failed. Please try again.'
}

async function submit(create = false) {
  error.value = null
  busy.value = true
  try {
    if (create)
      await createUserWithEmailAndPassword(getServices()!.auth, email.value, password.value)
    else await signIn(email.value, password.value)
    // The auth listener opens this account's local data and the app navigates on.
  } catch (e) {
    error.value = describe(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page signin-page">
    <div class="signin-layout">
      <div class="card signin">
        <h1>Sign in to FieldLog</h1>
        <p class="muted lead">
          Sign in once while online. After that, FieldLog keeps working on this device without a
          connection: jobs already downloaded here and the changes you make are stored on the device
          and sync when you are back online.
        </p>
        <p v-if="!online" class="banner banner-warn" role="status">
          <WifiOff :size="18" />
          <span class="banner-body"
            >You appear to be offline. Signing in for the first time needs a network
            connection.</span
          >
        </p>
        <p v-if="emulator" class="banner small">
          <FlaskConical :size="18" />
          <span class="banner-body"
            >Development mode: using the local Firebase emulators (demo project). No real data is
            used.</span
          >
        </p>
        <form novalidate @submit.prevent="submit()">
          <div class="field">
            <label for="email">Email</label>
            <input
              id="email"
              v-model.trim="email"
              type="email"
              inputmode="email"
              autocomplete="username"
              autocapitalize="off"
              spellcheck="false"
              required
            />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <div class="password">
              <input
                id="password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                required
              />
              <button
                class="btn btn-ghost btn-icon reveal"
                type="button"
                :aria-pressed="showPassword"
                aria-controls="password"
                @click="showPassword = !showPassword"
              >
                <EyeOff v-if="showPassword" :size="18" />
                <Eye v-else :size="18" />
                <span class="sr-only">Show password</span>
              </button>
            </div>
          </div>
          <p v-if="error" class="error-text form-error" role="alert">
            <CircleAlert :size="16" />{{ error }}
          </p>
          <div class="buttons">
            <button
              class="btn btn-primary btn-block"
              type="submit"
              :disabled="busy || !email || !password"
            >
              <LoaderCircle v-if="busy" :size="18" class="spin" />
              {{ busy ? 'Signing in…' : 'Sign in' }}
            </button>
            <button
              v-if="emulator"
              class="btn btn-block"
              type="button"
              :disabled="busy || !email || !password"
              @click="submit(true)"
            >
              Create emulator account
            </button>
          </div>
        </form>
      </div>

      <section class="intro" aria-labelledby="intro-h">
        <BrandMark :size="44" />
        <h2 id="intro-h" class="intro-title">Job tracking that keeps working without signal.</h2>
        <ul class="plain features">
          <li>
            <CloudOff :size="20" />
            <span
              ><strong>Works offline.</strong> View and update jobs in basements, plant rooms and
              rural sites.</span
            >
          </li>
          <li>
            <RefreshCw :size="20" />
            <span
              ><strong>Syncs when you are back.</strong> Changes upload in order, and each one is
              applied exactly once.</span
            >
          </li>
          <li>
            <GitMerge :size="20" />
            <span
              ><strong>Nothing silently lost.</strong> Edits from two devices are merged, and real
              conflicts are shown to you.</span
            >
          </li>
        </ul>
        <p class="intro-foot">
          <span><MonitorSmartphone :size="16" />Install it on a phone or desktop</span>
          <span><ShieldCheck :size="16" />Each account's data kept separate</span>
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.signin-page {
  padding-top: 2.5rem;
}

.signin-layout {
  display: grid;
  gap: 1.5rem;
  align-items: stretch;
}

@media (min-width: 860px) {
  .signin-layout {
    grid-template-columns: 1fr minmax(24rem, 28rem);
    gap: 2.5rem;
  }

  /* The form comes first in the document (and on phones); the intro sits on its left here. */
  .intro {
    order: -1;
  }
}

.intro {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 2.25rem;
  border-radius: var(--radius-lg);
  color: #f2fbf7;
  background:
    radial-gradient(circle at 85% 15%, rgb(255 255 255 / 14%), transparent 40%),
    radial-gradient(circle at 10% 95%, rgb(82 199 164 / 35%), transparent 45%),
    linear-gradient(150deg, #1f6f5c, #12483b 70%);
  box-shadow: var(--shadow-lg);
}

.intro-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
  margin: auto 0 0;
  padding-top: 2rem;
  color: rgb(242 251 247 / 80%);
  font-size: 0.875rem;
}

.intro-foot span {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.intro :deep(.brand-mark) {
  border-radius: 12px;
  box-shadow: 0 0 0 3px rgb(255 255 255 / 20%);
}

.intro-title {
  margin: 1.5rem 0 1.75rem;
  max-width: 26rem;
  font-size: clamp(1.45rem, 1.1rem + 1.2vw, 2rem);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.025em;
}

.features {
  display: grid;
  gap: 1.1rem;
  max-width: 30rem;
}

.features li {
  display: flex;
  gap: 0.8rem;
  line-height: 1.5;
  color: rgb(242 251 247 / 88%);
}

.features strong {
  color: #fff;
}

.features svg {
  margin-top: 0.15rem;
  padding: 0.35rem;
  box-sizing: content-box;
  border-radius: 10px;
  background: rgb(255 255 255 / 12%);
  color: #fff;
}

.signin {
  padding: 2rem;
}

.signin h1 {
  font-size: 1.625rem;
}

.lead {
  font-size: 0.9375rem;
}

.password {
  position: relative;
}

.password input {
  padding-right: 3rem;
}

.reveal {
  position: absolute;
  right: 0.25rem;
  top: 50%;
  transform: translateY(-50%);
  min-height: 2.25rem;
  min-width: 2.25rem;
  padding: 0.25rem;
  color: var(--text-2);
}

.reveal:active:not(:disabled) {
  transform: translateY(-50%);
}

.form-error {
  margin-bottom: 1rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
}

.buttons {
  display: grid;
  gap: 0.6rem;
  margin-top: 0.4rem;
}

.buttons .btn {
  min-height: 2.875rem;
}

@media (max-width: 859px) {
  .signin-page {
    padding-top: 1.25rem;
  }

  .intro {
    padding: 1.5rem;
  }

  .intro-title {
    margin: 1rem 0 1.25rem;
  }

  .signin {
    padding: 1.5rem;
  }
}

@media (max-width: 640px) {
  .features {
    gap: 0.8rem;
    font-size: 0.9375rem;
  }

  .signin {
    padding: 1.25rem;
  }
}
</style>
