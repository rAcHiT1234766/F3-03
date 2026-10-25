<script setup lang="ts">
import { createUserWithEmailAndPassword } from 'firebase/auth'
import {
  ArrowRight,
  CircleAlert,
  Eye,
  EyeOff,
  FlaskConical,
  LoaderCircle,
  WifiOff,
} from '@lucide/vue'
import { ref } from 'vue'
import { getServices, signIn } from '../auth'
import SignalBars from '../components/SignalBars.vue'
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

<!-- The form comes first in the document. On wide screens it sits beside an ink cover that runs
     from the app bar to the bottom of the window, and stays in view while a cover taller than the
     window scrolls; on phones the cover is a band above it. -->
<template>
  <div class="signin-page">
    <div class="form-column">
      <div class="signin-form">
        <p v-if="emulator" class="dev-tag">
          <FlaskConical :size="14" />Emulator mode · demo data only
        </p>
        <h1>Sign in to FieldLog</h1>
        <p class="lead">
          Sign in once while online. After that, FieldLog keeps working on this device without a
          connection.
        </p>
        <p v-if="!online" class="banner banner-warn" role="status">
          <WifiOff :size="18" />
          <span class="banner-body"
            >You appear to be offline. Signing in for the first time needs a network
            connection.</span
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
              class="btn btn-primary btn-block submit"
              type="submit"
              :disabled="busy || !email || !password"
            >
              <LoaderCircle v-if="busy" :size="18" class="spin" />
              {{ busy ? 'Signing in…' : 'Sign in' }}
              <ArrowRight v-if="!busy" :size="18" class="go" />
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
        <p class="no-account">
          No account? Ask whoever manages FieldLog for your team to create one.
        </p>
      </div>
    </div>

    <div class="ink">
      <div class="cover">
        <p class="cover-eyebrow" aria-hidden="true">For field service teams</p>
        <p class="statement">
          <span class="line"><span>Job sheets that keep working</span></span>
          <span class="line line-accent"><span>where the signal doesn’t.</span></span>
        </p>
        <!-- Decorative: the signal drops out, the work carries on, then it catches up. -->
        <div class="readout" aria-hidden="true">
          <SignalBars :size="44" motion="drop" />
          <span class="readout-text">
            <span class="readout-state state-synced">All changes synced</span>
            <span class="readout-state state-offline">No signal · saved on this device</span>
            <span class="readout-state state-back">Back online · syncing</span>
          </span>
        </div>
      </div>

      <section class="docket" aria-labelledby="docket-title">
        <h2 id="docket-title" class="docket-title">How it works offline</h2>
        <ol class="plain docket-list">
          <li>
            <span class="docket-num" aria-hidden="true">01</span>
            <p>
              <strong>No signal, no problem.</strong> Open and update jobs in basements, plant rooms
              and rural sites.
            </p>
          </li>
          <li>
            <span class="docket-num" aria-hidden="true">02</span>
            <p>
              <strong>It catches up on its own.</strong> Changes upload in order once you are back
              online, and each one is applied exactly once.
            </p>
          </li>
          <li>
            <span class="docket-num" aria-hidden="true">03</span>
            <p>
              <strong>Nothing silently lost.</strong> Edits from two devices are merged, and real
              conflicts are shown to you.
            </p>
          </li>
        </ol>
        <p class="docket-foot">
          Installs on a phone or desktop · Each account’s data is kept separate
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* ---------- Layout ---------- */

/* Phones: an ink band above the form, then the docket on paper. */
.signin-page {
  display: grid;
  grid-template-areas:
    'cover'
    'form'
    'docket';
}

.ink {
  display: contents;
}

/* The ink is a real background on the element that holds the words, so contrast checks can read
   it. Layers behind stretch it to the window edges and lay grid paper over it; the app shell
   clips what runs past the window. */
.cover {
  grid-area: cover;
  position: relative;
  isolation: isolate;
  padding: 1.75rem 0 2rem;
  background: var(--header);
  color: var(--header-text);
}

.form-column {
  grid-area: form;
}

.signin-form {
  width: 100%;
  max-width: 28rem;
  padding: 2rem 0 0.5rem;
  animation: settle var(--dur-3) var(--ease-out) 120ms backwards;
}

