// Appearance preference for this browser: follow the OS, or force light or dark.
// Stored in localStorage as a per-device convenience; index.html applies it before first paint.
import { ref } from 'vue'

export type ThemePreference = 'system' | 'light' | 'dark'

const KEY = 'fieldlog:theme'

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export const themePreference = ref<ThemePreference>(read())

/** Keeps the browser's toolbar colour in step with the app header. */
function syncThemeColor() {
  const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = surface || meta.content
  }
}

export function setTheme(preference: ThemePreference): void {
  themePreference.value = preference
  try {
    if (preference === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, preference)
  } catch {
    // Storage blocked: the choice still applies to this page.
  }
  const root = document.documentElement
  if (preference === 'system') delete root.dataset.theme
  else root.dataset.theme = preference
  syncThemeColor()
}

export function startTheme(): void {
  syncThemeColor()
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor)
}
