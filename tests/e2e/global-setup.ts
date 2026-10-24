// The emulator hub answers before Auth and Firestore finish starting, so wait for both.
import { AUTH_EMULATOR, FIRESTORE_EMULATOR } from './fixtures'

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

export default async function globalSetup(): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if ((await up(`${AUTH_EMULATOR}/`)) && (await up(`${FIRESTORE_EMULATOR}/`))) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Auth/Firestore emulators did not become ready within 120 s.')
}
