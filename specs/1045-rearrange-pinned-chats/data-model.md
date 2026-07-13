# Data Model: spec 1045

## Chat (existing store `chats` — field-level extension, no DB_VERSION bump)

```ts
export interface Chat {
  // ... existing fields ...
  pinned?: boolean;      // existing (spec 1044): member of the pinned grid
  pinnedRank?: number;   // NEW: 0-based position in the user's arrangement.
                         // Present only while pinned; deleted on unpin/archive.
}
```

### Semantics

| Operation | Effect on `pinnedRank` |
|---|---|
| Pin via swipe / sheet / peek menu | `max(existing ranks) + 1` (append at end) — FR-002 |
| Pin via drag-into-grid at slot *i* | rank *i*; ranks of the pinned set renumbered 0..n-1 |
| Drag-reorder to slot *i* | pinned set renumbered 0..n-1 with the moved chat at *i* |
| Unpin (any surface, incl. drag-out) | field deleted, together with `pinned` |
| Archive | field deleted (archives already drop `pinned`) |
| New message / read / mute / any non-arrange interaction | **unchanged** — FR-001 |

### Ordering (client sort, `chatOrder` in queries.ts)

1. Pinned before unpinned (unchanged).
2. Among pinned: `pinnedRank ?? Infinity` ascending; ties (sync merges, legacy
   pins) fall back to `lastMessageTime` desc, then `id` — total and stable.
3. Among unpinned: `lastMessageTime` desc (unchanged).

### Migration / legacy

`ensurePinRanks()` (queries.ts): if any non-archived pinned chat lacks a rank,
stamp the entire pinned set 0..n-1 in current visual order. Runs once per
device (idempotent afterwards), invoked from the Chats tab mount and before
any rank write.

### Sync

Chat records already ride encrypted own-data sync (`SYNCED` stores in
`ownsync.ts`), sealed client-side, LWW per record on `updatedAt`. `pinnedRank`
adds no wire format, no server column, no new metadata — the server continues
to see one opaque blob.

## Transient (not persisted)

- **Drag state** (`useChatDrag`): `{ phase: idle|held|lifted|dragging,
  chatId, origin: grid|list, pointer x/y, hoverIndex | null, blocked }` —
  in-memory only.
- **Peek state**: `{ chat, messages: Message[] (≤15, read-only) }` — queried on
  open, discarded on dismiss; never writes.
