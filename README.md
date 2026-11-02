# FieldLog

FieldLog is an offline-first field-service job tracker, built as a Progressive Web App with
Vue 3, Vite, Dexie (IndexedDB), Workbox and Firebase. A technician can view downloaded jobs,
create, edit and delete jobs, and record progress without a connection. Changes are saved on the
device first and synchronize with the same account's Firebase data when connectivity and sign-in
allow.

> Assignment FE-03 (Frontend Development, project 2 of 2). The full specification is
> [`FE-03-Codex-Project-Workflow.md`](FE-03-Codex-Project-Workflow.md). Progress, decisions and
> evidence are in [`docs/`](docs/).
>
> Live app: https://fe-03-56215.web.app · Source: https://github.com/rAcHiT1234766/F3-03

## What it promises, and what it does not

- **Save means saved on this device.** Save succeeds only when the IndexedDB transaction commits,
  and that transaction writes the job together with its queued sync operation.
- **Offline** covers the app and the data already on this device, after one online visit. A
  first-ever visit, the first sign-in and downloading new remote records all need a network.
- **Sync runs while the app is open**, and again when it is reopened. FieldLog does not promise to
  sync after every tab is closed. A reconnect event is a chance to sync, not a guarantee of an
  immediate sync.
- **Delivery is at least once; effects happen once.** Retries reuse the same operation ID, and an
  atomic server receipt makes repeated delivery harmless while receipts are kept.
- **Conflicts:** edits to different fields of the same job both survive. For the same field, the
  last successful **server commit** wins (never a device clock), and the other value is shown in
  the Sync center. Notes are one field, not merged paragraph by paragraph.
- **Deletion is final.** A stale offline edit cannot bring a deleted job back; the edit is kept
  and can be recovered as a new job.
- **Browser storage is not a backup.** Quotas, eviction, private browsing and clearing site data
  can remove local data. FieldLog never deletes unsynced work on its own, and offers a JSON export.
- **Push notifications are hints** ("a job was updated"), not data, and delivery is not
  guaranteed.
- **Account separation on a shared device** keeps each account's data apart inside the app. It
  does not encrypt browser files against someone who controls the device. Use fictional data.

## Interface and accessibility

- Light and dark themes follow the device setting by default; **Settings → Appearance** can fix
  one. High-contrast, forced-colors (Windows contrast themes) and reduced-motion preferences are
  respected.
- Status, sync state and due dates are always shown as words and an icon, never by colour alone.
  Due dates read as "Due today", "Overdue by 2 days" and so on.
- On a phone, Jobs, Sync center and Settings are in a bottom tab bar. On touch screens, buttons,
  fields and choice pills are 44 px high (small buttons 40 px).
- Keyboard: a skip link, visible focus on every control, and confirmations in a native modal
  dialog that keeps focus and returns it afterwards. Automated axe checks cover 7 screens in both
  themes.

## Supported browsers

The baseline is current Chromium browsers (Chrome, Edge), automated-tested with Chromium 156.
Firefox and Safari have not been tested; installation and push behave differently there (see
[`docs/pwa-checklist.md`](docs/pwa-checklist.md)). Sync needs the Web Locks API. Without it the
app says so and keeps local work usable, but does not sync.

## Quick start (local emulators, no Firebase account needed)

Requirements: Node 22.18+ or 24.12+, npm, and Java 21+ for the Firestore emulator.

```bash
npm ci
npm run emulators        # Auth + Firestore emulators, project demo-fieldlog (UI on :4000)
npm run dev:emulator     # in a second terminal: Vite dev server using .env.emulator
```

Open http://localhost:5173 and use **Create emulator account**, then sign in. Emulator mode
connects only to `127.0.0.1` and refuses any project ID that does not start with `demo-`.

The service worker is not active in the Vite dev server. To test the real PWA (offline, install,
updates), use a production build:

