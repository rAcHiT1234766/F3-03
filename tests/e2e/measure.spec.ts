/* eslint-disable playwright/no-skipped-test, playwright/expect-expect, playwright/no-conditional-in-test --
   an opt-in timing script that records numbers, not a pass/fail test */
// Timing measurements (spec §22.3). Opt-in: MEASURE=1 npx playwright test tests/e2e/measure.spec.ts
// Durations are taken inside the page (performance.now + MutationObserver), so Playwright's own
// polling does not inflate them. Everything runs against the local emulators: these are
// emulator timings, not real Firebase network performance.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  blockFirestore,
  createAccount,
  createJobInUi,
  seedJobs,
  signIn,
  unblockFirestore,
  waitForOfflineReady,
} from './fixtures'

test.skip(!process.env.MEASURE, 'Set MEASURE=1 to collect timings.')
test.describe.configure({ mode: 'serial' })

const results: Record<string, unknown> = {}

function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length / 2
  const median = s.length % 2 ? s[Math.floor(mid)]! : (s[mid - 1]! + s[mid]!) / 2
  const r = (n: number) => Math.round(n * 10) / 10
  return {
    runs: s.length,
    medianMs: r(median),
    minMs: r(s[0]!),
    maxMs: r(s.at(-1)!),
    samplesMs: s.map(r),
  }
}

/** Resolves with ms from `start()` until `done()` is true, measured in the page. */
function timeInPage(page: Page, startScript: string, doneScript: string): Promise<number> {
  return page.evaluate(
    ([start, done]) =>
      new Promise<number>((resolve) => {
        const isDone = new Function(`return (${done})`) as () => boolean
        const t0 = performance.now()
        const observer = new MutationObserver(() => {
          if (isDone()) {
            observer.disconnect()
            resolve(performance.now() - t0)
          }
        })
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        new Function(start)()
      }),
    [startScript, doneScript] as const,
  )
}

test.afterAll(() => {
  if (Object.keys(results).length === 0) return // never overwrite evidence from a skipped run
  mkdirSync('docs/evidence', { recursive: true })
  const out = {
    measuredAt: new Date().toISOString(),
    environment: {
      build: 'dist-e2e (production build, emulator mode)',
      browser: 'Playwright Chromium (headless)',
      backend: 'Firebase Auth + Firestore emulators on the same machine',
    },
    results,
  }
  writeFileSync('docs/evidence/measurements.json', `${JSON.stringify(out, null, 2)}\n`)
})

test('local save: Save → IndexedDB commit → job details shown', async ({ browser }) => {
  const account = await createAccount()
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, account)
  await waitForOfflineReady(page)
  await blockFirestore(context) // local save must not depend on the network
  const samples: number[] = []
  for (let i = 1; i <= 10; i++) {
    await page.getByRole('link', { name: 'Jobs', exact: true }).click()
    await page.getByRole('link', { name: 'New job' }).click()
    await page.getByLabel('Title').fill(`Timed job ${i}`)
    await page.getByLabel('Customer').fill('Timing Co')
    samples.push(
      await timeInPage(
        page,
        "document.querySelector('form').requestSubmit()",
        `/^\\/jobs\\/[0-9a-f-]{36}$/.test(location.pathname) && document.querySelector('h1')?.textContent?.trim() === 'Timed job ${i}'`,
      ),
    )
  }
  results.localSave = {
    description: 'Save click to rendered job details (create, 10 runs)',
    ...stats(samples),
  }
  await context.close()
})

test('warm offline load: navigation → job list rendered', async ({ browser }) => {
  const account = await createAccount()
  await seedJobs(account.uid, 25)
  const context = await browser.newContext()
  await context.addInitScript(() => {
    const w = window as unknown as { __listAt?: number }
    const check = () => {
      if (!w.__listAt && document.querySelector('[data-testid="job-list"] li'))
        w.__listAt = performance.now()
    }
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true })
      check()
    })
  })
  const page = await context.newPage()
  await signIn(page, account)
  await waitForOfflineReady(page)
  await expect(page.getByText('Showing 25 of 25 jobs')).toBeVisible()
  await context.setOffline(true)
  const samples: number[] = []
  for (let i = 0; i < 5; i++) {
    await page.goto('/jobs')
    await expect(page.getByTestId('job-list')).toBeVisible()
    samples.push(await page.evaluate(() => (window as unknown as { __listAt: number }).__listAt))
  }
  results.warmOfflineLoad = {
    description:
      'Offline navigation start to first job list item (25 jobs, prepared profile, 5 runs)',
    ...stats(samples),
  }
  await context.close()
})

test('queue drain: 20 queued operations after connectivity returns', async ({ browser }) => {
  const account = await createAccount()
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, account)
  await waitForOfflineReady(page)
  const samples: number[] = []
  for (let run = 1; run <= 3; run++) {
    await blockFirestore(context)
    for (const j of [1, 2]) {
      await page.getByRole('link', { name: 'Jobs', exact: true }).click()
      await createJobInUi(page, `Drain ${run}.${j}`)
      for (let k = 0; k < 9; k++) {
        const label = k % 2 ? 'Completed' : 'In progress'
        await page.getByRole('button', { name: label }).click()
        await expect(page.getByRole('button', { name: label })).toHaveAttribute(
          'aria-pressed',
          'true',
        )
      }
    }
    await page.getByRole('link', { name: /Sync center/ }).click()
    await expect(page.getByTestId('pending-count')).toHaveText('20 changes waiting to sync.')
    // Let the cycle that is failing against the blocked server finish before timing.
    await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled({ timeout: 60_000 })
    await unblockFirestore(context)
    samples.push(
      await timeInPage(
        page,
        "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sync now').click()",
        "document.querySelector('[data-testid=pending-count]')?.textContent?.trim() === 'No changes waiting to sync.'",
      ),
    )
  }
  results.queueDrain = {
    description: '20 operations (2 jobs × create + 9 status edits), 3 runs',
    ...stats(samples),
  }
  await context.close()
})

for (const count of [50, 200]) {
  test(`full reconciliation: ${count} jobs`, async ({ browser }) => {
    const first: number[] = []
    const repeat: number[] = []
    for (let run = 0; run < 3; run++) {
      const account = await createAccount()
      await seedJobs(account.uid, count)
      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto('/sign-in')
      await page.getByLabel('Email').fill(account.email)
      await page.getByLabel('Password').fill(account.password)
      first.push(
        await timeInPage(
          page,
          "document.querySelector('form').requestSubmit()",
          `document.body.innerText.includes('Showing ${count} of ${count} jobs')`,
        ),
      )
      await page.getByRole('link', { name: /Sync center/ }).click()
      await expect(page.getByTestId('sync-phase')).toHaveText('Ready')
      repeat.push(
        await timeInPage(
          page,
          "window.__sawSyncing = false; [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sync now').click()",
          "(() => { const t = document.querySelector('[data-testid=sync-phase]')?.textContent?.trim(); if (t === 'Syncing…') window.__sawSyncing = true; return window.__sawSyncing && t === 'Ready' })()",
        ),
      )
      await context.close()
    }
    results[`reconcile${count}`] = {
      description: `${count} server jobs; each full reconciliation reads ${count} documents`,
      firstDownload: {
        note: 'sign-in submit to all jobs listed (auth + DB open + read + apply)',
        ...stats(first),
      },
      repeatSync: { note: 'Sync now with nothing changed (read + compare)', ...stats(repeat) },
    }
  })
}
