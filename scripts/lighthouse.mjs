// Runs Lighthouse (current categories only — the old PWA category no longer exists) against the
// production build served locally, using Playwright's Chromium. Run under the emulators:
//   node scripts/firebase-emulators.mjs emulators:exec --only auth,firestore --project demo-fieldlog "node scripts/lighthouse.mjs"
// Reports go to docs/evidence/lighthouse/.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const LIGHTHOUSE = 'lighthouse@13.5.0'
const url = 'http://127.0.0.1:4173/sign-in' // the public screen; other screens need a signed-in user
const outDir = path.resolve('docs/evidence/lighthouse')
mkdirSync(outDir, { recursive: true })

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts })
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)),
    )
  })

const server = spawn(process.execPath, ['tests/e2e/static-server.mjs', 'dist-e2e'], {
  stdio: 'ignore',
})
try {
  await new Promise((r) => setTimeout(r, 1000))
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  for (const preset of ['mobile', 'desktop']) {
    const args = [
      '--yes',
      LIGHTHOUSE,
      url,
      '--quiet',
      '--output=json',
      '--output=html',
      `--output-path=${path.join(outDir, `sign-in-${preset}`)}`,
      '--chrome-flags=--headless=new',
      ...(preset === 'desktop' ? ['--preset=desktop'] : []),
    ]
    await run(npx, args, {
      env: { ...process.env, CHROME_PATH: chromium.executablePath() },
      shell: process.platform === 'win32',
    })
  }
} finally {
  server.kill()
}
