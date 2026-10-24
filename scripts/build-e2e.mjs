// Builds the two emulator-mode bundles the browser tests use: build A (served first) and
// build B (a newer release on the same origin, for the service-worker update test).
import { build } from 'vite'

const builds = [
  ['dist-e2e', 'e2e-a'],
  ['dist-e2e-next', 'e2e-b'],
]
for (const [outDir, id] of builds) {
  process.env.FIELDLOG_BUILD_ID = id
  await build({ mode: 'emulator', logLevel: 'warn', build: { outDir, emptyOutDir: true } })
  console.log(`built ${outDir} (${id})`)
}
