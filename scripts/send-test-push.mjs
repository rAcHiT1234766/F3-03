// Trusted, operator-run test push sender (spec §17.4). Runs in Node only, never in the app bundle.
//
// Usage:
//   node scripts/send-test-push.mjs --project <firebase-project-id> --uid <owner-uid> \
//     --device <device-id> [--job <job-uuid>] [--dry-run]
//
// Credentials come from Application Default Credentials: either
//   GOOGLE_APPLICATION_CREDENTIALS=<path to a service-account key kept OUTSIDE this repository>
// or `gcloud auth application-default login`. Nothing secret is read from the repository, and
// the device's FCM registration ID and the credentials are never printed.
import { parseArgs } from 'node:util'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function fail(message) {
  console.error(`send-test-push: ${message}`)
  console.error(
    'Usage: node scripts/send-test-push.mjs --project <id> --uid <uid> --device <deviceId> [--job <jobId>] [--dry-run]',
  )
  process.exit(2)
}

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    uid: { type: 'string' },
    device: { type: 'string' },
    job: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
})

if (!values.project || !values.uid || !values.device)
  fail('--project, --uid and --device are required.')
if (values.project.startsWith('demo-')) {
  fail('demo- projects exist only in the emulators, and the emulators do not deliver FCM messages.')
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  fail('FIRESTORE_EMULATOR_HOST is set. Real push delivery needs the real project; unset it.')
}
if (values.job && !UUID.test(values.job)) fail('--job must be a job UUID.')
if (!/^[A-Za-z0-9_-]{1,64}$/.test(values.device)) fail('--device must be a device ID.')

const { applicationDefault, initializeApp } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')
const { getMessaging } = await import('firebase-admin/messaging')

const app = initializeApp({ credential: applicationDefault(), projectId: values.project })
const device = await getFirestore(app).doc(`users/${values.uid}/devices/${values.device}`).get()
if (!device.exists || device.get('enabled') !== true || typeof device.get('fid') !== 'string') {
  fail('That device has not opted in to notifications (no enabled device registration found).')
}

const jobId = values.job ?? null
// Data-only message: the service worker shows exactly one generic notification, and an open
// app shows an in-app banner instead. No HTML and no external URLs.
const message = {
  fid: device.get('fid'),
  data: {
    type: 'job_update',
    ...(jobId ? { jobId, tag: `job-${jobId.slice(0, 8)}` } : { tag: 'fieldlog-update' }),
  },
  webpush: { headers: { Urgency: 'high', TTL: '3600' } },
}

if (values['dry-run']) {
  console.log('Dry run. Would send:', JSON.stringify({ ...message, fid: '<redacted>' }, null, 2))
  process.exit(0)
}

const messageId = await getMessaging(app).send(message)
console.log(`Sent at ${new Date().toISOString()}. FCM message ID: ${messageId}`)
console.log('Record the observed foreground/background result in docs/evidence.md (no IDs needed).')
