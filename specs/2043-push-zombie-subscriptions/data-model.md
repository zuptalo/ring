# Phase 1 Data Model — Push zombie subscriptions & silent-wake strikes

No new IndexedDB object store and no new SQL table/migration. All state reuses existing
stores/columns; below are the shapes this feature reads and writes.

## Client (IndexedDB `settings` store — key/value)

| Key | Value | Read/Write | Notes |
|-----|-------|------------|-------|
| `push.lastWakeAt` | `number` (epoch ms) | existing; read by self-heal | stamped by `stampPushWake` on every SW push wake |
| `push.lastForceRotateAt` | `number` (epoch ms) | **new** | force-rotate retry-cap stamp (2h) |
| `push.wakeLedger` | `WakeLedgerEntry[]` (≤50) | **new** | content-free ring buffer |
| `diagnostics.pushReasonText` | `boolean` (default `false`) | **new** | opt-in production reason surfacing |

`WakeLedgerEntry` (content-free): `{ ts: number; kind: WakeKind; outcome: WakeOutcome; count: number }`
- `WakeKind`: `'call' | 'conn' | 'post' | 'post-activity' | 'version' | 'msg'`
- `WakeOutcome`: `'shown' | 'licensed-silent' | 'fallback'`

## Client (in-memory, per push event)

`WakeCtx` — owned by `runGuardedWake`, one per push event, never shared:
- `shown: boolean` — an OS notification was accepted this event (gates the reject/timeout fallback)
- `satisfied: boolean` — shown OR silence licensed via `mayEndWakeSilently` (gates the clean-resolve backstop)

`WakeResult` (returned by `runGuardedWake`): `{ shown, satisfied, fellBack }`.

## Server (PostgreSQL — existing tables only)

- `relay_queue(seq, recipient, sender, msg_id, payload, created_at)` — read-only here:
  - `OldestPendingForRecipient(recipient)` → `(oldestMs int64, count int)` via
    `min(created_at)` + `count(*)`.
  - `CountZombieFleet(staleAge)` → `count(DISTINCT recipient)` joined to `push_subscriptions`
    where `created_at < now() - staleAge`.
- `push_subscriptions(user_id, endpoint, …)` — read-only join target for the zombie count.

No column added; no state written server-side by this feature.

## Rotation predicate (pure)

`shouldRotateForQueueAge({ oldestQueuedAtMs, lastWakeAt, lastForceRotateAt, now })`:
1. `!oldestQueuedAtMs` → `false` (empty queue)
2. `now - oldestQueuedAtMs < 10min` → `false` (too fresh)
3. `lastWakeAt >= oldestQueuedAtMs` → `false` (a wake since it queued → push path alive)
4. else `now - lastForceRotateAt >= 2h`
