# Evidence report

Format from spec §25.3. Values are what was observed on 2026-10-24. Nothing here comes from a
deployed environment; every row says which environment produced it.

**Release/commit:** the commit containing this file on local branch `main` (`git log -1`). No
remote repository exists yet.

**Build URL and environment:** no deployment. Local production builds only:
- `dist/`: production build with no Firebase config (used for bundle sizes).
- `dist-e2e/` and `dist-e2e-next/`: production builds in emulator mode (build IDs `e2e-a` and
  `e2e-b`), served by `tests/e2e/static-server.mjs` on `http://127.0.0.1:4173`, with gzip like
  Firebase Hosting.

**OS / browser / device:** Windows 11 Home 10.0.26200; Intel Core i5-1135G7 (4 cores / 8 threads),
15.7 GB RAM. Playwright Chromium 156.0.8078.4, headless.

**Versions:** Node 24.22.1, npm 11.19.1, Vue 3.5.44, Vite 8.3.5, TypeScript 6.0.3, Dexie 4.4.7,
Firebase JS SDK 13.1.0, firebase-tools 15.34.1, Workbox 7.4.1, vite-plugin-pwa 2.0.0, Vitest 4.1.12,
Playwright 1.64.1, Java 25.0.2, Firestore emulator 1.22.0. Full table: `docs/decisions.md`.

**Dataset and account setup:** fictional jobs only. Each test creates its own users through the
Auth emulator (`tech-<random>@example.test`) and its own jobs. Measurement datasets of 25, 50 and
200 jobs were seeded straight into the emulator for those runs. No real accounts or passwords exist
in the repository.

## Automated commands and observed results

| Command | Result |
|---|---|
| `npm run check` | Pass: oxlint + ESLint clean, `vue-tsc --build` clean, Vitest **80/80** (5 files), production build OK (21 precache entries) |
| `npm run test:rules` | **21/21** passed (Firestore emulator) |
| `npm run test:sync` | **17/17** passed (Auth + Firestore emulators) |
| `npx playwright test` (after `npm run build:e2e`) | **14 passed, 5 skipped** in Chromium 156 (the 5 skipped are the opt-in measurement scenarios) |
| `MEASURE=1 npx playwright test tests/e2e/measure.spec.ts` | 5/5 measurement scenarios completed; results below |

Scenario status T01–T48: `docs/test-matrix.md`.

## Offline preparation and network-disconnection method

- **Preparation:** sign in online, wait until `navigator.serviceWorker.controller` is set and the
  "ready to work offline" notice appears (precache complete, page controlled), and let the first
  reconciliation finish.
- **Offline:** Playwright `context.setOffline(true)`, which blocks network requests for that browser
  context. The app's files then come from the worker's precache and its data from IndexedDB.
- **Server unreachable while "online":** Playwright `context.route` refuses requests to the
  Firestore emulator while the app origin stays reachable (T41, T38, T47).
- **Not run:** OS-level network disconnection, and checking whether DevTools-style offline also
  blocks worker-originated requests (spec §21.1 warning). The worker makes no network requests for
  app data, so offline behavior does not depend on that.

## Canonical receipt and revision verification

Browser tests read canonical documents straight from the Firestore emulator REST API
(`tests/e2e/fixtures.ts`: `serverJob`, `serverReceipts`) after each sync. They check revisions,
fields, `lastOpId` and receipt counts, not just the screen. The emulator sync tests read with
`getDoc`/`getDocs` from an authenticated client.

## Real push delivery evidence

**Blocked.** No Firebase project, VAPID key or opted-in device is available. Prepared: FID
registration in Settings, owner-only device documents (rule-tested), the worker's background
handler, and `scripts/send-test-push.mjs` (its argument guards were verified locally). A real send
has not been attempted.

## Lighthouse

**Lighthouse 13.5.0**, using Playwright's Chromium 156. Available categories: Performance,
Accessibility, Best Practices, SEO and Agentic browsing. There is no PWA category any more; see
`docs/pwa-checklist.md`. The page is `/sign-in`, the screen that needs no account, on the
emulator-mode production build. Reports: `docs/evidence/lighthouse/` (HTML and JSON).