```bash
npm run build:e2e                      # emulator-mode production builds in dist-e2e/
node tests/e2e/static-server.mjs       # serves dist-e2e on http://127.0.0.1:4173
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `npm run dev:emulator` | Vite dev server (real config from `.env.local` / emulators) |
| `npm run build` | Type-check, then build the app and service worker into `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run lint` | oxlint + ESLint |
| `npm run typecheck` | `vue-tsc --build` (app, worker, tests, configs) |
| `npm test` / `npm run test:watch` | Unit, storage and component tests (Vitest + fake-indexeddb) |
| `npm run test:coverage` | The same with V8 coverage (`coverage/`) |
| `npm run emulators` | Start the Auth and Firestore emulators |
| `npm run test:rules` | Firestore security-rule tests against the emulator |
| `npm run test:sync` | Real Firestore protocol tests (two independent clients) against the emulators |
| `npm run test:e2e` | Build both e2e bundles, then run the Playwright browser scenarios |
| `npm run check` | Lint, type-check, unit tests and production build |
| `npm run icons` | Regenerate the PNG icons |
| `npm run send-test-push -- …` | Trusted test push sender (see below) |

All commands work in Windows PowerShell and on Linux. On Windows, the emulator scripts go through
`scripts/firebase-emulators.mjs`, which stops the Firestore emulator JVM being left running after
tests (see `docs/decisions.md`).

## Using a real Firebase project

1. Create or choose a Firebase project. Enable **Authentication → Email/Password**, **Cloud
   Firestore**, and **Cloud Messaging**. Add a **Web app**.
2. Copy `.env.example` to `.env.local` (git-ignored) and fill in the web app's public config and the
   **Web Push certificate** (VAPID public key). These values are public identifiers; access is
   controlled by Firebase Auth and `firestore.rules`. Never put Admin credentials in any `VITE_`
   variable.
3. Create a demo user (Firebase console → Authentication → Add user). Keep its password out of the
   repository and the evidence files.
4. Deploy the rules and the app when you are authorized to:
   ```bash
   npx firebase login
   npx firebase use --add          # select the project; replaces demo-fieldlog locally
   npm run build
   npx firebase deploy --only firestore:rules,hosting
   ```
   `firebase.json` serves `dist/` with an SPA rewrite and `no-cache` for `sw.js`, the manifest and
   `index.html`; hashed assets are cached long-term. After deploying, check the sign-in authorized
   domains, the manifest and icons, the worker scope, offline deep links, real sync and push on the
   deployed URL.

## Real push test

FieldLog uses Firebase Cloud Messaging with the app's single service worker. Firebase 13 uses
Firebase Installation ID (FID) registration.

1. On the deployed app, open **Settings → Enable notifications** and allow the permission. The
   device registration is stored at `users/{uid}/devices/{deviceId}`, readable only by the owner.
2. From a trusted machine, with Application Default Credentials (a service-account key file kept
   **outside** this repository via `GOOGLE_APPLICATION_CREDENTIALS`, or
   `gcloud auth application-default login`):
   ```bash
   npm run send-test-push -- --project <project-id> --uid <uid> --device <deviceId> --job <jobId>
   ```
   The device ID's first 8 characters are shown in Settings; the full ID is in the device document.
   `--job` is required (the app ignores messages without a valid job ID): use a document ID from
   `users/{uid}/jobs`, whose first 6 characters are the job's Ref.
   The script prints the FCM message ID only, never the registration ID or credentials.
3. With the app open you should see an in-app banner. With it in the background, one system
   notification titled "FieldLog update available". Clicking it opens the job.

Push is operator-triggered in this baseline. There is no automatic backend trigger.

## How it works

```
Vue screens ──save──▶ Dexie: jobs + outbox (one transaction) ──▶ UI (live queries)
                                   │
                         sync engine (Web Lock per account)
                                   │  reconcile → push batch → reconcile
                                   ▼
          Firestore transaction: read receipt → read job → merge → write job + receipt
Workbox service worker: precached app shell for offline use + FCM background messages
```

See [`docs/architecture.md`](docs/architecture.md) and [`docs/sync-protocol.md`](docs/sync-protocol.md).

## Repository layout

| Path | Contents |
|---|---|
| `src/domain.ts` | Job, operation and receipt types; validation |
| `src/db.ts`, `src/jobs.ts` | Dexie schema per account; atomic local commands |
| `src/sync/` | `engine.ts` (scheduling), `remote.ts` (Firestore), `local.ts` (acknowledge/apply), `merge.ts` (pure resolvers), `errors.ts` |
| `src/auth.ts`, `src/firebase.ts` | Auth lifecycle and account-scoped session; Firebase initialization |
| `src/sw.ts`, `src/pwa.ts`, `src/notifications.ts` | Service worker, update/install handling, push |
| `src/views/`, `src/components/` | Screens and the shared sync badge |
| `firestore.rules`, `firebase.json` | Access policy; emulator and hosting configuration |
| `tests/unit`, `tests/emulator`, `tests/e2e` | Vitest, emulator and Playwright suites |
| `scripts/` | Icons, emulator wrapper, e2e builds, Lighthouse, bundle size, push sender |
| `docs/` | Progress, decisions, protocol, test matrix, evidence, PWA checklist, presentation |

## Troubleshooting

- **"Port … is not open … could not start Firestore Emulator"**: another process holds the port,
  often an emulator JVM from a run made without the wrapper. Stop it, or change the port in
  `firebase.json` and `.env.emulator`.
- **"FieldLog needs configuration"**: `.env.local` is missing values, or emulator mode was used with
  a project ID that does not start with `demo-`.
- **The app never says it is ready offline**: service workers only run in production builds,
  served over HTTPS or from localhost.
- **"Close other FieldLog tabs…"**: another tab holds an older version of the local database open.
  Close it or reload it. Local data is never deleted to fix this.
- **Sync says "Sign in again to sync"**: the session could not be refreshed. Local changes are kept.
  Sign in with the same account.
