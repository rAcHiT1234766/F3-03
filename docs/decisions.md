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
- **Not used:** Pinia, RxJS, Tailwind, Storybook. Dexie live queries are consumed directly by a
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

## Not optimized yet

- The main JavaScript chunk is about 769 kB raw / 237 kB gzip, mostly Firebase Auth and
  Firestore. It is recorded as a baseline and left alone until a measured problem justifies
  splitting it (spec §22.3: do not optimize before an observed issue).
