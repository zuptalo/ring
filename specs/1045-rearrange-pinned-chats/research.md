# Research: Rearrange pinned chats + long-press peek (spec 1045)

## D1 — Where does the manual order live?

- **Decision**: An optional `pinnedRank?: number` field on the `Chat` record,
  set only while pinned, deleted on unpin. Sort key for pinned chats becomes
  `(pinnedRank ?? Infinity, lastMessageTime desc, id)`; every local rearrange
  renumbers the full pinned set 0..n-1.
- **Rationale**: The rank inherits everything the `pinned` flag already has —
  encrypted own-data sync of whole chat records, LWW on `updatedAt`, delete
  tombstones — with zero new sync machinery. Membership (`pinned`) and order
  (`pinnedRank`) can't drift apart because they live on the same record and
  are written together. ≤ 9 records renumbered per rearrange is trivial I/O.
- **Alternatives considered**:
  - *Ordered id array in a synced setting* (like `chats.tabFilters`): a second
    source of truth that must be reconciled against pin membership on every
    read (deleted chats, pins from other devices mid-sync); whole-array LWW
    means one device's reorder silently drops another device's concurrent new
    pin. Rejected.
  - *Fractional ranks (no renumber)*: avoids rewriting siblings but accumulates
    float dust and still needs a normalizer; renumbering 9 records is cheaper
    than the edge cases. Rejected.

## D2 — Legacy pins (records that predate the rank)

- **Decision**: `ensurePinRanks()` in `queries.ts`: if any non-archived pinned
  chat lacks `pinnedRank`, stamp the whole pinned set with ranks matching the
  current visual order (rank-first, then recency). Called once from the Chats
  tab on mount (fire-and-forget) and defensively from the reorder writers.
- **Rationale**: Matches the spec assumption "existing pins keep their current
  relative order until first rearranged" and avoids a DB_VERSION bump — the
  `chats` store's shape is unchanged (optional field), and Principle V only
  demands a bump for store-level changes.
- **Alternatives**: an `onupgradeneeded` migration — requires a DB_VERSION bump
  for a field default, heavier than needed and can't see the "current visual
  order" anyway (sorting logic lives above the DB layer). Rejected.

## D3 — Sync conflicts on order

- **Decision**: Accept per-chat LWW as the merge. Ties or gaps in ranks after a
  merge are tolerated by the comparator (stable fallback to recency then id);
  the next local rearrange renumbers cleanly.
- **Rationale**: Concurrent cross-device rearranges are rare and low-stakes;
  the grid never crashes or duplicates (comparator is total). This mirrors how
  `pinned` itself merges today.

## D4 — Drag implementation

- **Decision**: Hand-rolled pointer-events state machine in a composable
  (`useChatDrag.ts`), owned by `ChatsPage.vue`; grid tiles and list rows are
  registered as drag sources. Floating proxy = one absolutely-positioned
  element updated with `transform: translate3d` only. Grid targeting = rect
  math over the grid element (cheap: ≤ 9 tiles), not DOM elementFromPoint.
  Placeholder gap rendered by the grid from `{dragId, hoverIndex}` props with
  CSS transitions.
- **Rationale**:
  - HTML5 drag-and-drop: no touch support on iOS Safari, ugly ghost images,
    can't style the proxy. Rejected.
  - `ion-reorder-group`: vertical single-list reorder only; cannot host a
    3-column grid nor a cross-surface (list ↔ grid) drag. Rejected (noted in
    the Principle XI justification).
  - A drag library (SortableJS, vue-draggable): new dependency for one screen,
    still can't do the row→grid morph + forbidden badge without fighting the
    library. Rejected; the repo prefers stdlib-first equivalents.
- **Timings** (from the user's iMessage description): press 350 ms → lift
  (scale + shadow + light haptic if available); movement > 8 px before lift
  cancels the hold; after lift, movement > 6 px enters drag; holding a further
  550 ms (≈ 900 ms total) with no drag opens the peek. A completed lift
  swallows the trailing click (same trick the grid already uses).
- **Scroll discipline**: while lifted/dragging, a non-passive `touchmove`
  listener calls `preventDefault()` (registered at lift time — safe because
  scroll hasn't started, the finger has been still for 350 ms) and the pointer
  is captured. Near-edge auto-scroll (top/bottom 15% of the content viewport)
  scrolls the `ion-content` scroll element so far-down rows can reach the grid.

## D5 — Peek overlay

- **Decision**: New `ChatPeekOverlay.vue`: `ion-backdrop` + a fixed, centered
  column (blurred backdrop like the games overlay pattern): a rounded card
  listing the newest ~15 messages (from `listMessagesOlder(chatId, null, 15)`,
  read-only), then an inset `ion-list` menu. Menu items: Pin/Unpin (existing
  `setChatPinned` + cap toast), Mark as Unread / Mark as Read (existing
  `markChatUnread`/`markChatRead`), Delete / Exit group (existing confirm
  action sheet), plus **More…** → the existing ChatActionsSheet.
- **Message rendering**: minimal bubbles — outgoing right-aligned with the
  primary tint, incoming left; group messages show sender names; text bodies
  through `EmojiText`; non-text kinds render icon + `mediaPreview()` label
  (image/video get their `posterData`/thumb when already local); `deleted` →
  the standard "deleted" placeholder. No players, no read receipts sent, no
  `markChatRead`.
- **Why "More…"**: on touch, this gesture REPLACES the tile's old
  long-press-→-actions-sheet, which was the pinned chat's only management
  surface (spec 1044). Without a bridge, Mute/Hide/Lock/Favorites would become
  unreachable for pinned chats on phones — an FR-013 violation. One extra row
  keeps every existing capability reachable.
- **Alternatives**: `ion-modal` with breakpoints — brings sheet semantics
  (drag-to-dismiss, focus trapping tuned for sheets) that fight the
  tap-outside-to-dismiss + anchored-card look; `ion-popover` — anchors to the
  pressed element and clips the message list on small screens. Rejected.

## D6 — What the peek must NOT do

- No `markChatRead`, no seen receipts (`seenReportedAt` writes stay in the
  chat view), no media downloads triggered (pending media renders as its
  label/poster only), and hidden-chat rules hold for free: the overlay is only
  reachable from rows/tiles already visible in the list, and it renders only
  local plaintext the list is already allowed to show.

## D7 — e2e approach

- **Decision**: One new Playwright spec: seed two accounts + a few chats via
  the existing `__ringTest` helpers; pin three; assert (a) a new inbound
  message does not reorder the grid, (b) mouse-drag reorder persists across
  reload, (c) long-hold opens the peek, tap-outside closes, tap-inside
  navigates, (d) Mark-as-Unread from the peek shows the badge dot.
  Mouse-only drag (Playwright `mouse.down/move/up`) — the pointer-event
  machine is input-agnostic, and headless touch synthesis is flaky (memory:
  e2e-ci-webrtc-flakiness).
