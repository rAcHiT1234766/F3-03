# Progress

Entries follow the format in spec §31.1. Results are what was actually observed; anything not
executed is marked not run or blocked. Newest first.

## 2026-10-25 — Second interface redesign (checkpoint 4)

**Date and commit:** 2026-10-25, not committed yet (working tree on `main`, after `29182a3`).

**Current phase:** interface work requested by the owner after checkpoint 3, who found the first
redesign generic ("looks AI-made"), the sign-in screen most of all. No sync, storage, rules or
push behavior changed.

**Behavior now implemented:**
- A "field job book" design: ink app bar, paper background, safety orange as the only signal
  colour, IBM Plex Sans (condensed headings) and IBM Plex Mono (labels, references, times) in
  place of Inter, and a new brand mark (favicon, app icons, boot screen).
- Sign-in: an ink panel with the product statement, a signal readout that cycles through synced,
  no signal and back online, and three lines on how offline works; beside it a plain form with a
  show-password button and, in emulator mode only, a "demo data only" tag.
- Jobs: a ledger (one ruled sheet; per row a status stamp, a short reference, due, priority and
  sync columns on desktop), today's date, an overdue count, "/" to focus search, and on phones a
  four-column status filter and a floating New job button.
- Job sheet: a status stepper whose marker slides, ruled notes, job info and sync panels.
  Editor: one sheet in three numbered parts, status choices shown in their status colour.
- Sync center: an instrument-style readout, a numbered queue and stamped conflicts. Settings: an
  account block, lamp-style state lines and a storage gauge.
- Motion: entrances and state changes slide, never fade; reduced motion switches them off.

**Invariants or bugs addressed (each found by a test, a scan or the screenshot review):**
- axe measured the sign-in headline against the paper behind a pseudo-element background
  (2.51:1, Lighthouse Accessibility 96). The ink is now a real element background; back to 100.
- Phones: the "ready offline" notice covered the New job button; the status filter strip hid
  "Completed" past the edge; tapped controls kept their hover shade. All fixed.
- Stacked editor fields on phones had no spacing; the disabled Sign in button looked like a broken
  orange one; a paper strip showed under the sign-in panel while a notice was open; the desktop
  search box cut off its placeholder.
- The boot screen used the web fonts, so they started loading before first paint; it now uses
  system fonts and the web fonts load with the app.
- Reported by the owner after the first deploy: on wide screens the sign-in form scrolled away
  with the cover when the cover was taller than the window. The form column is now sticky, and
  notices on that screen float instead of adding scroll. Checked at 1280×650 and 1366×657: the
  cover scrolls 165–170 px while the form does not move.

**Commands run and actual results:**
- `npm run check`: passed. Lint clean, typecheck clean, **83/83** unit tests, build.
- `npx prettier --check src/ scripts/ index.html vite.config.ts`: clean.
- `npx playwright test` (after `npm run build:e2e`): **14 passed, 5 skipped** (the opt-in
  measurements). After the sign-in fix, one run in five had one failing test; its report was
  overwritten by the next run before it was read, so the test is not known. The other four runs
  passed in full.
- axe on every screen (sign-in, jobs, job, editor with each status, new job, Sync center,
  Settings, 404) at desktop and phone width, light and dark: no violations.
- Lighthouse 13.5.0 on `/sign-in`: mobile **87–88** / desktop **100** Performance, 100
  Accessibility, Best Practices and SEO, CLS 0 (desktop 0.005).
- `MEASURE=1 npx playwright test tests/e2e/measure.spec.ts`: 5/5. Results, and a same-session
  comparison with the previous design, in `docs/evidence.md`.
- `npm run test:rules` and `npm run test:sync`: **not re-run** (no rules or sync code changed; last
  results 21/21 and 17/17 at checkpoint 2).

**Browser/device checks performed:** automated Chromium 156 (headless): screenshots at 1280 px and
390 px in both themes, the phone status filter at 320–700 px. Not run: real devices, Firefox,
Safari, screen reader, Windows contrast themes by hand.

**Required external work:** since checkpoint 2 the owner created Firebase project `fe-03-56215`
(alias `prod` in `.firebaserc`) and deployed the Firestore rules and Hosting, with a `no-cache`
header on app routes (`firebase.json`). That deployment has the first redesign; this one is
**not deployed**. Still not run: real push delivery (T43–T45), installation on a target browser
(T42), Lighthouse on the deployed origin. GitHub and Google Drive submission: unchanged.

**Known limitations:** on a slow first visit the text appears in the fallback face and switches to
Plex when the fonts arrive (no layout shift). Mobile Lighthouse is 4 points below checkpoint 3,
the cost of the second typeface. The sign-in readout animation is decorative and hidden from
assistive technology.

**Decisions and reasons:** `docs/decisions.md` § Interface design.

