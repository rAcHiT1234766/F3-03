# Evidence report

Format from spec §25.3. Values are what was observed on 2026-10-24, except the real-device
results dated 2026-10-31 and later, which come from the deployed site. Every row says which
environment produced it.

**Release/commit:** the commit containing this file on local branch `main` (`git log -1`). No
remote repository exists yet.

**Build URL and environment:** deployed at https://fe-03-56215.web.app (Firebase Hosting, project
`fe-03-56215`) since 2026-10-25, used for the real-device results. Everything else comes from
local production builds:
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
| `npm run check` | Pass: oxlint + ESLint clean, `vue-tsc --build` clean, Vitest **83/83** (6 files), production build OK (26 precache entries, including the UI font) |
| `npm run test:rules` | **21/21** passed (Firestore emulator) |
| `npm run test:sync` | **17/17** passed (Auth + Firestore emulators) |
| `npx playwright test` (after `npm run build:e2e`) | **14 passed, 5 skipped** in Chromium 156 (the 5 skipped are the opt-in measurement scenarios), on the redesigned UI. The two accessibility tests also passed 10 of 10 repeated runs after the contrast fix below |
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

**Pass on one Android phone.** Owner check on 2026-11-01. FieldLog was installed from the live
site in Chrome on an Android 10 phone, with notifications enabled in Settings (its device document
shows `enabled: true` in the Firestore console). Messages were sent from this PC with
`scripts/send-test-push.mjs`, signed in through gcloud Application Default Credentials as the
project owner. Firebase accepted every send and returned a message ID.

| Test | Phone state | Observed |
|---|---|---|
| T43 | FieldLog open on screen | In-app banner "A job was updated."; Open job opened that job |
| T44 | FieldLog swiped away from recent apps | A system notification from the service worker arrived |
| T45 | Tap on that notification | FieldLog opened on that job |

Finding: the first two sends had no `--job`. Firebase accepted them, but nothing appeared on the
phone, because the app accepts only messages that name a valid job ID (`parseJobMessage` in
`src/domain.ts`). The script now requires `--job`. Not run: denied permission
(T46), other browsers, iOS.

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
| 4. Interface redesign, first build — mobile | 89 | 100 | 100 | 100 | 2.2 s | 3.0 s | 170 ms | 0 |
| 5. Interface redesign, final — mobile | **92** | 100 | 100 | 100 | 2.4 s | 2.9 s | 0 ms | 0 |
| 5. Interface redesign, final — desktop | **100** | 100 | 100 | 100 | 0.6 s | 0.6 s | 0 ms | 0 |
| 6. Second redesign ("field job book") — mobile | 88 | 100 | 100 | 100 | 2.9 s | 3.2 s | 20 ms | 0 |
| 6. Second redesign ("field job book") — desktop | **100** | 100 | 100 | 100 | 0.5 s | 0.7 s | 50 ms | 0.005 |

What changed between runs:
- **App fixes (1 → 2):** the layout shift came from the "ready to work offline" notice being
  inserted above the page. Transient notices now come after the page content and stick to the
  bottom of the screen, so CLS dropped to 0. A static boot shell in `index.html` paints before the
  JavaScript runs. Firebase Messaging is now loaded only after sign-in.
- **Test-server correction (2 → 3):** the local test server sent 780 kB of JavaScript uncompressed,
  which a real host would not. Under Lighthouse's simulated slow 4G link that starved the
  stylesheet. Serving gzip, as Firebase Hosting does, removed that artifact. Lighthouse has not
  been run against the deployed site yet.
- **Interface redesign (3 → 4 → 5):** the first redesigned build scored 87–89 on mobile. Measured
  back to back on the same machine, the previous design scored 93 twice, so the drop was real. Two
  causes were fixed: the UI font's preload competed with the JavaScript, and the bundler had merged
  Firebase into the entry chunk (longer start-up tasks). Final build: 91–92 over five runs, TBT
  0–100 ms, CLS 0. Details: `docs/decisions.md` § Interface design.
- **Second redesign (5 → 6):** 87–88 on mobile over the final build's three runs, 100 on desktop.
  The new type (IBM Plex Sans variable and Plex Mono 400 and 600, 94 kB, in place of Inter's
  48 kB) is requested by the app's first render. In Lighthouse's unthrottled trace that render
  comes before the observed first paint, so the simulation charges the fonts to FCP (2.4 s →
  2.9 s). The boot screen now uses system fonts only, so on a slow link the fonts load after the
  JavaScript: with applied throttling (`--throttling-method=devtools`) the boot screen painted at
  1.6 s and the first font request started at 3.4 s. Accessibility is back to 100 after a contrast
  fix this run found (`docs/decisions.md` § Interface design). The reports in
  `docs/evidence/lighthouse/` are run 6.

A good Lighthouse score does not prove sync correctness; the T-series tests do.

## Performance measurements and method

