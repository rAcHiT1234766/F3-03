import { expect, type BrowserContext, type Page } from '@playwright/test'

export const AUTH_EMULATOR = 'http://127.0.0.1:9099'
export const FIRESTORE_EMULATOR = 'http://127.0.0.1:8086'
export const APP = 'http://127.0.0.1:4173'
const DOCS = `${FIRESTORE_EMULATOR}/v1/projects/demo-fieldlog/databases/(default)/documents`

export type Account = { uid: string; email: string; password: string }

export async function createAccount(): Promise<Account> {
  const email = `tech-${crypto.randomUUID().slice(0, 8)}@example.test`
  const password = 'demo-password'
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  )
  const body = (await res.json()) as { localId: string }
  return { uid: body.localId, email, password }
}

export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/jobs$/)
}

/** The page is controlled by the app's worker and the precache is complete. */
export async function waitForOfflineReady(page: Page): Promise<void> {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 })
  await expect(page.getByTestId('offline-ready')).toBeVisible()
}

export async function createJobInUi(
  page: Page,
  title: string,
  customer = 'Harbour Cafe',
): Promise<string> {
  await page.getByRole('link', { name: 'New job' }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Customer').fill(customer)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/)
  return page.url().split('/').pop()!
}

export async function editNotesInUi(page: Page, notes: string): Promise<void> {
  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Notes').fill(notes)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('job-notes')).toHaveText(notes)
}

export const jobSyncBadge = (page: Page) => page.locator('main [data-sync-state]').first()

export async function syncNowAndDrain(page: Page): Promise<void> {
  await page.getByRole('link', { name: /Sync center/ }).click()
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByTestId('pending-count')).toHaveText('No changes waiting to sync.')
}

/** Makes Firestore unreachable for this browser context while the app's origin stays up. */
export async function blockFirestore(context: BrowserContext): Promise<void> {
  await context.route(`${FIRESTORE_EMULATOR}/**`, (route) => route.abort('connectionrefused'))
}

export async function unblockFirestore(context: BrowserContext): Promise<void> {
  await context.unroute(`${FIRESTORE_EMULATOR}/**`)
}

type RestValue = Record<string, unknown>
function decode(v: RestValue): unknown {
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('booleanValue' in v) return v.booleanValue
  if ('nullValue' in v) return null
  if ('timestampValue' in v) return v.timestampValue
  if ('doubleValue' in v) return v.doubleValue
  if ('arrayValue' in v)
    return ((v.arrayValue as { values?: RestValue[] }).values ?? []).map(decode)
  if ('mapValue' in v) {
    const fields = (v.mapValue as { fields?: Record<string, RestValue> }).fields ?? {}
    return Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, decode(x)]))
  }
  return v
}

// Reads canonical emulator data directly ("Bearer owner" bypasses rules). Verification only.
async function rest(path: string) {
  const res = await fetch(`${DOCS}/${path}`, { headers: { Authorization: 'Bearer owner' } })
  return res.status === 404 ? null : ((await res.json()) as Record<string, unknown>)
}

export async function serverJob(
  uid: string,
  jobId: string,
): Promise<Record<string, unknown> | null> {
  const doc = await rest(`users/${uid}/jobs/${jobId}`)
  return doc ? (decode({ mapValue: { fields: doc.fields } }) as Record<string, unknown>) : null
}

export async function serverReceipts(uid: string): Promise<Record<string, unknown>[]> {
  const list = await rest(`users/${uid}/operations?pageSize=300`)
  const docs = (list?.documents as { fields: Record<string, RestValue> }[] | undefined) ?? []
  return docs.map((d) => decode({ mapValue: { fields: d.fields } }) as Record<string, unknown>)
}
