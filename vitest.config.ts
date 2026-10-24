import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Fast unit/storage tests. fake-indexeddb stands in for IndexedDB; it does not reproduce
// browser lifecycle or quota behaviour, which the Playwright suite covers.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
      exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tests/emulator/**'],
      setupFiles: ['tests/setup.ts'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,vue}'],
        exclude: ['src/sw.ts', 'src/main.ts'],
        reporter: ['text', 'html', 'json-summary'],
      },
    },
  }),
)
