import { expect, test } from '@playwright/test'
import {
  blockFirestore,
  createAccount,
  createJobInUi,
  serverJob,
  signIn,
  syncNowAndDrain,
  unblockFirestore,
  waitForOfflineReady,
} from './fixtures'

test('T47/T33: sign-out with pending work asks first; the work stays with that account only', async ({
  browser,
}) => {
  const first = await createAccount()
  const second = await createAccount()
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, first)
  await waitForOfflineReady(page)
  await blockFirestore(context)
  const id = await createJobInUi(page, 'Unsynced at sign-out')

  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('1 change not synced yet.')
  await page.getByRole('button', { name: 'Sign out and keep changes on this device' }).click()
  await expect(page).toHaveURL(/\/sign-in/)

  // A different account on the same browser sees none of the first account's local data.
  await signIn(page, second)
  await expect(page.getByText('No jobs on this device yet.')).toBeVisible()
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click() // nothing pending: no prompt
  await expect(page).toHaveURL(/\/sign-in/)

  // The first account gets its retained work back, and it syncs.
  await unblockFirestore(context)
  await signIn(page, first)
  await expect(page.getByRole('link', { name: 'Unsynced at sign-out' })).toBeVisible()
  await syncNowAndDrain(page)
  expect(await serverJob(first.uid, id)).toMatchObject({ revision: 1 })
  await context.close()
})

test('T46 (unsupported): without a push-capable configuration the app stays usable and says why', async ({
  browser,
}) => {
  const account = await createAccount()
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, account)
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('push-state')).toContainText('Not available here')
  await expect(page.getByRole('button', { name: 'Enable notifications' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Jobs' }).click()
  await createJobInUi(page, 'Still works without push')
  await context.close()
})
