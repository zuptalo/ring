# Data Model: Messages store on push so the app opens warm (spec 1032)

No new object stores; no `DB_VERSION` bump; no server schema change. The feature reuses
existing entities and adds two settings-store records plus one internal flag.

## Entities

### Queued frame (server, existing — unchanged)

A sealed envelope in `relay_queue` (recipient, sender, msg_id, payload). Deleted only by
an authenticated ack (`WS ack` or `POST /v1/relay/ack`); swept after 35 days. The SW's
`/relay/pending` fetch returns the newest 50 and (already today) earns delivered receipts.

### Message row (`messages` store, existing — written by a new writer)

Same shape the page writes in `receiveIncomingInner`: keyed by the sender's `remoteId`
(idempotent overwrite), with `pendingMedia: MediaRef` for media-by-reference (bytes are
never downloaded in the SW; the page backfills). New: the SW may now be the first writer,
inside the atomic transaction.

### Chat summary (`chats` store, existing — read-modify-write)

`unread` (+1 per applied frame), `unreadMentions` (per existing mention rules),
`lastMessage`, `lastKind`, `lastMessageTime`. The RMW rides inside the atomic transaction,
under `ring:inbound`, so it can never race the page or double-apply. No `isChatActive`
check in the SW (a live page was already deferred to by the gate).

### Ratchet session (`sessions` store, existing — new staged write path)

`messaging.ts` gains a staged open: it returns the advanced `SerializedSession` (and any
session-meta effects) instead of persisting internally, so the SW commits it atomically
with the message row. Format is UNCHANGED — and must not change in the same release
(SW/page version-skew guard, research.md D9).

### Exactly-once ledger (`settings` store, existing `inboundSeenIds`)

The arbiter between the two delivery paths. The SW marks a frame seen inside the atomic
transaction; the page's `receiveIncoming` skips seen frames and re-acks. Existing cap and
pruning behavior unchanged.

## New settings-store records

| Key | Type | Purpose |
|-----|------|---------|
| `sw.fullPersist` | boolean, default absent/off | Internal rollout flag, read per wake in the SW gate. Not in the Settings UI. Set via dev tooling (`window.__ringTest` / direct idb) during the soak. |
| *(none else)* | | Deferred frames keep using the existing `swNotifiedIds` / `swShownSummary` records; applied frames need no ledger beyond `inboundSeenIds` because they are acked. |

## State transitions (one frame's lifecycle, flag on)

```
                        ┌────────────────────────────────────────────────┐
                        │ queued on server (≤35 days)                    │
                        └───────────────┬────────────────────────────────┘
              push wake, gate passes    │        gate fails (locked, no locks API,
                        ┌───────────────┤        page claimed, flag off)
                        ▼               │                    ▼
              eligible? (classifier)    │         preview-only notification
               ┌────────┴────────┐      │         (frame stays queued → page
               ▼                 ▼      │          drains + acks on open)
        staged decrypt       DEFER: preview-only
        under session lock   notification, no ack
               │
               ▼
        ATOMIC COMMIT: session + message + chat RMW + seen-ledger
               │  (abort/kill before commit → frame still queued, clean redelivery)
               ▼
        notification shown from committed data
               │
               ▼
        POST /v1/relay/ack  ──── kill before ack → redelivery hits ledger,
               │                 re-ack only, no re-apply
               ▼
        deleted on server; app opens warm
```

## Validation rules

- A frame is applied at most once across both paths (ledger inside the transaction).
- `unread` increments exactly once per applied frame (same transaction).
- An acked frame is always durably committed first (ack is the wake's last step).
- A deferred or failed frame is byte-for-byte today's behavior (no ack, no writes beyond
  the existing preview bookkeeping).
- Locked posture: no decrypt, no writes, generic notification (gate).
