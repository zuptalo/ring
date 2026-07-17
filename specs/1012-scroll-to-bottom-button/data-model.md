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
| `unreadBoundary` | `{ ts, id }` \| null | The newest message the user had seen (a `(timestamp, id)` point in the chat's canonical order) at the moment they left the bottom. null while pinned to bottom. Messages that sort **after** this point (incoming) are "unread". A tuple, not a bare timestamp, so a same-millisecond incoming message isn't dropped (ids are random, several can share a ms). |
| `unreadCount` | number (reactive) | Count of **incoming** messages sorting after `unreadBoundary` in `(timestamp, id)` order, received while scrolled up. Shown as the badge (capped for display, e.g. `99+`). 0 ⇒ no badge. |
| `firstUnreadId` | message id \| null | The earliest incoming message after the boundary — the tap target when `unreadCount > 0`. |

**State transitions**:

- **Leave bottom** (`stickBottom` → false): set `unreadBoundary = { ts, id }` of the newest loaded row; `unreadCount = 0`; `firstUnreadId = null`. Once past the appear threshold → `jumpVisible = true`.
- **Incoming message while scrolled up** (`messages` change bus / `useChatHistory`): recompute `{count, firstId} = unreadSince(newer, unreadBoundary, selfId)` over a bounded read fetched inclusive of the boundary millisecond.
- **Activate control**: jump (D4), then clear `unreadCount`/`firstUnreadId` (the badge resets); `jumpVisible` follows the scroll back toward the bottom.
- **Reach bottom** (`stickBottom` → true): clear `unreadBoundary`/`unreadCount`/`firstUnreadId`; once within the hide threshold → `jumpVisible = false`.

## New (pure): `src/utils/chat-unread.ts`

- `unreadSince(messages: Message[], boundary: { ts: number; id: string } | null, selfId: string) → { count: number; firstId: string | null }`
  Incoming, non-deleted messages sorting strictly after `boundary` in `(timestamp, id)` order
  (so a same-millisecond newer message isn't dropped); `firstId` is the earliest. `boundary == null`
  ⇒ `{ count: 0, firstId: null }`.
- `jumpButtonVisible(distanceFromBottomPx: number, shown: boolean, showPx: number, hidePx: number) → boolean`
  Hysteresis: returns true past `showPx`, false within `hidePx`, otherwise keeps `shown`.

## Derived (view): control presentation

- Badge label = `unreadCount` capped (e.g. `min(unreadCount, 99)` with a `+` past the cap); the
  badge is absent when `unreadCount === 0`.
- Accessible name reflects state, e.g. "Scroll to latest" or "N new messages, scroll to latest".
