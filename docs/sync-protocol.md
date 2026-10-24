# Sync protocol and data contracts

FieldLog has no custom REST API. Synchronization is an internal contract over the Firebase SDK:
the paths, documents and transaction rules below.

## Firestore paths

| Path | Document | Who can write |
|---|---|---|
| `users/{uid}/jobs/{jobId}` | Canonical job or tombstone (`RemoteJob`) | Owner, only together with a matching new receipt |
| `users/{uid}/operations/{opId}` | Immutable receipt | Owner, create only |
| `users/{uid}/devices/{deviceId}` | `{ deviceId, fid, enabled, userAgent?, updatedAt }` | Owner |

## Job fields

| Field | Type | Rule |
|---|---|---|
| `title` | string | 1–120 characters, trimmed |
| `customerName` | string | 1–120, trimmed |
| `siteAddress` | string | 0–300, trimmed |
| `description` | string | 0–2000, kept as typed |
| `notes` | string | 0–4000, kept as typed |
| `status` | `scheduled` \| `in_progress` \| `completed` | |
| `priority` | `low` \| `normal` \| `high` | |
| `dueDate` | `YYYY-MM-DD` \| `null` | A real Gregorian date (client); format only (rules). A date, never a timestamp. |

## Canonical job (`users/{uid}/jobs/{jobId}`)

```ts
{ schemaVersion: 1, id, ownerId, fields: JobFields, deleted: boolean,
  revision: number,      // 1, 2, 3… — the only ordering authority for this job
  lastOpId: string,      // the receipt that produced this revision
  updatedAt: Timestamp } // request.time of the commit; display only
```

`id`, `ownerId` and `schemaVersion` never change. A delete sets `deleted: true` and keeps the
fields. Tombstones are never physically deleted.

## Outbox operation (local)

```ts
type OperationPayload = {          // immutable once queued; reused on every retry
  protocolVersion: 1, opId, ownerId, deviceId, jobId,
  kind: 'create' | 'patch' | 'delete',
  baseRevision: number | null,     // diagnostic only
  baseValues: Partial<JobFields>,  // patch: the values the editor started from
  patch: Partial<JobFields>,       // patch: only the fields the user changed
  after: JobFields,                // full intended state (used by the staged LWW resolver)
  clientCreatedAt: number }        // display only; never decides a conflict
type OutboxRow = { sequence /* IndexedDB auto-increment */, payload,
  state: 'pending' | 'sending' | 'retry_wait' | 'blocked',
  attempts, nextAttemptAt, lastErrorCode, lastErrorMessage }
```

## Receipt (`users/{uid}/operations/{opId}`)

```ts
{ protocolVersion: 1, opId, ownerId, deviceId, jobId, kind,
  outcome: 'applied' | 'noop' | 'rejected_deleted',
  request: OperationPayload,      // the full immutable request, for identity checks
  result: RemoteJob,              // canonical job after processing
  conflicts: FieldConflict[],     // { field, base, incoming, remote, chosen }
  receivedAt: Timestamp }
```

Receipts are kept for the life of the project. Deleting them while an old device can still retry
would break deduplication.

## Ordered protocol

1. **Save.** One Dexie transaction validates, updates the visible job, and appends the operation
   with a new UUID `opId`. The UI shows "Saved on this device". Sync is requested afterwards;
   nothing waits for the network.
2. **Select.** With the account's Web Lock held, the engine takes the earliest due operation that
   has no earlier unacknowledged operation for the same job, and marks it `sending`.
3. **Transaction** (`applyOperation`, Firestore `runTransaction`, all reads before writes, no side
   effects outside Firestore):
   1. Validate the payload and owner. Build paths from the signed-in UID only.
   2. Read `operations/{opId}`. If it exists and its `request` equals this payload, change nothing
      and return. If it exists with a different request, raise a protocol error.
   3. Read the job and resolve the operation (see below).
   4. If the content changes, write the job with `revision + 1`, `lastOpId = opId`, and
      `updatedAt = serverTimestamp()`.
   5. Write the receipt in the same transaction.
4. **Confirm.** Read the receipt back with `getDocFromServer`, so timestamps and values are the
   committed ones. If that read fails, the outcome is uncertain: the operation stays queued, and
   the next attempt finds the receipt.
5. **Acknowledge.** One Dexie transaction removes **only** that operation's row, accepts
   `receipt.result` as the shadow **only if its revision is newer**, stores conflict notices with
   stable IDs (`{opId}:{field}`), and rebuilds the view from the shadow plus every operation still
   queued for the job, in sequence.
