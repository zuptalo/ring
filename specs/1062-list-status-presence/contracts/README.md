# Contracts — Message status and presence on the chat list

This feature adds **no server API and no new wire contract**. The only external
contract it touches — the presence WebSocket — is used exactly as today. The
contracts below are the internal client interfaces the four UI slices share, so
list, tile, and conversation stay consistent.

## Unchanged: presence WebSocket (existing)

- Client → server: `presence-sub { ids }`, `presence-prefs {...}`, `presence-self {active}`.
- Server → client: `presence { user, online?, lastSeen? }`, gated by the 1:1
  contact graph.

This feature issues **no new frame types**. The client already subscribes to all
contacts; an optional, bounded `subscribePresence(openGroupMemberIds)` reuses the
existing `presence-sub` frame for the currently-open group only. The server
behaves identically and remains blind to group membership.

## New internal contracts

### `lastMessageTick(input, seenReceiptsOn): LastTick` — `src/services/message-status.ts`

Pure. Given the chat's last message (direction + `status` for 1:1, or the
`receipts[]`/`groupProgress` tier for a group) and whether seen-receipts are
reciprocally enabled, returns the display tier (`none | pending | sent |
delivered | seen | failed`). Single source of truth for the tick everywhere.

- Incoming or absent last message → `none`.
- `failed` → `failed` (callers render nothing, no success glyph).
- `seen` is only reachable when `seenReceiptsOn` is true; otherwise caps at
  `delivered` (mirrors the in-conversation gate).

### `MessageTick.vue` — `src/components/MessageTick.vue`

Ionic-first presentational component. Props: `{ tier: LastTick }` (and optional
`size`). Renders the matching `ion-icon` (`timeOutline` / `checkmark` /
`checkmarkDone`) with the `.tick` / `.tick.seen` (blue `#34b7f1`) styling already
used in the conversation. Renders nothing for `none`/`failed`. Reused by
`ChatDetailPage`, `ChatListItem`, and `PinnedChatsGrid` so the glyphs never drift.

### `useGroupPresence(chat): ComputedRef<GroupOnline>` — `src/composables/useGroupPresence.ts`

Reactive. Given a group Chat, returns the `GroupOnline` view (see data-model):
`{ count, onlineIds, allContacts, label }`. Reads `participantIds`, the contact
set, and `peerPresence()`. Recomputes when presence or roster changes. Returns an
empty label at `count === 0`. Non-group chats return `count: 0` / empty label
(callers fall back to the existing 1:1 dot).

### Presence dot (existing `.presence-dot`, reused)

The green dot CSS in `ChatListItem.vue` is reused for: pinned-tile bottom-right
(1:1) and per-member group avatars (Story 4), the latter sized proportionally via
an `em`/CSS-variable tweak. No new colours — the success token drives it.

## Consumption map

| Surface | Uses |
|---|---|
| `ChatListItem.vue` (row) | `lastMessageTick` + `MessageTick` (1:1 & group); `useGroupPresence` label for group rows |
| `PinnedChatsGrid.vue` (tile) | `MessageTick` bottom-left; `.presence-dot` bottom-right (1:1); `useGroupPresence` compact label (group) |
| `ChatDetailPage.vue` (conversation) | `MessageTick` (dedupe existing inline logic); `useGroupPresence` in the group header; `.presence-dot` on member avatars, `activityFor` overriding |
