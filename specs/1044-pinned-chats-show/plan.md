# Implementation Plan: Pinned Chats Grid (spec 1044)

**Branch**: `feat/1044-pinned-chats-show` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

## Summary

Pinning already exists end to end — `Chat.pinned` on the chats store (`src/db/types.ts:127`), `MAX_PINNED_CHATS = 3` enforced in `setChatPinned` (`src/db/queries.ts:73,182-194`), pinned-first ordering in `chatOrder` (`:83-86`), swipe-right pin UI (`ChatListItem.vue:6-16`), and cross-device sync via the chats-store own-data backup (`ownsync.ts:28`). This feature is presentation + cap: render pinned chats as an iMessage-style 3-column avatar grid above the list on the Chats tab, remove them from the list rows while gridded, raise the cap to 9, and add Pin/Unpin to the actions sheet (reachable via long-press on a grid tile) since swipe no longer reaches pinned chats.

## Technical Context

Vue 3 + Ionic, client-only. No server, storage schema, crypto, or sync change (`pinned` already syncs; the cap is a client write-gate). Grid composes existing pieces: `UserAvatar` (scales to container), the `AllMediaPage.vue:483` 3-col grid pattern, `useChatFilters`'s `chats` array (already pinned-first, hidden-fail-closed, filter-applied).

## Constitution Check

I: nothing crosses the wire — PASS (spec ZK section). II: spec 1044, adhoc band — PASS. III: vitest for the cap change + list/grid partition logic red-first; e2e for the grid render + hidden interplay — PASS. V: no store change — PASS. X/XI: stock Ionic + existing tokens; logical CSS for RTL — PASS.

## Design

1. **Data**: `MAX_PINNED_CHATS` 3 → 9 (`src/db/queries.ts:73`); the cap toast in `ChatListItem.vue` already interpolates the constant.
2. **Partition**: in `ChatsPage.vue` (has `chats` from `useChatFilters`, line ~234): `pinnedChats = chats.filter(c => c.pinned)` and `listChats = chats.filter(c => !c.pinned)` — but ONLY when `activeFilter === 'all'` and search is empty; otherwise the grid hides and the untouched `chats` render as rows (search/filter must still find pinned chats).
3. **Grid**: new `PinnedChatsGrid.vue` component (composition of `ion-item`-free primitives: a CSS grid of buttons, each `UserAvatar` in a sized box + name label + unread badge). 3 columns (`repeat(3, 1fr)`, like AllMediaPage), rows wrap for 4-9 pins, tiles keep aspect on 1-2 pins (no stretching — fixed max tile width). Tap → same navigation as a row tap (`/chat/:id`). Long-press → the existing `ChatActionsSheet` for that chat. Unread badge reuses the row badge styling; presence dot only if trivially composable.
4. **Actions sheet**: add Pin/Unpin item to `ChatActionsSheet.vue` (`:20-59`) wired to `setChatPinned`, with the same cap toast as the swipe path.
5. **Ready gating**: grid renders only when the page's existing `ready` flag is set (`ChatsPage.vue:245-247`) so the fail-closed hidden state can't flash an empty grid at cold open.
6. **RTL**: CSS grid + logical properties; order follows DOM order (reading direction).

## Test strategy (red first)

- **vitest** `src/db/queries` cap behavior: a 10th pin refuses (existing pattern? queries.ts is IDB-backed — instead unit-test the pure partition helper). Extract `partitionPinned(chats, activeFilter, searching)` as a pure function in `src/utils/chat-pins.ts` → unit-test: partition only on all+empty-search; order preserved; ≤9 rendered. Plus `schema`-style guard: `MAX_PINNED_CHATS === 9`.
- **e2e** `pinned-grid.spec.ts`: pin two chats via hook/UI → grid shows 2 tiles, their rows leave the list; tap a tile opens the chat; unpin from the sheet returns it to the list; search shows pinned chats as rows.
- **drive** screenshot for the PR (grid with several pins, light+dark).

## Verification

`npm run build`, `npx vitest run`, `npm run test:e2e -- pinned-grid`, drive screenshots. Full suite on PR CI.