6. **Reconcile.** Server-backed reads of all jobs replace older shadows and rebuild views over
   pending operations. A job missing from a read is never deleted locally.

Delivery is **at least once**. The receipt makes the effect happen **once** while receipts are
kept.

## Resolution rules

| Situation | Result |
|---|---|
| Create, no job yet | `applied`, revision 1 |
| Create, ID already used (live or tombstone) | Blocked error, no receipt |
| Patch or delete, no job | Blocked `missing_job`, never an implicit create |
| Delete, live job | `applied`, tombstone keeps the fields |
| Delete, already deleted | `noop` |
| Patch, deleted job | `rejected_deleted` (no change) |
| Patch, field not in patch | Keep the server value |
| Patch, incoming = base | Keep the server value |
| Patch, server = base | Apply incoming |
| Patch, server = incoming | Keep, no conflict |
| Patch, all three differ | Apply incoming (last server commit wins) and record a conflict |
| Nothing actually changes | `noop`, no revision bump |

The staged record-LWW resolver instead replaces all fields with `after`. It is used only in tests,
to show that it can lose an unrelated concurrent change.

## Worked examples

**Duplicate delivery (lost response).** Device A sends create `op-1`. The server commits revision
1 and receipt `op-1`, but the reply is lost. A marks `op-1` `retry_wait` and later sends it again.
The transaction finds receipt `op-1` with an identical request, writes nothing, and returns it. A
acknowledges it. The job is still at revision 1, with one receipt. (Tests: T09 unit and emulator;
T21 browser.)

**Mid-flight edit.** A queues `op-A` (status → completed) and it is sent. While it is in flight,
the user adds notes, queued as `op-B`. When `op-A`'s receipt arrives, acknowledgement removes only
`op-A`, sets the shadow to revision 2 (status completed), and rebuilds the view as shadow plus
`op-B`. The notes stay visible and pending until `op-B` is delivered. (T11.)

**Different fields.** Both devices start at revision 1. A changes `status`, B changes `notes`. A
commits revision 2. B's patch has `notes: base '' → incoming 'Valve OK'` against server `''`, so it
applies and makes revision 3 with both changes. In the reverse order the result is the same.
(T26.)

**Same field.** A sets `notes` to "replace pump"; B sets it to "repair pump", both from `''`. A
commits first. B's patch sees base `''`, incoming "repair pump", server "replace pump": all three
differ. "repair pump" wins as the later commit, and B records the notice
`{ field: 'notes', incoming: 'repair pump', remote: 'replace pump', chosen: 'repair pump' }`.
After reconciling, A shows "repair pump". "Use this value" creates a new patch with a new opId.
(T27.)

**Delete then stale update.** B deletes, making revision 2, a tombstone. A, offline, edited notes
and then status. A reconciles and sees the tombstone, so its view becomes deleted. Its first patch
returns `rejected_deleted`. Acknowledgement records a "deleted on another device" notice holding
A's intended values, and holds A's later patch as `blocked / job_deleted`. Recovery creates a new
job (new UUID) from those values; the tombstone stays. (T30.)

**Update then delete.** A updates and commits revision 2. B, with a stale view, deletes: the
tombstone becomes revision 3 with A's fields. Final state: deleted. (T31.)

## Rules model (summary)

- Job create: valid shape, revision 1, not deleted, and `getAfter(receipt[lastOpId])` is a new
  `applied` receipt for this job with the same revision.
- Job update: the existing job is not deleted, revision = old + 1, `lastOpId` is new, fields are
  unchanged when deleting, and the same receipt link.
- Receipt create: valid shape, `receivedAt == request.time`. An `applied` receipt must match the
  job as written (revision, fields, deleted, lastOpId). A `noop` or `rejected_deleted` receipt must
  reference an existing job left unchanged by this write; `rejected_deleted` requires a tombstone.
- Receipts can never be updated or deleted. Jobs can never be physically deleted.
- Under contention, Firestore can report the losing commit as `permission-denied`, because the
  rules saw the other device's new revision. `applyOperation` re-runs such a transaction up to 3
  times; a genuine denial repeats and is then reported (see `docs/decisions.md`).

The merge itself runs in the authenticated owner's client. A modified client could choose
different values within its own allowed schema. Moving conflict decisions to a trusted endpoint
is a future hardening step.