Method: `tests/e2e/measure.spec.ts`. Durations are taken inside the page with `performance.now()`
and a `MutationObserver`, on one timing context, so no clocks are compared across devices.
Backend: **local emulators** on the same machine, so these are not real Firebase network timings.
Results: `docs/evidence/measurements.json`.

| Metric | Median | Range | Runs | Method |
|---|---|---|---|---|
| Local save (Save → IndexedDB commit → job details shown) | 8.1 ms | 7.0–20.4 ms | 10 | Create via the form, Firestore unreachable |
| Warm offline load (navigation → first job listed, 25 jobs) | 164 ms | 144–232 ms | 5 | Prepared profile, offline |
| Queue drain, 20 operations | 2.44 s | 2.21–3.31 s | 3 | 2 jobs × (create + 9 status edits); varies from run to run |
| First download, 50 jobs (sign-in submit → all listed) | 236 ms | 215–240 ms | 3 | Includes auth, database open, one full read (50 docs), local apply and rendering the list |
| Repeat reconciliation, 50 jobs (nothing changed) | 52 ms | 48–53 ms | 3 | Sync now → Ready; 50 document reads |
| First download, 200 jobs | 331 ms | 316–332 ms | 3 | 200 document reads |
| Repeat reconciliation, 200 jobs | 92 ms | 84–107 ms | 3 | 200 document reads per reconciliation |
| Duplicate-effect count | 0 | — | — | T08, T09, T20, T21, T48: receipts = operations, one revision per change |
| Disjoint-conflict preservation | 100 % | — | — | T26 in both orders (unit and emulator) |

Initial goals from §22.3: local save "typically below 100 ms" was met (8.1 ms median); warm offline
load "around 1 second" was met (0.16 s). Both are on this machine with emulators.

These figures are for the second redesign (2026-10-25). The same machine drifts by tens of percent
over a day, so the two designs were also compared in one session, alternating builds:
- Full suite, previous design between two runs of the new one: first download of 200 jobs 624 ms
  against 476 and 555 ms; repeat reconciliation of 200 jobs 146 ms against 174 and 195 ms; the
  other metrics, apart from the warm offline load below, within run-to-run spread.
- Warm offline load, official test, three alternating rounds: 160–217 ms (new) against 149–163 ms
  (previous). A traced comparison that let the page settle before each reload (8 loads each)
  found no difference, 126–141 ms against 136–157 ms, with the same main-thread work before the
  first row (about 20 ms of script in both; style, layout and paint about 10 ms against 13 ms).
  The cause of the gap in the official test was not isolated.

The first redesign (checkpoint 3) found that creating an `Intl.DateTimeFormat` for every date was
the main rendering cost of the list; formatters are created once.

**Production bundle** (`dist/`, `node scripts/bundle-size.mjs`, `docs/evidence/bundle-size.json`):

| Part | Raw | Gzip |
|---|---|---|
| Firebase chunk (`firebase-*.js`, Auth + Firestore) | 547.1 kB | 161.8 kB |
| App entry (`index-*.js`, includes the icons used) | 168.0 kB | 55.6 kB |
| Vue and Vue Router chunk (`vue-*.js`) | 89.9 kB | 34.4 kB |
| Notifications (lazy, includes Firebase Messaging) | 28.2 kB | 8.6 kB |
| Lazy screens with their styles (editor, Sync center, Settings, 404) | 49.8 kB | 17.8 kB |
| Service worker `sw.js` | 69.6 kB | 21.7 kB |
| Main stylesheet | 47.5 kB | 10.0 kB |
| UI fonts (IBM Plex Sans variable 64.0 kB, Plex Mono 400 14.4 kB and 600 15.3 kB; Latin, WOFF2, precached) | 93.6 kB | — |

Before the first redesign the app JavaScript totalled 858.8 kB raw / 270.9 kB gzip and the CSS
6.6 kB / 2.4 kB. After it: 876.2 kB / 277.1 kB and 37.2 kB / 9.2 kB, with a 48.3 kB font. After
the second: 874.6 kB / 276.3 kB and 61.9 kB / 14.2 kB, with 93.6 kB of fonts.

## Known limitations and unresolved issues

- Sync runs only while a page is open, and on reopen. There is no closed-app sync.
- Full reconciliation reads every job, tombstones included, so reads grow with dataset size. It
  is sized for tens to a few hundred jobs (200 jobs: 105 ms per repeat reconciliation against the
  emulator).
- Notes merge as one field. Concurrent edits to different paragraphs are a same-field conflict.
- A value changed and changed back elsewhere looks unchanged to the field merge (documented).
- The merge runs in the owner's client. The rules enforce structure and ownership, not the merge
  policy.
- Not verified yet: Firefox and Safari (including iOS install and push), OS-level disconnection
  (airplane mode), a manual screen-reader pass. Install and push are verified on one Android
  phone in Chrome only.
- Two Firestore-emulator JVMs from early runs (before the fix in `scripts/firebase-emulators.mjs`)
  were still running when this was written; see `docs/progress.md`.
