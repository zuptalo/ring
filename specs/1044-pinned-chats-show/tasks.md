# Tasks: Pinned Chats Grid (spec 1044)

**Input**: spec.md, plan.md. **Tests**: REQUIRED (constitution III — red first per story).

## Phase 1: US1 - Pinned chats show as an avatar grid (P1) 🎯 MVP

- [X] T001 [US1] Failing tests first: (a) vitest `src/utils/chat-pins.test.ts` for a new pure `partitionPinned(chats, {filterAll, searching})` — grid+list split only on all-filter + empty search, order preserved, grid capped at 9; (b) vitest guard `MAX_PINNED_CHATS === 9`; (c) failing e2e `e2e/pinned-grid.spec.ts` — pin two chats, Chats tab shows 2 grid tiles and their rows leave the list, tapping a tile opens the chat. Confirm all FAIL.
- [X] T002 [P] [US1] `src/utils/chat-pins.ts`: the pure partition helper (a). `src/db/queries.ts:73`: cap 3 → 9 (b).
- [X] T003 [US1] New `src/components/PinnedChatsGrid.vue`: 3-col CSS grid (AllMediaPage pattern), tiles = UserAvatar box + single-line ellipsized name + unread badge (reuse row badge look), tap navigates like a row tap, logical CSS for RTL, no stretching at 1-2 pins.
- [X] T004 [US1] `src/views/tabs/ChatsPage.vue`: render the grid above the ion-list via `partitionPinned` (gated on the existing `ready` flag — no cold-open flash); list renders the non-pinned remainder; grid hidden (rows unchanged) under search or a non-All chip. e2e (c) goes green.

## Phase 2: US2 - Manage pins from the grid and sheet (P2)

- [X] T005 [US2] Failing e2e extension first: long-press a tile opens the actions sheet; Unpin returns the chat to the list; the sheet offers Pin for an unpinned chat; a 10th pin shows the cap message.
- [X] T006 [US2] `src/components/ChatActionsSheet.vue`: add Pin/Unpin action (setChatPinned + the swipe path's cap toast); `PinnedChatsGrid.vue`: long-press opens the sheet for that chat. e2e green.

## Phase 3: US3 - Hidden + sync interplay (P3)

- [X] T007 [US3] e2e: a pinned then hidden chat renders NO tile while concealed (extend `e2e/pinned-grid.spec.ts` using the hidden-chats hooks from hidden-chats specs); during a reveal it appears per existing reveal ordering. Assert no tile flash at cold open (`ready` gate).

## Phase 4: Polish

- [X] T008 Gates: `npm run build`, `npx vitest run`, `npm run test:e2e -- pinned-grid`; drive screenshots (grid with 4+ pins, light + dark) for the PR; `make roadmap`.

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 (T002's two edits parallel-safe).
