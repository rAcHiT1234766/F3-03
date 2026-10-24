# Decisions

Decisions made while implementing FieldLog, with the reason for each. Dates are when the decision
was recorded. The specification is `FE-03-Codex-Project-Workflow.md`.

## Environment and tooling (2026-10-24)

Versions actually installed (not copied from a tutorial):

| Tool / library | Version |
|---|---|
| Node / npm | 24.22.1 / 11.19.1 |
| Vue / Vue Router | 3.5.44 / 5.4.0 |
| Vite / TypeScript / vue-tsc | 8.3.5 / 6.0.3 / 3.3.13 |
| Dexie | 4.4.7 |
| Firebase JS SDK / firebase-tools / firebase-admin | 13.1.0 / 15.34.1 / 14.5.0 |
| Workbox / vite-plugin-pwa | 7.4.1 / 2.0.0 |
| Vitest / fake-indexeddb / @vue/test-utils / jsdom | 4.1.12 / 6.2.6 / 2.5.1 / 30.1.3 |
| @firebase/rules-unit-testing | 6.0.0 |
| Playwright / Chromium build | 1.64.1 / 156.0.8078.4 |
| @axe-core/playwright | 4.14.0 |
| ESLint / oxlint / Prettier | 10.13.0 / 1.82.0 / 3.9.6 |
| Java (Firestore emulator runtime) / Firestore emulator | 25.0.2 / 1.22.0 |

- **npm** is the package manager; `package-lock.json` is committed.
- **Scaffold:** official `create-vue@3.24.0` with TypeScript, Router, Vitest, Playwright, ESLint
  (with oxlint) and Prettier, generated in a scratch folder and copied in so the spec file was
  untouched. `vite-plugin-vue-devtools` was removed (not needed). It picked TypeScript ~6.0 and
  Vitest 4 as a compatible set, and those were kept instead of forcing TypeScript 7 / Vitest 5.
- **npm 11 install scripts** are left unapproved: `@firebase/util` (only reads the optional
  `FIREBASE_WEBAPP_CONFIG`), `protobufjs` (version check) and `re2` (Hosting emulator only). None is
  needed for this project, and everything works without them.
- **Firebase CLI** is a dev dependency, not a global install. Docker is not used.
- **No in-memory fixture stage.** Phase 1 suggests a fixture-driven UI before Dexie. The Dexie layer
  was ready in the same session, so the UI was built on it directly. The Phase 1 gate (a form
  interaction test, type checking, a production build) is still met by `tests/unit/editor.test.ts`
  and `npm run check`.
- **Not used:** Pinia, RxJS, Tailwind, Storybook, a component library. Dexie live queries are consumed directly by a
  small composable.

## Sync semantics

- **"Last" means last successful server commit on the job**, ordered by the per-job `revision`
  that Firestore transactions control. Device clocks never decide a winner (`clientCreatedAt` is
  for display and is tested to have no effect, T29).
- **Final policy: field-level merge** with the same server-commit tie-break for overlapping fields.
  It is a code constant (`FINAL_POLICY` in `src/sync/merge.ts`), so live clients cannot select
  different policies. Record-level LWW exists only as a resolver option, used by tests against
  isolated data to demonstrate its weakness (T25).
- **Terminal deletion.** A delete keeps the fields in the tombstone (the rules enforce this). An
  update after a delete returns `rejected_deleted`; a repeated delete is a `noop`; a create using a
  tombstoned or existing ID, and a patch or delete of a missing job, are blocked errors without a
  receipt, so there is never an implicit create.
- **Receipt identity.** Each receipt stores the full immutable request, compared with a
  key-order-independent serialization (`stableStringify`). Payloads are small, so there is no
  hashing.
- **Timestamps.** Firestore documents hold real `Timestamp`s. The local shadow stores the server
  commit time in milliseconds, so `src/domain.ts` stays SDK-free; `src/sync/remote.ts` converts.
- **Deleted elsewhere, edits kept.** When a `rejected_deleted` receipt is acknowledged, the user's
  intended values are kept in a `deleted` notice and later operations for that job are held as
  `blocked / job_deleted`, not sent to collect more rejections. Recovery creates a replacement job
  with a new UUID and never resurrects the tombstone.
- **Forgetting a blocked change** first asks the server for the operation's receipt, under the sync
  lock. It is removed only if the server confirms no effect; if a receipt exists, it is
  acknowledged instead.

## Engine

- One Web Lock per project + UID covers selection, sending, acknowledgement and reconciliation.
  Local saves never take this lock. If Web Locks are missing, the engine reports `unsupported` and
  does not sync; there is no unsafe fallback.
