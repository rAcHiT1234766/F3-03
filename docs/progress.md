# Progress

Entries follow the format in spec §31.1. Results are what was actually observed; anything not
executed is marked not run or blocked. Newest first.

## 2026-10-24 — Phase 9, verification and documentation (checkpoint 2)

**Date and commit:** 2026-10-24, second commit on `main` (follows `71ea90f`).

**Current phase:** everything that can be done locally for Phases 0–9 and the verification and
documentation work (§20–§26) is done. The remaining work needs external access (see below).

**Behavior now implemented:**
- Trusted push sender `scripts/send-test-push.mjs`: Admin SDK, Application Default Credentials,
  FID target. It refuses demo projects and emulator environments and never prints IDs or
  credentials.
- The update flow now reloads exactly once after the user's own Update now (fixed, below) and
  shows "Updating…" while it waits for in-flight sync.
- Transient notices (offline ready, update, push) moved into a sticky region after the page
  content: no layout shift, and controls are never permanently covered.
- Static boot shell in `index.html` for first paint. Firebase Messaging loads only after sign-in.
- The app version (`package version + git commit` or `FIELDLOG_BUILD_ID`) is shown in Settings.
- CI workflow (`.github/workflows/ci.yml`): configured, **not run** (no GitHub remote).
- Docs: README, architecture, sync protocol, test matrix, PWA checklist, evidence report,
  requirements checklist, presentation outline, reflection questions, submission index.

**Invariants or bugs addressed (each found by a test):**
- The update did not reload a page that was first loaded uncontrolled (workbox-window fixes
  `isUpdate` at registration). The app now owns a single reload on the user's update (T38).
- Status messages were announced twice: in a visible `role="status"` region and again in the
  hidden announcer. The duplicate announcement was removed where a visible live region exists.
- The "ready offline" notice inserted above the page caused CLS 0.119 (Lighthouse). As a fixed
  toast it then covered the editor's Save button (found by the browser suite); now it is sticky,
  in flow.
- The test server sent JavaScript uncompressed, which distorted Lighthouse's throttled mobile
  result. It now gzips as Hosting does.

**Commands run and actual results:**
- `npm run check`: passed. Lint clean, typecheck clean, **80/80** unit tests, build with 23
  precache entries.
- `npm run test:rules`: **21/21**. `npm run test:sync`: **17/17**.
- `npx playwright test` (after `npm run build:e2e`): **14 passed, 5 skipped** (the 5 skipped are
  the opt-in measurement scenarios).
- `MEASURE=1 npx playwright test tests/e2e/measure.spec.ts`: 5/5; results in `docs/evidence.md`.
- Lighthouse 13.5.0 on `/sign-in`: mobile 94 / desktop 100 Performance, 100 Accessibility, Best
  Practices and SEO, CLS 0, using the gzip test server. The progression is in `docs/evidence.md`.
- axe: no serious or critical violations on 7 screens, in light and dark.

**Browser/device checks performed:** automated Chromium 156 only (headless). Not run: manual
install, Firefox, Safari, real devices, OS-level network disconnection, screen reader.

**Required external work:**
- Firebase project, HTTPS deployment, deployed rules: **blocked** (no project or credentials).
- Real push T43–T45 (click partly covered on the page side): **blocked**.
- Installation T42: **not run** (needs an interactive browser).
- GitHub repository, CI run, Google Drive upload and reviewer access: **blocked**.
- Demo recording, final deck and personal reflection: **needs the intern**.

**Known limitations:** unchanged from checkpoint 1. See `docs/evidence.md` § Known limitations.

**Decisions and reasons:** `docs/decisions.md`. New this checkpoint: FID push registration, the
reload ownership, toast placement, the lazy messaging chunk, and the e2e static server.

**Next three tasks:**
1. Create the Firebase project and `.env.local`; deploy rules and hosting; repeat T35/T38 and
   Lighthouse on the deployed HTTPS origin.
2. Enable notifications on a real device; run T43–T45 with `scripts/send-test-push.mjs`; install
   on Chrome/Edge (T42) and record the results in `docs/test-matrix.md`.
3. Push to GitHub and confirm CI passes; record the demo video; finish the deck and reflection;
   upload to Drive per `docs/submission-index.md`.

**Exact owner action needed:**
- Leftover processes from this session that are safe to stop (it was not permitted to stop them):
  Java PIDs 18096 (ports 8080/9150) and 18228 (8085/9151), the emulators from early runs; and the
  test servers from an interrupted run, node PID 19884 (emulator hub, Auth 9099, UI 4000) with
  Java PID 10964 (Firestore 8086/9152), and node PID 6560 (static server 4173). Later test runs
  reuse the last group.
- Provide Firebase project access (Auth email/password, Firestore, Cloud Messaging, a Web app and a
  VAPID key) and decide whether deployment to Firebase Hosting is authorized.
- Create a GitHub repository and authorize pushing to it, if wanted.

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
