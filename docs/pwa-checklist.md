# PWA verification checklist

The brief asks for Lighthouse PWA audits. Chrome has deprecated and removed Lighthouse's PWA
category (spec reference R01). Lighthouse **13.5.0**, the version used here, reports Performance,
Accessibility, Best Practices, SEO and a new "Agentic browsing" category, and nothing called PWA.
Instead of downgrading tools to get an old "PWA 100" badge, PWA behavior is verified directly with
the checks below. Lighthouse results are in `docs/evidence.md`.

Status key: **Pass** (verified, with the method named), **Not run**, **Blocked** (needs access
not yet provided).

| Check | Status | How it was verified |
|---|---|---|
| Web app manifest: `id`, `name`, `short_name`, `description`, `start_url` `/jobs`, `scope` `/`, `display` `standalone`, theme/background colors | Pass | `tests/e2e/pwa.spec.ts` reads the parsed manifest through Chrome DevTools Protocol `Page.getAppManifest`: no errors, fields match |
| Icons 192 and 512 (any) plus 512 maskable; maskable art within the safe zone | Pass | Same test fetches every icon. Icons inspected visually; maskable artwork reaches about 0.30 of the size from the center, inside the 0.40 safe zone |
| Chrome's installability criteria | Pass | `Page.getInstallabilityErrors` returns no errors other than `in-incognito`, which only means the automated profile is incognito-like |
| Secure context | Pass (local) | Served from `127.0.0.1` (a secure context). HTTPS deployment: **Blocked** |
| One service worker, controlling the page | Pass | e2e tests wait for `navigator.serviceWorker.controller` before offline steps; only `/sw.js` is registered |
| Precache covers lazy routes (editor, Sync center, Settings) | Pass | T37: those screens open offline without having been visited; build output lists 26 precache entries including all lazy chunks and the UI font |
| Offline deep links (refresh `/jobs/{id}` offline) | Pass | T35 |
| Offline-ready message only after caching and control | Pass | The message requires both the worker's `installed` event and page control; e2e tests wait for it |
| No caching of Firebase/API traffic in the worker | Pass | `src/sw.ts` registers only precache and navigation routes; Firestore requests fail offline (T41 shows the honest state) |
| Prompt-based update; waits for unsaved input; one reload; queue preserved; old precache entries removed | Pass | T38 (build A to build B on the same origin) |
| Database upgrade does not delete data | Pass (fixture) | T39 with a fixture v2 schema; no production v2 exists yet |
| User-triggered install button when the browser offers it, honest otherwise | Pass (code); install done on Android Chrome (T42) | Settings shows Install only after `beforeinstallprompt` and reports the user's actual choice; otherwise platform instructions |
| Installed standalone launch with correct name, icon and start route (T42) | Pass (partial) | Owner check on 2026-10-31, Android Chrome, live site: installs and opens standalone from the home-screen icon. Name, icon and start route not recorded separately |
| Push opt-in from a user action; FCM through the same worker | Pass (code), delivery **Blocked** | Settings → Enable notifications; `getMessaging` in `src/sw.ts`; FID registration in `src/notifications.ts` |
| Real push foreground / background / click (T43–T45) | Blocked | Needs a real Firebase project, VAPID key and an opted-in device. The page-side click routing is tested (T45 partial) |
| Unsupported/unconfigured push leaves the app usable (T46) | Pass | `tests/e2e/session.spec.ts` |
| Accessibility of the main screens, light and dark | Pass (automated scope) | axe (WCAG 2.0/2.1 A/AA): no serious or critical violations on 7 screens in each color scheme. A manual screen-reader pass has not been run |

## Browser support notes

- **Chrome / Edge (desktop, Android):** the baseline. Install prompt, standalone display, web push.
- **Safari (iOS/iPadOS):** install via Share → Add to Home Screen. Web push only works for
  installed web apps on recent iOS versions. **Not tested.**
- **Firefox desktop:** no install support; service worker and push work. **Not tested.**
