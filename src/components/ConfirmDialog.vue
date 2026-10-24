<script setup lang="ts">
import { Info, TriangleAlert } from '@lucide/vue'
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
    aria-labelledby="confirm-title"
    aria-describedby="confirm-message"
    @cancel.prevent="settle(false)"
    @close="settle(false)"
    @click="onClick"
  >
    <div v-if="confirmRequest" class="panel">
      <div class="icon" :class="{ danger: confirmRequest.danger }">
        <TriangleAlert v-if="confirmRequest.danger" :size="22" />
        <Info v-else :size="22" />
      </div>
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
  width: min(28rem, calc(100% - 2rem));
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-lg);
}

.confirm[open] {
  animation: pop 0.16s var(--ease);
}

.confirm::backdrop {
  background: var(--overlay);
  backdrop-filter: blur(2px);
}

.panel {
  padding: 1.5rem;
}

.icon {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  margin-bottom: 1rem;
  border-radius: 999px;
  background: var(--info-soft);
  color: var(--info);
}

.icon.danger {
  background: var(--danger-soft);
  color: var(--danger);
}

h2 {
  font-size: 1.1875rem;
}

p {
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

@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
}
</style>