- A row still `sending` when the lock is acquired is recovered to a due retry with the same opId.
  The receipt check makes that safe.
- A cycle runs reconcile → push (up to 25 operations or 15 s, checked between requests) →
  reconcile again only if something was acknowledged, which saves reads.
- If the first reconciliation read fails, the cycle pauses before sending anything.
- Backoff starts at 2 s, doubles, is capped at 60 s, and has ±20 % jitter. Time and randomness are
  injected in tests.
- An auth failure pauses automatic triggers until a sign-in or a manual Sync now.
- There is no `Promise.race` timeout. A long request only shows a "taking a long time" indicator
  after 20 s and keeps its identity and the lock until it settles.

## Defects found by testing, and their fixes

1. **Resolver copied unknown patch keys** (found while writing the metadata property test). It
   iterated `Object.keys(patch)`, so a stray `revision` key would have entered the fields. Payload
   validation already blocks this before transport, but the resolver now iterates only the known
   business fields.
2. **Contention surfaced as `permission-denied`** (found by the emulator test with two devices
   committing to one job at once). Firestore evaluated the rules against the revision the other
   device had just committed (`revision == resource.revision + 1` failed), so the losing commit
   came back as a permanent denial, not a retryable conflict, and the engine correctly blocked it.
   Fix: `applyOperation` re-runs the transaction up to 3 times on `permission-denied`. This is safe
   because a failed commit applies nothing, the receipt check makes re-runs idempotent, and a
   genuine denial repeats every time. A temporary revert of the fix makes the test fail again.

3. **Update applied but the page did not reload** (found by T38). workbox-window records whether a
   page "is an update" once, at registration. A page first loaded uncontrolled (a first visit,
   where `clientsClaim` takes control later) therefore never got the plugin's reload, and kept
   running old code under the new worker. Fix (`src/pwa.ts`): after the user's own Update now, the
   app reloads exactly once on `controllerchange`, and the plugin's reload is suppressed
   (`onNeedReload: () => {}`). This avoids both a double reload and a reload loop.
4. **Duplicate screen-reader announcements** (found by a strict-mode locator in T38). Messages
   appeared both in a visible `role="status"` banner and in the hidden announcer. The announcer is
   now used only when there is no visible live region, such as just before navigating away.
5. **Layout shift, then a covered Save button.** Lighthouse traced CLS 0.119 to the "ready offline"
   notice being inserted above `<main>`. Moving notices into a fixed toast then made the toast
   cover the editor's Save button on short pages (found by the browser suite). Notices now sit in
   a sticky region after the page content: CLS 0, and nothing is permanently covered.

## Performance changes made after measurement

Made only after Lighthouse showed a problem (mobile Performance 60):

- A static boot shell in `index.html` paints the header and "Opening FieldLog…" before the
  JavaScript runs.
- Firebase Messaging is loaded with `import()` after sign-in (8.6 kB gzip moved off the first
  screen).
- The e2e/Lighthouse static server now gzips like Firebase Hosting. Before that, the throttled
  mobile run was measuring an uncompressed local server, not the app.
- Not done: splitting Firestore out of the startup path. Its chunk (176 kB gzip) is precached
  after the first visit (warm offline load 182 ms), and deferring it would restructure the
  session code for a first-visit-only gain.

## Firebase integration

- **Firestore memory cache only** (`memoryLocalCache`). The Dexie outbox is the durable queue, and
  business writes are online transactions. Only server-backed reads (`getDocsFromServer`,
  `getDocFromServer`) are used for reconciliation and receipts.
- **Auth persistence:** IndexedDB, with local storage as fallback. The app waits for
  `authStateReady()` before choosing an account database.
- **One Dexie database per project + UID** (`fieldlog:<projectId>:<uid>`). The device ID is a UUID
  in that database's `meta` store, so it is scoped to one browser profile and one account.
- **FCM uses FID registration.** Firebase 13 deprecates `getToken`/`deleteToken` in favour of
  `register` + `onRegistered` / `unregister` (Firebase Installation IDs), and the Admin SDK sends to
  `{ fid }`. The device document stores `fid`. This adapts the spec's "registration token" wording
  to the installed SDK; the requirement (owner-only device record, no token in source or logs)
  is unchanged.
- **One service worker:** `vite-plugin-pwa` `injectManifest` with `src/sw.ts`, registered only
  through `virtual:pwa-register` (`injectRegister: false`). Updates use the prompt flow;
  `clientsClaim` lets the first visit become controlled; the navigation fallback excludes `/__/`.

