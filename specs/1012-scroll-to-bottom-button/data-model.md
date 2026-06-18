# Phase 1 Data Model: Hovering "Scroll to Latest" Button

No persisted-schema change. The `messages` store and `Message` shape are unchanged;
`DB_VERSION` stays 6. Everything below is **transient, in-memory view state** for the chat
view plus the pure-helper shapes. Nothing is persisted, synced, or sent.

## Unchanged (at rest)

- **`messages` store / `Message`** — read-only here; used to count incoming-since-boundary and
  to locate the first-unread id. No fields added.

## New (in-memory): Jump-to-latest view state — in `ChatDetailPage.vue`

Derived from, and reset by, the existing scroll lifecycle (`stickBottom`, `onContentScroll`,
`scrollToNewest`). All session-local; cleared on chat switch / leaving the view.

| Field | Type | Meaning |
|---|---|---|
| `jumpVisible` | boolean (reactive) | Whether the control is shown — true once scrolled up past the appear threshold, false within the hide threshold (hysteresis). Drives the CSS opacity fade. |
| `unreadBoundaryTs` | epoch ms \| null | The newest message timestamp at the moment the user left the bottom. null while pinned to bottom. Messages newer than this (incoming) are "unread". |
| `unreadCount` | number (reactive) | Count of **incoming** messages with `timestamp > unreadBoundaryTs` received while scrolled up. Shown as the badge (capped for display, e.g. `99+`). 0 ⇒ no badge. |
| `firstUnreadId` | message id \| null | The earliest incoming message after the boundary — the tap target when `unreadCount > 0`. |

**State transitions**:

- **Leave bottom** (`stickBottom` → false): set `unreadBoundaryTs = newestLoadedTs`; `unreadCount = 0`; `firstUnreadId = null`. Once past the appear threshold → `jumpVisible = true`.
- **Incoming message while scrolled up** (`messages` change bus / `useChatHistory`): recompute `{count, firstId} = unreadSince(messages, unreadBoundaryTs, selfId)`.
- **Activate control**: jump (D4), then clear `unreadCount`/`firstUnreadId` (the badge resets); `jumpVisible` follows the scroll back toward the bottom.
- **Reach bottom** (`stickBottom` → true): clear `unreadBoundaryTs`/`unreadCount`/`firstUnreadId`; once within the hide threshold → `jumpVisible = false`.

## New (pure): `src/utils/chat-unread.ts`

- `unreadSince(messages: Message[], boundaryTs: number | null, selfId: string) → { count: number; firstId: string | null }`
  Incoming, non-deleted messages with `timestamp > boundaryTs` (deterministic `(timestamp, id)`
  order); `firstId` is the earliest. `boundaryTs == null` ⇒ `{ count: 0, firstId: null }`.
- `jumpButtonVisible(distanceFromBottomPx: number, shown: boolean, showPx: number, hidePx: number) → boolean`
  Hysteresis: returns true past `showPx`, false within `hidePx`, otherwise keeps `shown`.

## Derived (view): control presentation

- Badge label = `unreadCount` capped (e.g. `min(unreadCount, 99)` with a `+` past the cap); the
  badge is absent when `unreadCount === 0`.
- Accessible name reflects state, e.g. "Scroll to latest" or "N new messages, scroll to latest".