.docket {
  grid-area: docket;
  --ink-text: var(--text);
  --ink-text-2: var(--text-2);
  --ink-rule: var(--border);
  --num: var(--accent-ink);
  margin-top: 2.25rem;
  padding-bottom: 2.5rem;
  color: var(--ink-text);
}

@media (max-width: 899px) {
  .cover::before,
  .cover::after {
    content: '';
    position: absolute;
    inset: 0 -50vw;
    z-index: -1;
    pointer-events: none;
  }

  .cover::before {
    background: var(--header);
  }

  .cover::after {
    background-image:
      linear-gradient(rgb(242 241 236 / 5%) 1px, transparent 1px),
      linear-gradient(90deg, rgb(242 241 236 / 5%) 1px, transparent 1px);
    background-size: 24px 24px;
    mask-image: linear-gradient(170deg, #000 10%, transparent 75%);
  }
}

/* Wide screens: the ink fills the left column from the app bar to the bottom of the window. */
@media (min-width: 900px) {
  .signin-page {
    grid-template-columns: minmax(0, 1fr) minmax(22rem, 25rem);
    grid-template-areas: 'ink form';
    column-gap: clamp(3rem, 7vw, 6.5rem);
    min-height: calc(100dvh - var(--header-h) - 1px);
  }

  .ink {
    grid-area: ink;
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    padding-right: 3rem;
    background: var(--header);
    color: var(--header-text);
  }

  /* Past the bottom as well, so the ink still meets the window edge when a notice adds space
     under the page. */
  .ink::before,
  .ink::after {
    content: '';
    position: absolute;
    inset: 0 0 -100vh -50vw;
    z-index: -1;
    pointer-events: none;
  }

  /* A hairline where the ink meets the paper keeps the edge crisp in the dark theme. */
  .ink::before {
    background: var(--header);
    box-shadow: inset -1px 0 0 var(--header-border);
  }

  .ink::after {
    background-image:
      linear-gradient(rgb(242 241 236 / 5%) 1px, transparent 1px),
      linear-gradient(90deg, rgb(242 241 236 / 5%) 1px, transparent 1px);
    background-size: 24px 24px;
    mask-image: linear-gradient(170deg, #000 0, transparent 46rem);
  }

  .cover {
    isolation: auto;
    padding: clamp(2.5rem, 7vh, 4.5rem) 0 2.5rem;
    background: none;
  }

  /* The form stays centred in the window below the app bar; only the cover moves when it is taller
     than the window. At the end of the page the column follows the page, so a form taller than a
     very short window can still be scrolled into view. */
  .form-column {
    position: sticky;
    top: calc(var(--header-h) + 1px);
    align-self: start;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: calc(100dvh - var(--header-h) - 1px);
  }

  .signin-form {
    padding: clamp(1.5rem, 6vh, 3rem) 0;
  }

  .docket {
    --ink-text: var(--header-text);
    --ink-text-2: var(--header-text-2);
    --ink-rule: rgb(242 241 236 / 13%);
    --num: var(--accent);
    margin-top: auto;
    padding: 0 0 2.5rem;
  }
}

/* ---------- Cover ---------- */

.cover-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin: 0 0 1.25rem;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.cover-eyebrow::before {
  content: '';
  width: 1.5rem;
  height: 2px;
  background: currentcolor;
}

.statement {
  max-width: 13em;
  margin: 0;
  font-size: clamp(2.125rem, 1.1rem + 3.4vw, 4rem);
  font-weight: 700;
  font-stretch: var(--condensed);
  line-height: 1;
  letter-spacing: -0.025em;
}

/* Each part rises out of its own line, the way a printed sheet slides out of a sleeve. */
.line {
  display: block;
  overflow: hidden;
  padding: 0.05em 0 0.14em;
  margin: -0.05em 0 -0.14em;
}

.line > span {
  display: block;
  text-wrap: balance;
  animation: reveal 760ms var(--ease-out) 80ms backwards;
}

.line-accent {
  color: var(--accent);
}

.line-accent > span {
  animation-delay: 190ms;
}

@keyframes reveal {
  from {
    transform: translateY(112%);
  }
}

.readout {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  margin-top: clamp(2rem, 5vh, 3.25rem);
  color: var(--accent);
}

.readout-text {
  display: grid;
  padding-bottom: 0.1rem;
  color: var(--header-text-2);
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Three captions share one cell and take turns with the bars (7 s cycle, see SignalBars). */
.readout-state {
  grid-area: 1 / 1;
  animation: 7s linear infinite;
}

.state-synced {
  animation-name: caption-synced;
}

.state-offline {
  visibility: hidden;
  color: var(--header-text);
  animation-name: caption-offline;
}

.state-back {
  visibility: hidden;
  animation-name: caption-back;
}

@keyframes caption-synced {
  0%,
  51.9% {
    visibility: visible;
  }

  52%,
  100% {
    visibility: hidden;
  }
}

@keyframes caption-offline {
  0%,
  51.9% {
    visibility: hidden;
  }

  52%,
  84.9% {
    visibility: visible;
  }

  85%,
  100% {
    visibility: hidden;
  }
}

@keyframes caption-back {
  0%,
  84.9% {
    visibility: hidden;
  }

  85%,
  100% {
    visibility: visible;
  }
}

/* ---------- Form ---------- */

.dev-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 1.1rem;
  padding: 0.25rem 0.55rem;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-xs);
  color: var(--text-2);
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

h1 {
  margin-bottom: 0.6rem;
  font-size: clamp(2rem, 1.7rem + 1vw, 2.375rem);
}

.lead {
  margin-bottom: 1.6rem;
  color: var(--text-2);
}

.signin-form .banner {
  margin: -0.4rem 0 1.4rem;
}

.signin-form input:not([type='checkbox']) {
  min-height: 3rem;
}

.password {
  position: relative;
}

.password input {
  padding-right: 3.25rem;
}

.reveal {
  position: absolute;
  right: 0.3rem;
  top: 50%;
  transform: translateY(-50%);
  min-height: 2.375rem;
  min-width: 2.375rem;
  padding: 0.25rem;
  color: var(--text-2);
}

.reveal:active:not(:disabled) {
  transform: translateY(-50%);
}

.reveal[aria-pressed='true'] {
  color: var(--text);
}

.form-error {
  margin: 0 0 1.1rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border));
  border-left: 3px solid var(--danger);
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
}

