# Ten-minute presentation: outline, speaker notes, demo plan

Spec §26. A draft for the intern to rehearse and adapt. Speaker notes describe the project's actual
behavior. Personal statements ("I learned…") belong in the intern's own words; see
`docs/reflection.md`.

## Demo setup (before the session)

- **Preferred:** a deployed build with a real demo account, two browsers (a laptop and a phone, or
  two Chrome profiles), and notifications enabled on one of them. (Blocked until a Firebase project
  exists.)
- **Fallback that works today:** emulator mode on one machine:
  `npm run emulators`, `npm run build:e2e`, `node tests/e2e/static-server.mjs`. Use two Chrome
  profiles at `http://127.0.0.1:4173`, signed in as the same emulator account. Use DevTools →
  Network → Offline on profile A.
- Seed the same fictional jobs every time: "Boiler inspection — Acme Lettings" and
  "Leak check — Dock 4".
- Record a backup video of the whole demo in case the room's network or push delivery fails.

## Run of show

| Time | Segment | Show / say |
|---|---|---|
| 0:00–0:45 | Problem and user | A technician in a basement plant room with no signal still needs to update the job. Losing the update, or applying it twice, is worse than being slow. |
| 0:45–1:45 | Scope and architecture | Diagram from `docs/architecture.md`: Vue screens read only Dexie; one transaction writes the job plus its outbox operation; the sync engine moves the outbox to Firestore; the Workbox worker serves the app files. Firestore runs memory-cache only, so the outbox is the one queue. |
| 1:45–2:45 | Local-first Save | Edit notes offline: "Saved on this device" appears at once, the badge shows pending, and the Sync center lists "1 change waiting". Measured: 16 ms median from Save to the details screen. |
| 2:45–5:15 | Offline → online demo | Profile A offline: reload a job's page (served from the precache), edit status, close the tab, reopen it, the edit is still there. Go online, Sync now, "No changes waiting". Profile B: Sync now and see the change. Optionally open the emulator UI to show revision 2 and its receipt. |
| 5:15–7:00 | Reliability and conflicts | (1) Lost response: the receipt makes the retry harmless (T09/T21: commit reached the server, reply lost, tab closed; the other tab finished with one receipt). (2) Different fields: A changes status, B changes notes, both survive. (3) Same field: both change notes, the last server commit wins, and the Sync center shows the other value with "Use this value". |
| 7:00–7:45 | Install and push | Install from Chrome and launch standalone. Push: if a real project is available, send with `scripts/send-test-push.mjs` and click the notification to open the job. Otherwise say plainly that it is blocked and show the opt-in code path. |
| 7:45–9:15 | Evidence | Test matrix (unit 80, rules 21, sync protocol 17, browser 14), Lighthouse 13.5 table and why there is no "PWA score" any more, the PWA checklist, measurements with their method. |
| 9:15–10:00 | Limits and next steps | Foreground/reopen sync only; full reconciliation sized for hundreds of jobs; notes are one field; no attachments; the merge runs in the client. Next: a trusted merge endpoint, incremental pull, attachments. |

## One difficult bug, explained deeply (pick one)

**A. Contention looked like a permanent denial.** Two devices edited the same job at the same
moment, and one operation ended up "needs attention" with `permission-denied`. The cause:
Firestore evaluated the security rules for the losing commit against the revision the other
device had just written, so the rule "revision must be the old revision + 1" failed. The failure
came back as a permission error, not a retryable conflict. The fix re-runs the transaction up to
three times on that error. It is safe because a failed commit applies nothing, the receipt check
makes re-runs idempotent, and a real denial repeats every time. Show the emulator test that fails
without the fix and passes with it.

**B. The update never reloaded the page.** A user who installed the app and received an update
in the same page session clicked "Update now": the new worker activated, but the page kept
running old code. workbox-window decides "is this an update?" once, at registration, and the page
had first loaded uncontrolled. The fix: the app reloads exactly once on the controller change that
follows the user's own Update now, and suppresses the plugin's reload. Show the T38 test.

## Likely questions

- *Why not just Firestore offline persistence?* Its queue is opaque: no visible per-change state,
  no idempotent receipts, no explicit conflict policy. The assignment asks for an explicit Dexie
  queue.
- *Exactly once?* No. Delivery is at least once; the receipt makes the effect happen once, as long
  as receipts are kept.
- *Why server-commit LWW and not the latest edit time?* Device clocks can be wrong. The per-job
  revision is an order everyone agrees on (T29 shows a year-ahead clock does not win).