**Next three tasks:**
1. Deploy this build and rerun Lighthouse and the PWA checklist on the HTTPS origin.
2. Real-device pass: install, offline use and push on a phone (T42–T45).
3. Manual screen-reader and Windows contrast-theme check of the new screens.

**Exact owner action needed:** review the redesign; commit it (with `.firebaserc`, `firebase.json`
and the new `SignalBars.vue` and `StatusDot.vue`); then `npm run build` and
`npx firebase deploy --only hosting --project prod` to publish it. The four `Screenshot (…).png`
files in the project root are not part of the project.

## 2026-10-24 — Interface redesign (checkpoint 3)

**Date and commit:** 2026-10-24, fourth commit on `main` (follows `b1f4937`).

**Current phase:** interface and accessibility work requested by the owner, after Phase 9. No
sync, storage, rules or push behavior changed.

**Behavior now implemented:**
- A design system in `src/style.css`: colour, type, spacing, radius and shadow tokens, light and
  dark themes, and support for high contrast, forced colors (Windows contrast themes), reduced
  motion and larger touch targets on touch screens.
- Theme choice in **Settings → Appearance** (System, Light, Dark), applied before first paint and
  kept in this browser only.
- Icons (`@lucide/vue` 1.54.0) and the Inter variable font (`@fontsource-variable/inter` 5.3.0,
  Latin only, precached). Status, sync state and priority always show words with the icon.
- Jobs: card grid with a status stripe, search with a clear button, status filter pills with
  counts, due dates in words ("Due today", "Overdue by 2 days"), an overdue count in the header,
  loading skeletons and empty states.
- Job details: progress buttons, separate description and notes, a job info panel and a sync
  panel. Job editor: grouped sections, choice pills for status and priority, character counters.
- Sync center: a status summary in plain language, stat tiles, conflicts side by side, the queue
  as a timeline, and the raw error under "Technical details".
- Sign-in: introduction panel, show-password button and a loading state on submit.
- Phones: a bottom tab bar for Jobs, Sync center and Settings, and a floating New job button.
- Confirmations (delete job, discard changes, discard sync items) use a native modal dialog that
  keeps and returns focus, in place of `window.confirm`.

**Invariants or bugs addressed (each found by a test or a measurement):**
- Section headings that contained a field's label ("Job and customer") made `getByLabel`
  ambiguous in the browser suite; the headings were renamed.
- Fade-in animations let axe measure text mid-fade (contrast 3.46:1) in about one run in five.
  Animations now move, never fade, text; the accessibility tests then passed 10 of 10 repeats.
- `backdrop-filter` on the header made it the containing block of the fixed tab bar, so the bar
  showed inside the header on phones; it is off at phone width.
- Mobile Lighthouse fell from 93 (old design, same machine) to 87–89. Font preload and Firebase
  merged into the entry chunk were the causes; final 91–92.
- Creating an `Intl.DateTimeFormat` per date slowed the 200-job list (556 ms); formatters are now
  created once (416 ms).
- Storage above 1024 MB showed as "10240.2 MB"; it now shows GB.

**Commands run and actual results:**
- `npm run check`: passed. Lint clean, typecheck clean, **83/83** unit tests (3 new, for due-date
  wording), build with 26 precache entries.
- `npx playwright test` (after `npm run build:e2e`): **14 passed, 5 skipped**. T06 (delete) now
  confirms in the in-app dialog instead of the browser's.
- `MEASURE=1 npx playwright test tests/e2e/measure.spec.ts`: 5/5; results in `docs/evidence.md`.
- Lighthouse 13.5.0 on `/sign-in`: mobile **92** / desktop **100** Performance, 100
  Accessibility, Best Practices and SEO, CLS 0.
- axe: no serious or critical violations on 7 screens, in light and dark.
- `npm run test:rules` and `npm run test:sync`: **not re-run** (no rules or sync code changed;
  last results 21/21 and 17/17 at checkpoint 2).

**Browser/device checks performed:** automated Chromium 156 (headless) and screenshots at phone
(390 px) and desktop widths in both themes. Not run: real devices, Firefox, Safari, screen reader,
Windows contrast themes by hand.

**Required external work:** unchanged from checkpoint 2.

**Known limitations:** the first download of 200 jobs takes about 150 ms longer than before
because the cards render more. The UI font may appear only from the second visit (it is not allowed to
delay the first one).

**Decisions and reasons:** `docs/decisions.md` § Interface design.

**Next three tasks:** unchanged from checkpoint 2.

**Exact owner action needed:** unchanged from checkpoint 2.

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
- Two leftover Java processes from this session's earliest emulator runs (before the Windows fix)
  are safe to stop; this session was not permitted to stop them: PID 18096 (ports 8080/9150) and
  PID 18228 (ports 8085/9151). The project uses port 8086, so they do not block anything.
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
