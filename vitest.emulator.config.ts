import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Runs only under `firebase emulators:exec` (see package.json). Tests refuse to start unless
// the emulator environment variables point at localhost and the project is a demo- project.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/emulator/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    root: fileURLToPath(new URL('./', import.meta.url)),
  },
})
