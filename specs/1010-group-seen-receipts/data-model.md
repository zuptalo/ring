# Phase 1 Data Model: Group "Seen" Receipts

Extends existing models; adds one server table. No new client object store.

## Changed: MessageStatus (client enum)

`compressing | pending | sent | delivered | read | failed`
→ `compressing | pending | sent | delivered | **seen** | failed`

- `STATUS_ORDER` rank unchanged in position (seen replaces read at rank 3,
  monotonic). The wire status string and the displayed label both become "seen".

## Changed: Message (client, IndexedDB `messages` store)

| Field | Before | After |
|---|---|---|
| `status` | `…|'read'|…` | `…|'seen'|…` |
| `readAt?` | epoch ms | **`seenAt?`** epoch ms |
| `receipts[].readAt?` | epoch ms | **`receipts[].seenAt?`** epoch ms |

- `receipts?: Receipt[]` (per-member, sender's copy only) becomes
  `{ contactId, deliveredAt?, seenAt?, downloadedAt? }`. Still embedded on the row
  (no separate store). `downloadedAt` unchanged.
- **Migration (`DB_VERSION 5 → 6`)**: forward transform over every `messages` row
  — `status 'read'→'seen'`, `readAt→seenAt`, `receipts[].readAt→seenAt`. Preserve
  all else; no status regression.

## Derived: GroupProgress (client, computed — not stored)

From a sent group message's `receipts[]` and the chat's recipient roster:

- `N` = recipient members (chat.participantIds minus self).
- `delivered` = count of receipts with `deliveredAt`.
- `seen` = count of receipts with `seenAt`.
- **Tier/label** (complete-the-tier):
  - `delivered == 0` → "Sent"
  - `0 < delivered < N` → "Delivered {delivered}/{N}"
  - `delivered == N && 0 < seen < N` → "Seen {seen}/{N}"
  - `seen == N` → "Seen" (no fraction)
- Fraction shown **only while a tier is partial** (so N=1 never shows one).
- **Reciprocity**: when `privacy.seenReceipts` is off, the seen tier is not
  rendered (caps at delivered).

## Derived: message-info member lists (client, computed — not stored)

For a group message, partition `chat.participantIds` (recipients):
- **Seen by** = receipts with `seenAt` (sorted by `seenAt`).
- **Delivered** = receipts with `deliveredAt` and no `seenAt`.
- **Not yet delivered** = participantIds with no receipt `deliveredAt` (NEW).
- Each row resolves name/avatar via the existing `contactMap` + `nameFor` /
  `avatarFor` / `initialsAvatar`. Avatar stack caps at 5 then "+N".

## New: `seen` table (server, Postgres)

Mirrors `deliveries` (migration 0019).

| Column | Type | Notes |
|---|---|---|
| `sender` | text | message author (the reconciling party) |
| `recipient` | text | the member who saw it (server-stamped) |
| `msg_id` | text | the message id (one row per member for a group msg) |
| `seen_at` | bigint (ms) | when the seen receipt was relayed |

- **PK** `(sender, recipient, msg_id)`; upsert `ON CONFLICT DO NOTHING`.
- **Retention/cleanup**: same policy as `deliveries`.
- **Privacy**: only ever contains receipts the recipient's client chose to send
  (suppressed when `privacy.seenReceipts` is off). No preference column. Server
  stays group-blind (no group object; rows are per-(sender,recipient,msg)).
- **ZK**: same metadata class already stored for delivered — routing ids + a
  timestamp, no message content.

## Store API (server, `store/seen.go`)

- `RecordSeen(ctx, sender, recipient, msgId, seenAtMs)` — idempotent upsert.
- `SeenFor(ctx, sender, msgIds) []Seen{MsgID, Recipient, SeenMs}` — one row per
  member; backs `POST /v1/seen/check`.
