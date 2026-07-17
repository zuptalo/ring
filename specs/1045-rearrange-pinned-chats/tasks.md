# Tasks: Rearrange pinned chats with drag, stable manual order, and long-press chat preview

**Input**: Design documents from `specs/1045-rearrange-pinned-chats/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Tests**: Included — the constitution mandates TDD (Principle III): failing
unit tests land before the logic they gate; e2e covers the changed user-facing
behavior.

**Organization**: Grouped by user story; US1 (stable order) is the MVP and the
foundation the drag stories write through.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

*(No project setup needed — existing app, no new dependencies.)*

- [ ] T001 Confirm branch `feat/1045-rearrange-pinned-chats` is current and
      `npm run build` is green before changes (baseline).

## Phase 2: Foundational (blocking all stories)

- [ ] T002 [P] Extend `src/db/types.ts`: add `pinnedRank?: number` to `Chat`
      with a why-comment (position in the user's arrangement; present only
      while pinned; synced like `pinned`).

## Phase 3: US1 — Pinned chats keep the order I gave them (P1) 🎯 MVP

**Goal**: Grid order = user's arrangement; message activity never moves a pin.

**Independent test**: Pin three chats, message the last one, order unchanged;
order survives restart and syncs.

- [ ] T003 [US1] RED: extend `src/utils/chat-pins.test.ts` with failing tests:
      rank-aware pinned comparator (rank asc, missing rank → after ranked +
      recency fallback, total/stable on ties), `nextPinRank`, and
      `partitionPinned` returning the grid rank-sorted.
- [ ] T004 [US1] GREEN: implement in `src/utils/chat-pins.ts`: `pinnedOrder`
      comparator + `nextPinRank(chats)` helper; keep the module pure and
      dependency-free.
- [ ] T005 [US1] Wire `src/db/queries.ts`: `chatOrder` uses `pinnedOrder`
      among pinned chats; `setChatPinned` stamps `pinnedRank = nextPinRank(...)`
      on pin and deletes it on unpin; `setChatArchived`/`archiveAllChats`
      delete it alongside `pinned`.
- [ ] T006 [US1] Add `ensurePinRanks()` to `src/db/queries.ts` (stamp missing
      ranks in current visual order, idempotent) and call it (fire-and-forget)
      from `src/views/tabs/ChatsPage.vue` on mount.
- [ ] T007 [US1] Verify: `npx vitest run src/utils/chat-pins.test.ts` green;
      `npm run build` green.

## Phase 4: US2 — Drag a pinned avatar to rearrange (P1)

**Goal**: Short-hold lifts a tile; drag shows a live gap; drop commits and
persists the new order.

- [ ] T008 [US2] RED: create `src/utils/drag-math.test.ts` with failing tests
      for `src/utils/drag-math.ts`: slot index from pointer position + grid
      rect (3 columns, row math, clamping), `moveItem(list, from, to)`
      reorder, hover-gap layout mapping (which tile shifts where), and
      "outside grid" detection.
- [ ] T009 [US2] GREEN: implement `src/utils/drag-math.ts` as pure functions.
- [ ] T010 [US2] Add `setPinnedOrder(orderedIds: string[])` to
      `src/db/queries.ts`: renumber ranks 0..n-1 (only write records whose
      rank changed), bumping `updatedAt` for sync.
- [ ] T011 [US2] Create `src/composables/useChatDrag.ts`: pointer-event state
      machine (idle → held → lifted → dragging), 350 ms lift timer, 8 px
      pre-lift cancel threshold, pointer capture + non-passive `touchmove`
      preventDefault while lifted, floating-proxy position (translate3d),
      peek timer hook (fires `peek` at ~900 ms total if never dragged),
      drop/cancel resolution, and near-edge auto-scroll of the ion-content
      scroll element.
- [ ] T012 [US2] Rework `src/components/PinnedChatsGrid.vue`: register tiles
      as drag sources (replacing the old 500 ms sheet timer), render the
      lifted tile's slot as a gap + shift siblings from `{dragId, hoverIndex}`
      props (CSS transitions), keep tap-to-open + contextmenu-to-sheet, keep
      badges/dot on the proxy source data.
- [ ] T013 [US2] Host in `src/views/tabs/ChatsPage.vue`: instantiate
      `useChatDrag`, render the floating avatar proxy (teleport to page,
      UserAvatar + badges, lifted styling: scale/shadow), commit grid drops
      via `setPinnedOrder`.
- [ ] T014 [US2] Verify: unit suites green; `npm run build` green; manual
      drive check that a reorder sticks after reload.

## Phase 5: US3 — Drag between the grid and the list to pin/unpin (P2)

**Goal**: Pin ⇄ list membership by drag, with the ⊘ badge at the 9-pin cap.

- [ ] T015 [US3] Extend `src/db/queries.ts` `setChatPinned` with an optional
      `atRank` (insert position → renumber via the US2 helper); cap check
      unchanged (returns false at 9).
- [ ] T016 [US3] Extend `src/components/ChatListItem.vue`: register the row as
      a drag source through the same controller (long-press lifts a round
      avatar proxy; pre-lift horizontal movement cancels so ion-item-sliding
      swipes still win; tap/click unchanged).
- [ ] T017 [US3] Drop semantics in `useChatDrag` + `ChatsPage.vue`: pinned
      tile released outside the grid → unpin (toast-free, it just slides into
      the list); list row released over the grid with < 9 pins → pin at the
      hovered slot; with 9 pins → show `ban` icon badge at the proxy's top
      right while over the grid and make the drop a no-op.
- [ ] T018 [US3] Verify: unit + build green; drive-harness screenshot of the
      ⊘ badge with 9 pins.

## Phase 6: US4 — Hold longer for a peek at the chat (P2)

**Goal**: ~1 s still hold opens a read-only preview + Pin/Unpin, Mark as
Unread/Read, Delete (+ More…) menu.

- [ ] T019 [US4] Create `src/components/ChatPeekOverlay.vue`: ion-backdrop +
      centered card; newest ~15 messages via `listMessagesOlder(chatId, null,
      15)` rendered as minimal bubbles (outgoing/incoming alignment, group
      sender names, `EmojiText` bodies, icon + `mediaPreview()` label for
      non-text kinds, poster thumb when local, deleted placeholder); menu:
      Pin/Unpin (cap toast), Mark as Unread/Read, Delete/Exit group (existing
      confirm sheets), More… (opens ChatActionsHost sheet); tap card → emit
      `open`, tap backdrop → emit `dismiss`; `role="dialog"`, labels, and NO
      `markChatRead`/receipt writes.
- [ ] T020 [US4] Wire the peek: `useChatDrag`'s `peek` event (tiles AND rows,
      including on chips/search views where rows don't drag) opens the overlay
      from `src/views/tabs/ChatsPage.vue`; navigation on `open`.
- [ ] T021 [US4] Update `e2e/pinned-grid.spec.ts`: the tile hold now opens the
      PEEK (not the actions sheet) — hold ~1.2 s, assert the peek, use its
      Unpin; keep the rest of the 1044 assertions intact.
- [ ] T022 [US4] Verify: `npm run build` green; drive-harness screenshots of
      the peek (light + dark).

## Phase 7: Polish & cross-cutting

- [ ] T023 [P] New e2e `e2e/pinned-reorder.spec.ts`: (a) inbound message does
      not reorder the grid; (b) mouse-drag reorder persists across reload;
      (c) drag a row into the grid pins it at the slot; (d) long-hold peek:
      tap-outside closes, tap-inside opens the chat, Mark as Unread shows the
      dot. Reuse `e2e/helpers` account/pair utilities.
- [ ] T024 Run the full gates: `npm run test:unit`, `npm run build`,
      `npm run test:e2e -- pinned` (grid + reorder specs), fix fallout.
- [ ] T025 Update `specs/1045-rearrange-pinned-chats/spec.md` Status →
      in-review when the user validates locally; run `make roadmap` and commit
      the regenerated `ROADMAP.md`.
- [ ] T026 (deferred, needs user go-ahead) `/speckit-taskstoissues` + PR with
      `Closes #N` lines — nothing is pushed until the user has tested locally.

## Dependencies

- T002 → everything.
- US1 (T003–T007) → US2 (ranks must exist before reorder writes).
- US2's controller + math (T008–T013) → US3 (T015–T018) and the peek trigger
  (T020). T019 is parallel to US2/US3 (component in isolation).
- e2e polish (T023) after US2–US4.

## Implementation strategy

US1 alone is a shippable MVP (stable order, no visual change beyond stability).
US2 delivers the headline gesture; US3 and US4 complete iMessage parity. Tests
red-first within each story; `npm run build` after every story.