| Run | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| 1. Baseline (uncompressed test server) — mobile | 60 | 100 | 100 | 100 | 5.5 s | 5.7 s | 110 ms | 0.119 |
| 1. Baseline — desktop | 97 | 100 | 100 | 100 | 1.0 s | 1.1 s | 0 ms | 0.028 |
| 2. After app fixes (still uncompressed) — mobile | 67 | 100 | 100 | 100 | 5.0 s | 5.5 s | 70 ms | 0 |
| 3. After app fixes, gzip like Hosting — mobile | **94** | 100 | 100 | 100 | 2.3 s | 2.6 s | 70 ms | 0 |
| 3. After app fixes, gzip like Hosting — desktop | **100** | 100 | 100 | 100 | 0.5 s | 0.7 s | 0 ms | 0 |

What changed between runs:
- **App fixes (1 → 2):** the layout shift came from the "ready to work offline" notice being
  inserted above the page. Transient notices now come after the page content and stick to the
  bottom of the screen, so CLS dropped to 0. A static boot shell in `index.html` paints before the
  JavaScript runs. Firebase Messaging is now loaded only after sign-in.
- **Test-server correction (2 → 3):** the local test server sent 780 kB of JavaScript uncompressed,
  which a real host would not. Under Lighthouse's simulated slow 4G link that starved the
  stylesheet. Serving gzip, as Firebase Hosting does, removed that artifact. A run against the
  deployed site is still **Blocked**.

A good Lighthouse score does not prove sync correctness; the T-series tests do.

## Performance measurements and method

Method: `tests/e2e/measure.spec.ts`. Durations are taken inside the page with `performance.now()`
and a `MutationObserver`, on one timing context, so no clocks are compared across devices.
Backend: **local emulators** on the same machine, so these are not real Firebase network timings.
Results: `docs/evidence/measurements.json`.

| Metric | Median | Range | Runs | Method |
|---|---|---|---|---|
| Local save (Save → IndexedDB commit → job details shown) | 16 ms | 9.7–33.6 ms | 10 | Create via the form, Firestore unreachable |
| Warm offline load (navigation → first job listed, 25 jobs) | 182 ms | 160–187 ms | 5 | Prepared profile, offline |
| Queue drain, 20 operations | 3.44 s | 2.72–4.00 s | 3 | 2 jobs × (create + 9 status edits); about 170 ms per operation |
| First download, 50 jobs (sign-in submit → all listed) | 183 ms | 179–248 ms | 3 | Includes auth, database open, one full read (50 docs) and local apply |
| Repeat reconciliation, 50 jobs (nothing changed) | 44 ms | 43–52 ms | 3 | Sync now → Ready; 50 document reads |
| First download, 200 jobs | 261 ms | 259–281 ms | 3 | 200 document reads |
| Repeat reconciliation, 200 jobs | 105 ms | 101–108 ms | 3 | 200 document reads per reconciliation |
| Duplicate-effect count | 0 | — | — | T08, T09, T20, T21, T48: receipts = operations, one revision per change |
| Disjoint-conflict preservation | 100 % | — | — | T26 in both orders (unit and emulator) |

Initial goals from §22.3: local save "typically below 100 ms" was met (16 ms median); warm offline
load "around 1 second" was met (0.18 s). Both are on this machine with emulators.

**Production bundle** (`dist/`, `node scripts/bundle-size.mjs`, `docs/evidence/bundle-size.json`):

| Part | Raw | Gzip |
|---|---|---|
| Firebase chunk (`index.esm-*.js`) | 582.1 kB | 176.3 kB |
| App entry (`index-*.js`) | 142.4 kB | 46.3 kB |
| Vue runtime shared chunk | 56.4 kB | 21.9 kB |
| Notifications (lazy) | 28.2 kB | 8.6 kB |
| Lazy screens (editor, Sync center, Settings, 404) | 24.1 kB | 8.7 kB |
| Service worker `sw.js` | 68.9 kB | 21.3 kB |
| CSS | 6.5 kB | 2.3 kB |

## Known limitations and unresolved issues

- Sync runs only while a page is open, and on reopen. There is no closed-app sync.
- Full reconciliation reads every job, tombstones included, so reads grow with dataset size. It
  is sized for tens to a few hundred jobs (200 jobs: 105 ms per repeat reconciliation against the
  emulator).
- Notes merge as one field. Concurrent edits to different paragraphs are a same-field conflict.
- A value changed and changed back elsewhere looks unchanged to the field merge (documented).
- The merge runs in the owner's client. The rules enforce structure and ownership, not the merge
  policy.
- Not verified yet: real Firebase project, HTTPS deployment, installation, real push, Firefox and
  Safari, OS-level disconnection, manual screen-reader pass.
- Two Firestore-emulator JVMs from early runs (before the fix in `scripts/firebase-emulators.mjs`)
  and the test servers from one interrupted test run were still running when this was written;
  see `docs/progress.md`.