## Local environment issues

- **Orphaned emulator JVMs on Windows.** `java` on PATH is Oracle's `javapath` launcher, which starts
  the real JVM as a separate process. `firebase emulators:exec` stops only the launcher, so the
  Firestore emulator kept running and holding its port. `scripts/firebase-emulators.mjs` puts
  `<java.home>/bin` first on PATH and runs the CLI's JS entry point without a shell; a run
  verified that no JVM is left behind. Two JVMs orphaned before the fix (holding ports 8080/9150 and
  8085/9151) could not be stopped from this session, so the project uses Firestore port **8086**
  (websocket 9152).
- **Browser tests use a small static server** (`tests/e2e/static-server.mjs`), not `vite preview`,
  so the update test can swap build A for build B on the same origin.

## Interface design (2026-10-24)

The UI was redesigned after the functional work was complete. Behaviour, data flow and the sync
protocol did not change.

- **Design system in plain CSS** (`src/style.css`): colour tokens on `:root`, a dark set applied
  from the OS setting or from Settings → Appearance (`data-theme` on `<html>`, chosen before
  first paint by a small inline script in `index.html`, stored in `localStorage` as a per-device
  preference). Text/background pairs were chosen for WCAG AA; `prefers-contrast: more`,
  `forced-colors: active` and `prefers-reduced-motion` are handled. Still no CSS framework.
- **Two UI packages:** `@lucide/vue` 1.54.0 for icons (tree-shaken: only the ~25 icons in use are
  bundled; pinned to a release over two weeks old rather than the newest, as a supply-chain
  precaution) and `@fontsource-variable/inter` 5.3.0, self-hosted so the font works offline.
  Only the Latin subset is used.
- **Status is never colour alone:** every status, priority and sync state has an icon and text.
- **Due dates** are worded relative to today for open jobs ("Due today", "Overdue by 2 days";
  `describeDue` in `src/ui.ts`, unit-tested) and use local calendar days, never timestamps.
- **Confirmations use one native modal `<dialog>`** (`src/dialog.ts`, `ConfirmDialog.vue`)
  instead of `window.confirm()`: the browser provides focus trapping, Escape and an inert
  background; destructive dialogs start focused on Cancel. Without a mounted host (component
  tests) it falls back to `confirm()`. T06 now confirms through the dialog.
- **Phones get a bottom tab bar** and a floating "New job" button; it is the same `<nav>` restyled
  by CSS, so there is one set of links. The header's `backdrop-filter` is turned off at that size
  because it would make the header the containing block of the fixed tab bar (found in the
  screenshot review).
- **Test-facing names were kept:** headings, labels, button names and `data-testid` values the
  suites rely on are unchanged. Editor section headings avoid field names, because Playwright's
  `getByLabel` also matches regions named by `aria-labelledby` ("Job and customer" matched
  "Customer").
- **No fading text.** Toasts slide in without an opacity change and delayed loading text switches
  on at once. The axe scan intermittently caught the "ready offline" toast mid-fade at 3.46:1
  contrast (found by repeating the accessibility test after one failure).

### Performance cost, measured

Lighthouse 13.5 mobile on `/sign-in`, the previous commit and the redesign measured back to back
on the same machine: previous design 93 and 93; first redesign build 88, 87 and 88 (LCP 3.1 s,
TBT 180 ms). Two causes were found in the reports and fixed:

1. **The font preload competed with the JavaScript** on the throttled link. The preload was
   removed, the boot screen uses the system font, and the face uses `font-display: optional`: a
   first visit keeps the system font if Inter is not ready at once (no swap, no layout shift),
   and later launches read Inter from the service-worker precache.
2. **The bundler had merged Firebase into the entry chunk**, giving longer start-up tasks. Explicit
   `codeSplitting` groups (`vite.config.ts`) restore separate Firebase and Vue chunks, and keep
   Firebase Messaging and Installations in the lazy notifications chunk.

Result: 91–92 over five runs (LCP 2.7–2.9 s, TBT 10–100 ms, CLS 0). The remaining gap of about
0.3 s LCP is roughly 14 kB gzip of icons and screen code plus a larger stylesheet, accepted for
the interface. Desktop stays at 100.

## Not optimized yet

- The Firebase chunk is about 547 kB raw / 162 kB gzip (Auth and Firestore). It loads at start
  because the session code needs it; deferring it would restructure session start-up for a
  first-visit-only gain (spec §22.3: do not optimize before an observed issue).
