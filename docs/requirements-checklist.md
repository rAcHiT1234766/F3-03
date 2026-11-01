# Requirement-to-evidence checklist

Spec §30 acceptance checklist and §25 deliverables, with the current status and where the proof
is. "Done" means verified by an executed check; external items stay **Blocked** until actually
completed.

## Final acceptance checklist (§30)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Vue 3 + Vite app builds reproducibly from the lockfile | Done (local) | `package-lock.json`; `npm run check`. A clean-checkout `npm ci` rebuild in CI is configured but not run |
| 2 | Dexie stores jobs and durable sync commands | Done | `src/db.ts`, `src/jobs.ts`; T01, T03 |
| 3 | Create/edit/delete and queue insertion are atomic | Done | T01, T02 |
| 4 | Prepared app and data usable after offline reload/reopen | Done | T35, T03, T06 (Chromium); airplane mode on the installed Android app, 2026-11-01 |
| 5 | Workbox caches required routes/assets, not account APIs | Done | T37; `src/sw.ts` (precache + navigation only) |
| 6 | Manifest and installation flow work on a recorded target | Done (Android Chrome) | Manifest and installability check pass; installed and launched standalone on an Android phone in Chrome from the live site (T42, 2026-10-31) |
| 7 | Outbox delivers actual changes to Firebase | Done | T07, S suite (emulator). Live project, 2026-11-01: the phone's last upload (11:05 in its Sync center) matches the job's `updatedAt` and revision 6 in the Firestore console |
| 8 | Retries reuse the same immutable opId/payload | Done | T09, T16, T17 |
| 9 | Atomic receipts prevent duplicate canonical effects | Done | T08, T09, T21, T48; rules link job ↔ receipt |
| 10 | Acknowledgement cannot overwrite a newer local edit | Done | T11, T24 |
| 11 | Pull cannot regress a confirmed revision or erase pending work | Done | T23, T24; "pull never deletes" unit test |
| 12 | Per-job ordering and multiple tabs handled intentionally | Done | T14, T15, T20, T21 |
| 13 | Record-level LWW demonstrated; field-level merge implemented | Done | T25 (both layers), T26–T28 |
| 14 | Same-field outcomes documented and visible | Done | T27; Sync center conflict list; `docs/sync-protocol.md` |
| 15 | Tombstones prevent resurrection | Done | T30, T31; rules tombstone test |
| 16 | Auth and local/remote account boundaries tested | Done | T33 (rules, sync, local, browser), T34, T47 |
| 17 | Permanent and auth errors actionable without deleting work | Done | T18, T19 (simulated), T15; Sync center discard only after a server receipt check |
| 18 | Worker and database updates preserve jobs and pending operations | Done / partial | T38 (worker); T39 uses a fixture schema |
| 19 | Real permission-based push delivery and click navigation | Done (Android Chrome) | T43–T45 on the installed phone app against the live project, 2026-11-01 |
| 20 | Required tests have actual results, blocked/not-run identified | Done | `docs/test-matrix.md` |
| 21 | Current Lighthouse plus an explicit PWA checklist | Done (local) | `docs/evidence.md`, `docs/pwa-checklist.md`; deployed run Blocked |
| 22 | Measurements identify device, data, method, environment, commit | Done (emulator) | `docs/evidence.md`, `docs/evidence/measurements.json` |
| 23 | Demo, GitHub, architecture, protocol/data docs, setup | Partial | Docs and setup done (`README.md`, `docs/`). Demo URL live; GitHub repository not created yet |
| 24 | Ten-minute presentation and authentic reflection | Partial | Outline and notes: `docs/presentation.md`. Reflection needs the intern's own answers (`docs/reflection.md`) |
| 25 | Submission folder and reviewer access verified | Blocked | Index prepared: `docs/submission-index.md` |

## Deliverables (§25)

| Deliverable | Status | Location |
|---|---|---|
| Working demo (URL or recording) | Partial | Live at https://fe-03-56215.web.app; the backup screen recording is not made yet |
| GitHub repository | Blocked | Local Git history only; no remote was authorized |
| Architecture | Done | `docs/architecture.md` |
| Data/API documentation | Done | `docs/sync-protocol.md` |
| Test results | Done (local) | `docs/test-matrix.md`, `docs/evidence.md` |
| Measurements | Done (emulator) | `docs/evidence.md` |
| PWA evidence | Partial | `docs/pwa-checklist.md`, Lighthouse reports; install done on Android Chrome (T42); update on the deployed origin Not run |
| Push evidence | Done (Android Chrome) | `docs/evidence.md` § Real push |
| Presentation | Draft | `docs/presentation.md` |
| Reflection | Template only | `docs/reflection.md` |
