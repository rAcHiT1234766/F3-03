import { expect, test } from '@playwright/test'
import {
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

test('T35/T03: prepared app works offline, an offline edit survives reopening, then reaches another device', async ({
  browser,
}) => {
  const account = await createAccount()
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, account)
  await waitForOfflineReady(page)
  const id = await createJobInUi(page, 'Boiler inspection')
  await expect(jobSyncBadge(page)).toHaveAttribute('data-sync-state', 'synced')

  await context.setOffline(true)
  await page.reload() // deep route, served by the worker's app shell
  await expect(page.getByRole('heading', { name: 'Boiler inspection' })).toBeVisible()
  await expect(page.getByTestId('status-line')).toContainText('Offline — you can keep working')
  await editNotesInUi(page, 'Pressure relief valve replaced (offline)')
  await expect(jobSyncBadge(page)).not.toHaveAttribute('data-sync-state', 'synced')

  await page.close() // close and reopen in the same browser profile, still offline
  const reopened = await context.newPage()
  await reopened.goto(`/jobs/${id}`)
  await expect(reopened.getByTestId('job-notes')).toHaveText(
    'Pressure relief valve replaced (offline)',
  )

  await context.setOffline(false)
  await syncNowAndDrain(reopened)
  const job = await serverJob(account.uid, id)
  expect(job).toMatchObject({
    revision: 2,
    fields: { notes: 'Pressure relief valve replaced (offline)' },
  })
  const receipts = await serverReceipts(account.uid)
  expect(receipts.map((r) => r.outcome)).toEqual(['applied', 'applied'])
  expect(receipts.map((r) => r.opId)).toContain(job!.lastOpId)

  const otherDevice = await browser.newContext() // independent profile = second device
  const second = await otherDevice.newPage()
  await signIn(second, account)
  await second.getByRole('link', { name: 'Boiler inspection' }).click()
  await expect(second.getByTestId('job-notes')).toHaveText(
    'Pressure relief valve replaced (offline)',
  )
  await otherDevice.close()
  await context.close()
})

test('T37: screens never visited still open offline once the app is prepared', async ({
  browser,
}) => {
  const account = await createAccount()
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, account)
  await waitForOfflineReady(page)
  await context.setOffline(true)
  for (const [path, heading] of [
    ['/sync', 'Sync center'],
    ['/settings', 'Settings'],
    ['/jobs/new', 'New job'],
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
  }
  await context.close()
})

test('T36: a first-ever visit without network cannot load (documented limitation)', async ({
  browser,
}) => {
  const context = await browser.newContext()
  await context.setOffline(true)
  const page = await context.newPage()
  await expect(page.goto('/jobs')).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/)
  await context.close()
})

test('T06: an offline delete stays hidden after reload and syncs as a tombstone', async ({
  browser,
}) => {
  const account = await createAccount()
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, account)
  await waitForOfflineReady(page)
  const id = await createJobInUi(page, 'Leak check')
  await expect(jobSyncBadge(page)).toHaveAttribute('data-sync-state', 'synced')
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete job' }).click()
  await expect(page).toHaveURL(/\/jobs$/)
  await page.reload()
  await expect(page.getByText('No jobs on this device yet.')).toBeVisible()
  await context.setOffline(false)
  await syncNowAndDrain(page)
  expect(await serverJob(account.uid, id)).toMatchObject({ deleted: true, revision: 2 })
  await context.close()
})

test('T41: server unreachable while the browser says online — honest status, local work continues', async ({
  browser,
}) => {
  const account = await createAccount()
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, account)
  await waitForOfflineReady(page)
  await blockFirestore(context)
  const id = await createJobInUi(page, 'Captive portal job')
  await page.getByRole('link', { name: /Sync center/ }).click()
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByTestId('sync-phase')).toContainText('Cannot reach the server — retrying')
  await expect(page.getByTestId('pending-count')).toHaveText('1 change waiting to sync.')
  // The reconciliation read fails first, so the cycle pauses before sending anything.
  await expect(page.getByTestId('outbox')).toContainText('Waiting to sync')
  await unblockFirestore(context)
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByTestId('pending-count')).toHaveText('No changes waiting to sync.')
  expect(await serverJob(account.uid, id)).toMatchObject({ revision: 1 })
  await context.close()
})