.buttons {
  display: grid;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.submit {
  min-height: 3.125rem;
  font-size: 1rem;
}

.go {
  transition: transform var(--dur-2) var(--ease-out);
}

.submit:hover:not(:disabled) .go {
  transform: translateX(3px);
}

.no-account {
  margin: 1.75rem 0 0;
  padding-top: 1rem;
  border-top: 1px dashed var(--border-strong);
  color: var(--text-2);
  font-size: 0.875rem;
}

/* ---------- Docket ---------- */

.docket-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0 0 0.25rem;
  color: var(--ink-text-2);
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.docket-title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--ink-rule);
}

.docket-list li {
  display: grid;
  grid-template-columns: 2.5rem 1fr;
  gap: 0.25rem;
  padding: 0.85rem 0;
  border-bottom: 1px solid var(--ink-rule);
  animation: settle var(--dur-3) var(--ease-out) backwards;
}

.docket-list li:nth-child(1) {
  animation-delay: 260ms;
}

.docket-list li:nth-child(2) {
  animation-delay: 320ms;
}

.docket-list li:nth-child(3) {
  animation-delay: 380ms;
}

.docket-num {
  padding-top: 0.15rem;
  color: var(--num);
  font-family: var(--mono);
  font-size: 0.8125rem;
  font-weight: 600;
}

.docket-list p {
  max-width: 34rem;
  margin: 0;
  color: var(--ink-text-2);
  font-size: 0.9375rem;
}

.docket-list strong {
  color: var(--ink-text);
  font-weight: 650;
}

.docket-foot {
  margin: 1rem 0 0;
  color: var(--ink-text-2);
  font-family: var(--mono);
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ---------- Phones ---------- */

@media (max-width: 899px) {
  .statement {
    max-width: 11em;
  }

  /* The bars move up beside the eyebrow; the captions stay with the wide layout. */
  .readout {
    position: absolute;
    top: 1.5rem;
    right: 0;
    margin: 0;
  }

  .readout :deep(.signal) {
    width: 28px;
    height: 28px;
  }

  .readout-text {
    display: none;
  }
}

@media (forced-colors: active) {
  .cover::after,
  .ink::after {
    display: none;
  }
}
</style>
