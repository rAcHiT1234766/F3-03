# Progress

Entries follow the format in spec §31.1. Results are what was actually observed; anything not
executed is marked not run or blocked.

## 2026-10-24 — Phases 0–8 foundation (checkpoint 1)

**Date and commit:** 2026-10-24, first commit on `main` (local repository, no remote).

**Current phase:** Phases 0–8 implemented locally. Phase 9 (install and push) is code-complete
except for real FCM delivery, which needs a Firebase project.

**Behavior now implemented:**
- Vue 3 + Vite + TypeScript app (`src/`) with routes for sign in, jobs, job details, editor, Sync
  center and Settings.
- Dexie per account (`fieldlog:<project>:<uid>`): `jobs`, `outbox`, `conflicts`, `meta`. Each local
  create, edit or delete writes the visible job and its immutable outbox operation in one
  transaction (`src/jobs.ts`).
- Sync engine (`src/sync/engine.ts`): Web Lock coordinator, reconcile → bounded push → reconcile,
  persisted backoff, crash recovery of `sending` rows, coalesced triggers.
- Firestore adapter (`src/sync/remote.ts`): one transaction per operation, reading the receipt
  first, then writing the job and an immutable receipt atomically, then re-reading the committed
  receipt from the server.
- Acknowledgement (`src/sync/local.ts`) removes only the matching row, never lowers the shadow's
  revision, and rebuilds the view from the shadow plus outstanding operations.
- Staged record-LWW resolver and final field-level merge (`src/sync/merge.ts`), with terminal
  tombstones, conflict notices and recovery actions.
- Firestore rules: owner-only paths, strict shapes, revision +1, server timestamps, no physical
  deletes, immutable receipts, and `getAfter` links between each job mutation and its receipt.
- One Workbox + FCM service worker (`src/sw.ts`) with precache, offline navigation, prompt-based
  updates and notification click handling.
- Manifest and icons (regular and maskable, inspected visually), install prompt handling, FID-based
  notification opt-in, JSON export, storage estimate and persistence request.

**Invariants or bugs addressed:**
- The resolver could copy unknown patch keys into fields; it now uses only known business fields.
- Concurrent commits from two devices surfaced as `permission-denied`; fixed with a bounded,
  idempotent re-run (see `docs/decisions.md`).
- Emulator JVMs were orphaned on Windows; fixed with the `scripts/firebase-emulators.mjs` wrapper.

**Commands run and actual results:**
- `npm run check` (lint, typecheck, unit tests, build): passed. 80 unit/storage/component tests in
  5 files.
- `npm run test:rules`: 21 passed against the Firestore emulator.
- `npm run test:sync`: 17 passed against the Auth + Firestore emulators, including five rounds of
  concurrent two-device commits.
- `npx playwright test tests/e2e/offline.spec.ts tests/e2e/tabs.spec.ts` (after
  `npm run build:e2e`): 7 passed in Chromium 156.
- Mutation checks: four deliberate breaks of acknowledgement and ordering invariants were each
  caught by the unit suite (6, 1, 2 and 3 failing tests). Reverting the contention fix makes the
  emulator test fail.

**Browser/device checks performed:** automated Chromium only, using emulator mode and the
production build: offline deep-route reload, offline edit across close/reopen, second independent
browser context, offline-unvisited routes, multi-tab coordination, and lock-holder close during an
uncertain commit. No manual device, installation or push checks yet.

**Required external work:**
- Real Firebase project, deployment, FCM/VAPID: **blocked** (no project or credentials provided).
- Real push delivery (T43–T45): **blocked**.
- Installation on a target browser (T42): **not run** (needs an interactive browser).
- GitHub repository and Google Drive submission: **blocked** (no remote or access authorized).

**Known limitations:** foreground and reopen sync only (no closed-app sync), full reconciliation
sized for tens to a few hundred jobs, notes merge as one field, no attachments.

**Decisions and reasons:** see `docs/decisions.md`.

**Next three tasks:**
1. Browser tests for the service-worker update with a queued change (T38), sign-out with pending
   work (T47), installability and manifest checks, and automated accessibility checks.
2. Measurements (local save, warm offline load, queue drain, reconciliation of 50/200 jobs, bundle
   size) and a Lighthouse run.
3. README, architecture and protocol docs, T01–T48 matrix, PWA checklist, trusted push sender.

**Exact owner action needed:**
- Two Java processes (PIDs 18096 and 18228, the Firestore emulator from early runs) still hold ports
  8080/9150 and 8085/9151. They are safe to stop.
- To run real-environment checks: create or choose a Firebase project, enable email/password Auth,
  Firestore and Cloud Messaging, add a web app, and put its public config and VAPID key in
  `.env.local`.
