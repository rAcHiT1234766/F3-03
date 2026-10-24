import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createAccount, createJobInUi, signIn } from './fixtures'

test('PWA checklist: the manifest parses cleanly and Chrome reports no installability errors', async ({
  page,
}) => {
  await page.goto('/sign-in')
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 })
  const cdp = await page.context().newCDPSession(page)

  const manifest = await cdp.send('Page.getAppManifest')
  expect(manifest.errors).toEqual([])
  const data = JSON.parse(manifest.data ?? '{}')
  expect(data).toMatchObject({ id: '/', start_url: '/jobs', scope: '/', display: 'standalone' })
  for (const icon of data.icons as { src: string; sizes: string }[]) {
    const res = await page.request.get(icon.src)
    expect(res.ok(), icon.src).toBe(true)
  }
  expect(data.icons.map((i: { purpose: string }) => i.purpose)).toContain('maskable')

  // Playwright contexts are incognito-like; that one reason is about the test browser, not the app.
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  const errors = installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito')
  expect(errors).toEqual([])
})

test('T45 (page side only): a worker "open job" message navigates only to a validated job route', async ({
  browser,
}) => {
  // Real notification clicks need FCM delivery (blocked). This covers the page half: the
  // worker's message after a click, and rejection of anything that is not a job UUID.
  const account = await createAccount()
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, account)
  const id = await createJobInUi(page, 'Notified job')
  await page.getByRole('link', { name: 'Jobs', exact: true }).click()
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const post = (data: unknown) =>
    worker.evaluate(async (message) => {
      const scope = self as unknown as {
        clients: { matchAll(o: object): Promise<{ postMessage(m: unknown): void }[]> }
      }
      for (const client of await scope.clients.matchAll({ type: 'window' }))
        client.postMessage(message)
    }, data)

  await post({ type: 'OPEN_JOB', jobId: 'https://example.com/phish' })
  await post({ type: 'OPEN_JOB', jobId: '../settings' })
  await expect(page).toHaveURL(/\/jobs$/) // ignored
  await post({ type: 'OPEN_JOB', jobId: id })
  await expect(page).toHaveURL(new RegExp(`/jobs/${id}$`))
  await expect(page.getByRole('heading', { name: 'Notified job' })).toBeVisible()
  const unknown = crypto.randomUUID()
  await post({ type: 'OPEN_JOB', jobId: unknown }) // a job not on this device yet
  await expect(page.getByRole('heading', { name: 'Job not on this device' })).toBeVisible()
  await context.close()
})

async function seriousViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${label}: ${v.id} (${v.nodes.length})`)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`Accessibility (${colorScheme}): no serious or critical axe violations on the main screens`, async ({
    browser,
  }) => {
    const account = await createAccount()
    const context = await browser.newContext({ colorScheme })
    const page = await context.newPage()
    const found: string[] = []

    await page.goto('/sign-in')
    await expect(page.getByRole('heading', { name: 'Sign in to FieldLog' })).toBeVisible()
    found.push(...(await seriousViolations(page, 'sign-in')))

    await signIn(page, account)
    const id = await createJobInUi(page, 'Accessible job')
    for (const [path, heading] of [
      ['/jobs', 'Jobs'],
      [`/jobs/${id}`, 'Accessible job'],
      [`/jobs/${id}/edit`, 'Edit job'],
      ['/jobs/new', 'New job'],
      ['/sync', 'Sync center'],
      ['/settings', 'Settings'],
    ]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
      found.push(...(await seriousViolations(page, path)))
    }
    expect(found).toEqual([])
    await context.close()
  })
}
