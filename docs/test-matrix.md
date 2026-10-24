# Test matrix T01–T48

Build/commit: see `docs/evidence.md`. Environment: Windows 11, Node 24.22.1, Chromium 156
(Playwright 1.64.1), Firebase emulators (Auth; Firestore 1.22.0) for project `demo-fieldlog`.

Status values: **Pass** (executed and met the expected result), **Pass (partial)** (the named part
was executed; the rest is listed), **Not run**, **Blocked** (needs access not yet provided).
Never Pass without an executed test.

Layers: **U** = `tests/unit` (Vitest, fake-indexeddb, injected fake server); **R** =
`tests/emulator/rules.test.ts`; **S** = `tests/emulator/sync.test.ts` (real client SDK, two
independent app instances); **B** = `tests/e2e` (Playwright Chromium, production build, emulator
mode).

| ID | Scenario | Status | Evidence (test) | Notes |
|---|---|---|---|---|
| T01 | Atomic create | Pass | U `jobs.test.ts` "T01"; U `editor.test.ts` | Job and create operation stored together |
| T02 | Failed local transaction | Pass | U `jobs.test.ts` "T02" ×2 | Queue-insert failure and job-insert failure each leave nothing behind; UI error in `editor.test.ts` |
| T03 | Edit persistence | Pass | U "T03" (close/reopen DB); B `offline.spec.ts` "T35/T03" | Browser: offline edit survives closing and reopening the page |
| T04 | No-op save | Pass | U "T04" | Unchanged, and whitespace-only changes, create no operation |
| T05 | Stale form | Pass | U "T05" | Only edited fields are sent; latest unrelated field kept |
| T06 | Local delete | Pass | U "T06"; B "T06" | Hidden after reload; tombstone synced (revision 2) |
| T07 | First remote create | Pass | S "T07"; U "T07" | Revision 1, matching receipt, request equals queued payload, real server time |
| T08 | Duplicate delivery | Pass | S "T08"; U "T08" | One revision, one receipt; duplicate local ack harmless |
| T09 | Lost response | Pass | S "T09"; U "T09"; B `tabs.spec.ts` "T21" | Retry with same opId finds the receipt; no second mutation |
| T10 | Reused ID, different body | Pass | S "T10"; U "T10" | `receipt_mismatch`, blocked; canonical data unchanged |
| T11 | Mid-flight edit | Pass | U "T11" ×2 | Edit saved during an in-flight request stays visible and queued after the ack |
| T12 | Failed local ack | Pass | U "T12" | Row becomes `local_ack_failed`; retry acks without a second effect |
| T13 | Crash with sending state | Pass | U "T13"; B "T21" | Recovery under the lock retries the same opId |
| T14 | Sequential operations | Pass | U "T14" | create → patch → patch → delete sent in order; final tombstone revision 4 |
| T15 | Blocked predecessor | Pass | U "T15" | Later same-job patch held; another job synced |
| T16 | Transient outage | Pass | U "T16" | Persisted backoff 2 s, 4 s … capped at 60 s; nothing sent before it is due |
| T17 | Manual retry | Pass | U "T17" | One coalesced attempt, same payload |
| T18 | Permission denial | Pass | U "T18"; S "T18"; R rules tests | Blocked, not retried automatically; rules denial reaches the client as `permission-denied` |
| T19 | Expired auth | Pass (partial) | U "T19" | Simulated `unauthenticated` response: delivery pauses, local edits continue, sign-in resumes. A real token expiry was not exercised |
| T20 | Two tabs | Pass | U "T20"; B "T20" | Simultaneous Sync now in two tabs: 3 operations → 3 receipts |
| T21 | Lock-holder close | Pass | B "T21" | Commit reached the server, reply withheld, tab closed; the other tab finished with exactly one receipt |
| T22 | Remote pull | Pass | U "T22/T23"; S (pair setup); B "T35/T03" (second context) | |
| T23 | Pull with local patch | Pass | U "T22/T23" | Local title kept and pending; remote status received |
| T24 | Out-of-order responses | Pass | U "T24" | Shadow stays at revision 6 after a late revision-5 receipt; op acknowledged |
| T25 | Record LWW limitation | Pass | S "T25"; U record-LWW tests | Stale full record overwrote the unrelated status, as expected for the staged baseline |
| T26 | Disjoint merge | Pass | S "T26" both orders; U both orders | Both edits survive; revision 3 |
| T27 | Same-field merge | Pass | S "T27" both orders; U "T27" | Last server commit wins; notice recorded on the device whose value won |
| T28 | Identical merge | Pass | S "T28"; U | No notice, no extra revision (`noop` receipt) |
| T29 | Clock skew | Pass | S "T29"; U | A year-ahead client time does not win |
| T30 | Delete then update | Pass | S "T30"; U "T30" | `rejected_deleted`; no resurrection; edits kept; recovery creates a new job |
| T31 | Update then delete | Pass | S "T31"; U "T31" | Final state deleted on both devices |
| T32 | Missing remote record | Pass | S "T32"; U resolver | Blocked `missing_job`; no implicit create |
| T33 | Account isolation | Pass | R "account isolation"; S "T33"; U (local); B `session.spec.ts` | Rules deny other accounts; a second account on the same browser sees none of the first's data |
| T34 | Late account callback | Pass | U "T34" | Pending response for A cannot touch B; no new A work after the switch |
| T35 | Offline prepared reload | Pass | B "T35/T03" | DevTools-style offline via `context.setOffline`. An OS-level disconnect was not run |
| T36 | Offline first-ever visit | Pass | B "T36" | Fails with `ERR_INTERNET_DISCONNECTED`, as documented; no false offline-ready claim |
| T37 | Offline unvisited route | Pass | B "T37" | Sync center, Settings and the editor open offline without prior visits |
| T38 | App update with queue | Pass | B `update.spec.ts` | Waits for an unsaved form; one reload; version e2e-a → e2e-b; 2 queued changes kept and delivered once; old precache entry removed |
| T39 | Database migration | Pass (partial) | U "T39" | A fixture v2 upgrade keeps payloads, order and owner. There is no production v2 yet; an IndexedDB upgrade blocked by an old open tab was not exercised in a browser |
| T40 | Storage failure | Pass | U "T40"; U `editor.test.ts` "T40" | Simulated `QuotaExceededError`: nothing stored, form input kept, clear message. A real quota exhaustion was not run |
| T41 | Captive/server outage | Pass | B "T41" | Browser online, Firestore unreachable: "Cannot reach the server — retrying"; local work continues, then drains |
| T42 | Installation | Not run | (B `pwa.spec.ts` installability check passes) | Needs an interactive install on Chrome/Edge |
| T43 | Real push foreground | Blocked | — | Needs a Firebase project, VAPID key and an opted-in device |
| T44 | Real push background | Blocked | — | As T43 |
| T45 | Notification click | Pass (partial) | B `pwa.spec.ts` "T45 (page side only)" | Worker → page message opens only a validated job route; a real notification click is Blocked |
| T46 | Push denied/unsupported | Pass (partial) | B `session.spec.ts` "T46" | Unsupported/unconfigured: the app stays usable and says why. Denied permission needs a real config: Not run |
| T47 | Sign-out with queue | Pass | B `session.spec.ts` "T47/T33" | Explicit choice; work kept and returned only to the same account, then synced |
| T48 | Network flapping | Pass (partial) | U "T48" | Random transport and lost-response faults across 18 operations: each applied exactly once, queue drained. Real browser connectivity toggling was not run |

## Additional checks

- Property-style resolver test: 300 random cases. Unrelated fields are unchanged, inputs are not
  mutated, and the revision changes only on a real change.
- Rules: 21 tests, including shape and limits, server timestamps, revision +1, immutable receipts,
  no physical delete, tombstone finality, the noop receipt model, and device registrations.
- Accessibility: axe on 7 screens in light and dark schemes, with no serious or critical violations.
- Mutation checks (manual, not part of CI): four deliberate breaks of the acknowledgement and
  ordering invariants each made the unit suite fail; reverting the contention fix made the
  emulator test fail.
