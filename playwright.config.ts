import { defineConfig, devices } from '@playwright/test'

// Browser scenarios run against the production build (emulator mode) with service workers
// enabled, served by a plain static server, and the Auth/Firestore emulators.
// Build first with `npm run build:e2e` (or use `npm run test:e2e`, which does both).
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // tests share one emulator and one origin
  forbidOnly: !!process.env.CI,
  retries: 0, // flaky failures are diagnosed, not retried away
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'node scripts/firebase-emulators.mjs emulators:start --only auth,firestore --project demo-fieldlog',
      url: 'http://127.0.0.1:4400/emulators',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'ignore',
    },
    {
      command: 'node tests/e2e/static-server.mjs dist-e2e',
      url: 'http://127.0.0.1:4173/',
      reuseExistingServer: false,
    },
  ],
})
