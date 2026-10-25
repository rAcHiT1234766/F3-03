<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { confirmRequest, registerDialogHost } from '../dialog'

// Native modal <dialog>: the browser traps focus, makes the page inert and closes on Escape.
const dialog = ref<HTMLDialogElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null

const unregister = registerDialogHost()
onBeforeUnmount(() => {
  unregister()
  settle(false)
})

watch(confirmRequest, async (request) => {
  if (!request) return
  if (!dialog.value?.open) returnFocus = document.activeElement as HTMLElement | null
  await nextTick()
  if (dialog.value && !dialog.value.open) dialog.value.showModal()
  // Destructive actions start on the safe choice.
  ;(request.danger ? cancelButton.value : confirmButton.value)?.focus()
})

function settle(confirmed: boolean) {
  const request = confirmRequest.value
  if (!request) return
  confirmRequest.value = null
  if (dialog.value?.open) dialog.value.close()
  request.resolve(confirmed)
  if (returnFocus?.isConnected) returnFocus.focus()
  returnFocus = null
}

/** A click on the backdrop lands on the <dialog> element itself, outside the panel. */
function onClick(event: MouseEvent) {
  if (event.target === dialog.value) settle(false)
}
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm"
    :class="{ danger: confirmRequest?.danger }"
    aria-labelledby="confirm-title"
    aria-describedby="confirm-message"
    @cancel.prevent="settle(false)"
    @close="settle(false)"
    @click="onClick"
  >
    <div v-if="confirmRequest" class="panel">
      <p class="kicker" aria-hidden="true">
        <TriangleAlert v-if="confirmRequest.danger" :size="14" />{{
          confirmRequest.danger ? 'Cannot be undone' : 'Please confirm'
        }}
      </p>
      <h2 id="confirm-title">{{ confirmRequest.title }}</h2>
      <p id="confirm-message">{{ confirmRequest.message }}</p>
      <div class="actions">
        <button ref="cancelButton" class="btn" type="button" @click="settle(false)">
          {{ confirmRequest.cancelLabel ?? 'Cancel' }}
        </button>
        <button
          ref="confirmButton"
          class="btn"
          :class="confirmRequest.danger ? 'btn-danger-solid' : 'btn-primary'"
          type="button"
          @click="settle(true)"
        >
          {{ confirmRequest.confirmLabel }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.confirm {
  --tone: var(--text);
  width: min(29rem, calc(100% - 2rem));
  padding: 0;
  border: 1px solid var(--border-strong);
  border-top: 4px solid var(--tone);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-lg);
}

.confirm.danger {
  --tone: var(--danger);
}

.confirm[open] {
  animation: rise var(--dur-2) var(--ease-out);
}

.confirm[open]::backdrop {
  animation: dim var(--dur-2) var(--ease);
}

.confirm::backdrop {
  background: var(--overlay);
}

.panel {
  padding: 1.35rem 1.5rem 1.5rem;
}

.kicker {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.6rem;
  color: var(--tone);
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h2 {
  font-size: 1.5rem;
  font-weight: 700;
  font-stretch: var(--condensed);
  line-height: 1.12;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}

#confirm-message {
  color: var(--text-2);
  white-space: pre-line;
}

.actions {
  display: flex;
  flex-wrap: wrap-reverse;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.5rem;
}

@media (max-width: 480px) {
  .actions .btn {
    flex: 1 1 100%;
  }
}

@keyframes rise {
  from {
    transform: translateY(12px) scale(0.98);
  }
}

@keyframes dim {
  from {
    opacity: 0;
  }
}
</style>
