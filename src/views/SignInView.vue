<script setup lang="ts">
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { ref } from 'vue'
import { getServices, signIn } from '../auth'
import { useOnline } from '../composables/useJobs'

const email = ref('')
const password = ref('')
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
  <div class="page">
    <div class="card signin">
      <h1>Sign in to FieldLog</h1>
      <p class="muted">
        Sign in once while online. After that, FieldLog keeps working on this device without a
        connection: jobs already downloaded here and the changes you make are stored on the device
        and sync when you are back online.
      </p>
      <p v-if="!online" class="banner banner-warn" role="status">
        You appear to be offline. Signing in for the first time needs a network connection.
      </p>
      <p v-if="emulator" class="banner small">
        Development mode: using the local Firebase emulators (demo project). No real data is used.
      </p>
      <form @submit.prevent="submit()" novalidate>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" v-model.trim="email" type="email" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
        <div class="row">
          <button class="btn btn-primary" type="submit" :disabled="busy || !email || !password">
            {{ busy ? 'Signing in…' : 'Sign in' }}
          </button>
          <button
            v-if="emulator"
            class="btn"
            type="button"
            :disabled="busy || !email || !password"
            @click="submit(true)"
          >
            Create emulator account
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.signin {
  max-width: 28rem;
  margin: 1rem auto;
}
</style>
