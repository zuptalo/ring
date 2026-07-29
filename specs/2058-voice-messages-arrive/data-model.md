# Phase 1 Data Model: spec 2058

Only one existing entity changes, and only by one optional field. No new object store, no new
server table, no wire-format change.

## Changed entity: `Message` (`src/db/types.ts:322-401`)

### New fields

| Field | Type | Meaning |
|---|---|---|
| `dlFailedAt?` | `number` | Epoch ms of the most recent **failed** attachment fetch for this message. Absent = never failed. Cleared back to `undefined` when a fetch succeeds. Drives the bubble's failed state (FR-008). |

Only **one** field is persisted. The auto-retry counter is deliberately **not** stored — see below.

### Session-scoped state (NOT persisted)

| State | Where | Meaning |
|---|---|---|
| auto-attempt count | in-memory `Map<messageId, number>`, module-scoped | Counts **automatic** on-view fetch attempts, capped at 3 per message (FR-006). Reset implicitly when the app restarts, because the map dies with the session. A manual tap neither reads nor increments it. |

**Why this one is not a `Message` field**: persisting it would let a message that exhausted its
three attempts during a single offline session become permanently manual-only, directly
contradicting FR-013 / SC-004 ("stranded messages recover on the next open, no re-send"). The
counter's job is to stop a tight loop *within* a session, which a session-scoped map does exactly.

### Why this is local-only

`dlFailedAt` is device-local receive-side bookkeeping. It is never sent, never synced through
own-data sync, and never read from the server (see the spec's Zero-Knowledge Impact section).

### Why no `DB_VERSION` bump

Constitution V mandates a bump when *adding or altering an object store*. This is one optional field
on records in the existing `messages` store; IndexedDB records carry no schema, so old rows read
`undefined` — the correct "never failed" default. This matches how `failReason`, `jobAttempts`,
`mediaCleared` and `posterData` were each added. Verified against `src/db/idb.ts` (`DB_VERSION = 12`,
`:46`): every branch of the upgrade path is a `createObjectStore` or index creation, none of which
this touches.

### Existing fields this feature reads (unchanged)

| Field | Role here |
|---|---|
| `mediaId?` | Absent + `pendingMedia` present = the bytes are not local. The condition the whole feature keys on. |
| `pendingMedia?` (`MediaRef`) | The sender's reference used to fetch the bytes. |
| `kind` | Selects the placeholder: `voice` vs round note vs the existing photo/video/audio/file blocks. |
| `videoNote?` | Distinguishes a round note from a normal video. |
| `durationSec?` | Shown on the voice placeholder (FR-002). |
| `mediaSize?` | Feeds the existing `dlSizeLabel` progress counter. |
| `mediaCleared?` | Mutually exclusive with the pending state — keeps its own presentation (FR-012). |
| `outgoing`, `deleted`, `expiresAt` | Guards: recovery only applies to incoming, undeleted, unexpired messages. |

## Attachment state machine (per message)

```
                    bytes fetched OK
   ┌──────────────┐ ───────────────────► ┌─────────────┐
   │   PENDING    │                      │  RESOLVED   │  mediaId set → the real player renders
   │ pendingMedia │ ◄─────────┐          └─────────────┘
   │  no mediaId  │           │ retry            │
   └──────┬───────┘           │                  │ user frees space
          │ fetch fails       │                  ▼
          ▼                   │          ┌─────────────┐
   ┌──────────────┐           │          │   CLEARED   │  mediaCleared, its own presentation
   │    FAILED    │ ──────────┘          └─────────────┘
   │ dlFailedAt   │
   └──────────────┘
```

- **PENDING → RESOLVED**: `mediaId` set, `pendingMedia` and `dlFailedAt` cleared.
- **PENDING → FAILED**: `dlFailedAt` stamped; `pendingMedia` is **retained** so a retry is possible.
- **FAILED → PENDING/RESOLVED**: any retry clears `dlFailedAt` on success; a further failure
  re-stamps it.
- **CLEARED** is reached only from RESOLVED, by the user freeing space. It is disjoint from PENDING
  (`mediaCleared(m)` at `ChatDetailPage.vue:2012` already requires `!m.pendingMedia`), which is what
  keeps FR-012 true without extra work.

## Invariants

- **INV-1**: A message is in exactly one of RESOLVED / PENDING / FAILED / CLEARED. No bubble may
  render empty in any of them (SC-001).
- **INV-2**: `dlFailedAt` set implies `pendingMedia` set — a failed fetch never discards the
  reference, or the message would become unrecoverable.
- **INV-3**: The attempt counter bounds only the automatic path. A manual tap always attempts,
  regardless of its value, and never increments it (FR-006 vs FR-003).
- **INV-4**: The attempt counter never persists — a new session always grants a message a fresh
  three automatic attempts, which is what keeps FR-013 true for messages stranded before this fix.
- **INV-5**: `dlFailedAt` never leaves the device.
