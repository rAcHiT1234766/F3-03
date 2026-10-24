import { expect, test } from '@playwright/test'
import {
  APP,
  blockFirestore,
  createAccount,
  createJobInUi,
  editNotesInUi,
  jobSyncBadge,
  serverJob,
  serverReceipts,
  signIn,
  syncNowAndDrain,
  unblockFirestore,
  waitForOfflineReady,
} from './fixtures'

const serve = (dir: string) => fetch(`${APP}/__test/serve?dir=${dir}`)

test.afterEach(async () => {
  await serve('dist-e2e')
})

test('T38: a new build waits for unsaved input, then updates without losing queued changes', async ({
  browser,
}) => {
  await serve('dist-e2e') // build A
  const account = await createAccount()
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, account)
  await waitForOfflineReady(page)
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('app-version')).toContainText('e2e-a')
  await page.getByRole('link', { name: 'Jobs' }).click()

  const id = await createJobInUi(page, 'Gate valve service')
  await expect(jobSyncBadge(page)).toHaveAttribute('data-sync-state', 'synced')
  await blockFirestore(context) // keep the next change queued while the app files stay reachable
  await editNotesInUi(page, 'Queued before the update')
  const oldEntry = await page.evaluate(
    () => document.querySelector<HTMLScriptElement>('script[type="module"]')!.src,
  )

  await serve('dist-e2e-next') // publish build B on the same origin
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update())
  await expect(page.getByText('A new version of FieldLog is ready.')).toBeVisible()

  // An unsaved form blocks the update; the typed text stays.
  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Notes').fill('Typed but not saved')
  await page.getByRole('button', { name: 'Update now' }).click()
  await expect(
    page.getByText('Save or discard your unsaved changes before updating.'),
  ).toBeVisible()
  await expect(page.getByLabel('Notes')).toHaveValue('Typed but not saved')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('job-notes')).toHaveText('Typed but not saved')

  // Now the update applies: the new worker takes control and the page reloads once.
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Update now' }).click(),
  ])
  await expect(page.getByTestId('job-notes')).toHaveText('Typed but not saved')
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('app-version')).toContainText('e2e-b')
  await page.getByRole('link', { name: /Sync center/ }).click()
  await expect(page.getByTestId('pending-count')).toHaveText('2 changes waiting to sync.')

  // Old precache entries are gone; only one app-owned precache remains.
  const cache = await page.evaluate(async () => {
    const names = await caches.keys()
    const urls: string[] = []
    for (const name of names)
      urls.push(...(await (await caches.open(name)).keys()).map((r) => r.url))
    return { names, urls }
  })
  expect(cache.names.filter((n) => n.includes('precache'))).toHaveLength(1)
  expect(cache.urls).not.toContain(oldEntry)

  await unblockFirestore(context)
  await syncNowAndDrain(page)
  expect(await serverJob(account.uid, id)).toMatchObject({
    revision: 3,
    fields: { notes: 'Typed but not saved' },
  })
  expect(await serverReceipts(account.uid)).toHaveLength(3)
  await context.close()
})
