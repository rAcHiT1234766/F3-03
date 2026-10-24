// One confirmation dialog for the app (rendered by ConfirmDialog.vue in App.vue).
// Without a mounted host (component tests), it falls back to the browser's confirm().
import { shallowRef } from 'vue'

export type ConfirmOptions = {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
}

export type ConfirmRequest = ConfirmOptions & { resolve: (confirmed: boolean) => void }

export const confirmRequest = shallowRef<ConfirmRequest | null>(null)
let hosts = 0

export function registerDialogHost(): () => void {
  hosts++
  return () => {
    hosts--
  }
}

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (hosts === 0) return Promise.resolve(window.confirm(`${options.title}\n\n${options.message}`))
  confirmRequest.value?.resolve(false)
  return new Promise((resolve) => {
    confirmRequest.value = { ...options, resolve }
  })
}
