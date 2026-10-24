import { expect, test } from '@playwright/test'
import {
  blockFirestore,
  createAccount,
  createJobInUi,
  editNotesInUi,
  serverJob,
  serverReceipts,
  signIn,
  unblockFirestore,
  waitForOfflineReady,
} from './fixtures'

test('T20: two tabs on one account coordinate sync; every change applies exactly once', async ({
  browser,
}) => {
  const account = await createAccount()
  const context = await browser.newContext()
  const tab1 = await context.newPage()
  await signIn(tab1, account)
  await waitForOfflineReady(tab1)
  const tab2 = await context.newPage()
  await tab2.goto('/jobs') // same profile: restored session and the same local database

  await blockFirestore(context) // queue work in both tabs before either can deliver it
  const first = await createJobInUi(tab1, 'Tab one job')
  await editNotesInUi(tab1, 'edited in tab one')
  const second = await createJobInUi(tab2, 'Tab two job')
  await unblockFirestore(context)

  for (const tab of [tab1, tab2]) await tab.getByRole('link', { name: /Sync center/ }).click()
  await Promise.all([
    tab1.getByRole('button', { name: 'Sync now' }).click(),
    tab2.getByRole('button', { name: 'Sync now' }).click(),
  ])
  for (const tab of [tab1, tab2]) {
    await expect(tab.getByTestId('pending-count')).toHaveText('No changes waiting to sync.')
  }
  expect(await serverJob(account.uid, first)).toMatchObject({
    revision: 2,
    fields: { notes: 'edited in tab one' },
  })
  expect(await serverJob(account.uid, second)).toMatchObject({ revision: 1 })
  expect(await serverReceipts(account.uid)).toHaveLength(3)
  await context.close()
})

test('T21: closing the tab that holds the sync lock mid-request lets another tab finish safely', async ({
  browser,
}) => {
  const account = await createAccount()
  const context = await browser.newContext()
  const tab1 = await context.newPage()
  await signIn(tab1, account)
  await waitForOfflineReady(tab1)

  let committed!: () => void
  const commitReachedServer = new Promise<void>((resolve) => (committed = resolve))
  await tab1.route(
    (url) => url.port === '8086' && /commit/i.test(url.pathname),
    async (route) => {
      await route.fetch() // the commit reaches the emulator and applies…
      committed() // …but tab 1 never receives the reply
    },
  )
  const id = await createJobInUi(tab1, 'Lock holder job')
  await commitReachedServer
  expect(await serverJob(account.uid, id)).toMatchObject({ revision: 1 })

  const tab2 = await context.newPage()
  await tab2.goto('/sync')
  await expect(tab2.getByTestId('outbox')).toContainText('Sending…') // tab 1 still holds the lock
  await tab1.close() // the browser releases tab 1's lock

  await expect(tab2.getByTestId('pending-count')).toHaveText('No changes waiting to sync.')
  expect(await serverJob(account.uid, id)).toMatchObject({ revision: 1 })
  expect(await serverReceipts(account.uid)).toHaveLength(1)
  await context.close()
})
