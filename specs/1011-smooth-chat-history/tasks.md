---
description: "Task list for Smooth Chat-History Scroll-Up (spec 1011)"
---

# Tasks: Smooth Chat-History Scroll-Up (verified by a multi-user end-to-end exercise)

**Input**: Design documents from `/specs/1011-smooth-chat-history/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D9), data-model.md, contracts/chat-history.md, quickstart.md

**Tests**: REQUIRED. Constitution III (TDD) is non-negotiable — failing tests (vitest pure
helpers + Playwright e2e) are authored before the implementation they cover.

**Scope**: **Client-only.** No server, wire, stored-ciphertext, or DB-schema change
(`DB_VERSION` stays 6, no new index — research D2). There are NO server/migration tasks.

**Organization**: By user story (US1 smooth scroll-up P1 = MVP, US2 multi-user exercise P1,
US3 jump-to-older P2). A Foundational phase delivers the shared, unit-tested building blocks
every story needs (bounded reads + `useChatHistory` + window math + `withScrollAnchor` +
`seedMessages`) so the stories layer cleanly on top.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)
- Exact file paths are in each description.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand up the client unit-test runner the TDD phases need and capture a green
baseline (the server gates must stay green untouched throughout — Constitution VII).

- [X] T001 Verify the existing client unit-test runner covers the new specs — vitest `^3.2.6` + `test:unit` / `test:unit:watch` scripts + `vitest.config.ts` **already exist** (env `node`, `include: src/**/*.test.ts`, `@/` → `src/` alias, an 80% gated `coverage.include` floor). Confirm `npx vitest run` is green; the new pure-helper specs and the `useChatHistory` spec run under the existing `node` env (Vue refs + a mocked change bus need no DOM — happy-dom NOT required). No new runner/config is added. As the helpers land, append `src/utils/chat-pagination.ts`, `chat-window.ts`, `scroll-anchor.ts`, `chat-grouping.ts` to `vitest.config.ts` `coverage.include` so the 80% floor ratchets onto them (Constitution VII).
- [X] T002 [P] Capture the baseline green gates before any change: `npm run build` (vue-tsc + vite) and `cd server && go build ./... && go vet ./... && go test ./...`. These must stay green for the whole feature; record that they pass now so regressions are attributable.

**Checkpoint**: `vitest` runs; baseline build/server gates green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The reusable, independently-tested core — bounded batch reads, the pure window /
anchor / pagination / group-edge math, the incremental `useChatHistory` composable, and the
dev-only bulk-seed hook. Everything here is consumed by US1/US2/US3.

**⚠️ CRITICAL**: No user-story work begins until this phase is complete.

**⚠️ TDD**: T003–T007 (tests) are written FIRST and MUST FAIL (the modules they import don't
exist yet) before the matching implementations T008–T013.

### Tests (write first — must fail)

- [X] T003 [P] Write failing vitest for pagination/cursor math in `src/utils/chat-pagination.test.ts`: `sliceOlder(sortedAsc, beforeTs|null, limit)` returns the `limit` rows immediately older than `beforeTs` oldest-first (newest `limit` when `null`); `sliceNewer(sortedAsc, afterTs, limit)` returns the `limit` rows immediately newer than `afterTs` oldest-first; deterministic `(timestamp, id)` ordering; **seam dedupe** (a row exactly at the cursor is not returned by both adjacent batches).
- [X] T004 [P] Write failing vitest for window/eviction math in `src/utils/chat-window.test.ts`: `computeWindow` never exceeds `ROW_CAP` (~80–120), always covers viewport + `BUFFER` (derived from `LOOK_AHEAD_PX ≈ 1200`, ~1.5–2 mobile screens) in both directions, grows `start` ↓ on top look-ahead, grows `end` ↑ on downward re-entry, and evicts the correct edge (advance `start` / retreat `end`) once `end - start > ROW_CAP`.
- [X] T005 [P] Write failing vitest for anchor-delta math in `src/utils/scroll-anchor.test.ts`: given an anchor id + recorded `top` and a post-mutation set of measured rects, the residual correction is computed so |residual| ≤ 2px (INV-1); when the recorded anchor id was evicted, it falls back to the next still-rendered row. ALSO cover the **momentum/echo guard predicates** (INV-5) with fake timers: `shouldDeferScrollWrite(now, lastUserScrollAt, MOMENTUM_QUIET_MS)` defers a correction while a fling is in flight and permits it once quiet; `isSelfEcho(scrollTs, suppressStickUntil)` marks the post-correction scroll as our own.
- [X] T006 [P] Write failing vitest for group-run/day boundary math in `src/utils/chat-grouping.test.ts`: `isRunStart(prev, cur)` / `showDay(prev, cur)` computed from the **predecessor included in the window** stay correct across a window boundary with a preserved leading row (D8) — no avatar/divider toggling when the predecessor is prepended/evicted.
- [X] T007 [P] Write failing vitest for the `useChatHistory` composable in `src/composables/useChatHistory.test.ts` (mock `queries` reads + the `idb` change bus): `loadOlder()` prepends a batch and updates `oldestLoadedTs`/`hasOlder`; `loadNewer()` appends; change-bus **append** fires only when the run touches the bottom; **patch-by-id** shallow-merges exactly one row (reaction/seen/edit); **remove-by-id** splices; it NEVER reassigns/replaces the whole `rows` array; switching `chatId`/`q` resets to a fresh newest batch.

### Implementation (make the tests pass)

- [X] T008 [P] Implement `sliceOlder`/`sliceNewer` pure helpers in `src/utils/chat-pagination.ts` to pass T003 (no IndexedDB — operate on a sorted array).
- [X] T009 [P] Implement `computeWindow` + eviction math in `src/utils/chat-window.ts` (`ROW_CAP` ~80–120, `BUFFER` look-ahead constant) to pass T004.
- [X] T010 [P] Implement the anchor helpers in `src/utils/scroll-anchor.ts` (`pickAnchor(rendered, scrollTop)` → topmost fully-rendered `[data-mid]`; `resolveAnchorDelta(anchor, measured)` with evicted-anchor fallback) **plus the pure momentum/echo guard predicates** `shouldDeferScrollWrite` / `isSelfEcho` (INV-5) consumed by `withScrollAnchor`, to pass T005.
- [X] T011 [P] Implement `isRunStart`/`showDay` (predecessor-included) in `src/utils/chat-grouping.ts` to pass T006.
- [X] T012 Implement bounded reads in `src/db/queries.ts` — `listMessagesOlder(chatId, beforeTs|null, limit, q?)`, `listMessagesNewer(chatId, afterTs, limit, q?)`, `countChatMessages(chatId)` — backed by the existing `chatId` index (`getByIndex` + in-memory sort) + the T008 slice helpers; keep `q` substring filter semantics; **keep `listMessages(chatId, q)` (loads-all) for search/other callers**; NO new index, NO `DB_VERSION` bump (D2). (depends on T008)
- [X] T013 Implement the `useChatHistory(chatId, q?)` composable in `src/composables/useChatHistory.ts` — bounded contiguous `rows` (oldest→newest), `hasOlder`/`hasNewer`/`total`, `loadOlder`/`loadNewer`, and the incremental change-bus apply (append-if-bottom / patch-by-id / remove-by-id), per contracts/chat-history.md §2. No full-array replace. (depends on T007, T012)
- [X] T014 [P] Add the dev-only `__ringTest.seedMessages(chatId, n, opts?)` hook in `src/services/testhook.ts`: build `n` `Message` rows (spread timestamps; `opts.fromIds` rotates senders, `opts.mediaEvery` makes every Nth row image/video for height variety) and write them with ONE `bulkPut('messages', rows)` (idb.ts already exposes `bulkPut`). Stripped from prod like the rest of `__ringTest`.

**Checkpoint**: `npx vitest run` green (pagination/window/anchor/group-edge/composable); bounded
reads + `useChatHistory` + `seedMessages` exist and are tested. User stories can begin.

---

## Phase 3: User Story 1 - Smooth scroll-up through a long conversation (Priority: P1) 🎯 MVP

**Goal**: Scrolling up through history is continuous at any length — older pages are prepared
ahead of need, the anchored message stays put (≤2px), DOM/memory stay bounded, and existing
chat behaviors are unchanged.

**Independent Test**: Open a 5,000-msg seeded chat, flick up across many pages → anchored
`[data-mid]` drifts ≤2px, the next older page is in the DOM before the top is reached, rendered
row + resolved-media counts stay bounded, and an inbound message while scrolled up doesn't yank.

### Tests for User Story 1 (write first — must fail)

- [X] T015 [P] [US1] Extend `e2e/chat-media-scroll.spec.ts` with failing assertions on a chat seeded to 5,000 via `__ringTest.seedMessages`: **INV-1/SC-002** anchored bubble `getBoundingClientRect().top` delta ≤ 2px across an older-page load; **INV-2/SC-003** the older batch's first `[data-mid]` is in the DOM before `scrollTop` reaches 0 (page-before-top); **INV-3/SC-008** after scrolling far up then back down, rendered `.bubble[data-mid]` count stays ≈ `ROW_CAP` (per data-model.md / T009, ~80–120) and resolved media ≤ `MAX_MEDIA` (the existing media-LRU cap, 60); **INV-4/SC-004** seeding an extra inbound message, a reaction, AND a status update (e.g. a seen/delivered tick) while scrolled up each leaves `scrollTop` unchanged (all three cases per FR-004).

### Implementation for User Story 1

- [X] T016 [US1] In `src/views/detail/ChatDetailPage.vue`, replace `visible: ref(PAGE)` + `visibleMessages = messages.slice(-visible)` (~2179-2181) with an explicit reactive `{ start, end }` window (render `rows.slice(start, end)`), and source `rows` from `useChatHistory` instead of `useLiveQuery(listMessages)` (D1/D3).
- [X] T017 [US1] Extract and apply `withScrollAnchor(mutate)` in `ChatDetailPage.vue` (using `src/utils/scroll-anchor.ts`): capture anchor → run mutation → `await nextTick()` → re-find by id (evicted-anchor fallback) → correct `scrollTop` by measured delta. Route `loadOlder`'s prepend through it and add the `MOMENTUM_QUIET_MS` + `suppressStickUntil` guards the load path lacks today (D4/D6; `loadOlder` ~2212-2228). The `scrollTop` correction MUST also respect the existing `viewActive` / `document.visibilityState === 'visible'` guard so no correction runs while the view is backgrounded/locked (FR-014).
- [X] T018 [US1] Implement bidirectional eviction + downward re-entry in `ChatDetailPage.vue`: once `end - start > ROW_CAP`, evict the far edge inside the SAME anchored mutation; grow `end` ↑ and `loadNewer()` (append) when scrolling back down after eviction — all via `withScrollAnchor` so position stays ≤2px (D1, uses `computeWindow`).
- [X] T019 [US1] Add look-ahead prefetch in `ChatDetailPage.vue`: an IntersectionObserver sentinel with `rootMargin` = `LOOK_AHEAD_PX` (≈ 1200px, ~1.5–2 screens above the viewport) triggers `loadOlder` BEFORE the top edge is reached; keep `ion-infinite-scroll position="top"` as the backstop (D5; replaces the stall-prone boundary-only `threshold=25%` load).
- [X] T020 [US1] Wire group-row edge correctness into `ChatDetailPage.vue`: feed `renderItems`/`groupRunStart`/`showDay` (~1142-1146, 1605-1613) from the predecessor-included helper (`src/utils/chat-grouping.ts`) so avatars/day-dividers at the window's top edge don't flicker or inject a height jump on load (D8 / INV-7 / FR-005).
- [X] T021 [US1] Verify and preserve all existing chat behaviors against the new windowed/incremental source in `ChatDetailPage.vue`: receipts/seen (spec 1010), reactions, disappearing messages, jump-to-newest on send, search, swipe-to-reply transforms, media LRU (`MAX_MEDIA`), and `v-memo`; confirm the full-array consumers (`chatMediaMsgs` ~1155, `viewerItems`, `albumMessageIds`, preview) still compute correctly from incremental `rows` (FR-011). Also confirm the existing `viewActive` / visibility gate is applied to every new scroll-writing and window-mutation path (look-ahead, `loadOlder`/`loadNewer`, eviction, `withScrollAnchor`) so none run while the view is backgrounded/locked (FR-014).

**Checkpoint**: T015 e2e assertions pass; US1 is independently demoable (MVP) — smooth, bounded,
behavior-preserving scroll-up.

---

## Phase 4: User Story 2 - Realistic multi-user exercise proves the chat works end-to-end (Priority: P1)

**Goal**: A repeatable `drive/` exercise that drives the real app as 5 users — connect via
request+accept, form 1:1 + group, exchange every message kind, build a lengthy chat, scroll up —
proving US1 and broadly smoke-testing messaging/media/groups.

**Independent Test**: `node drive/scenarios/lengthy-chat-scroll.mjs` against `make start` →
5 users connect, every kind delivered/rendered for all participants in 1:1 + group, lengthy chat
opens and scrolls back, screenshots in `.tmp/drive/` show continuous content; a re-run is clean.

**Depends on**: US1 (the scroll-up portion exercises US1) + Foundational `seedMessages` (T014).

- [X] T022 [US2] Add bulk-seed + scroll/screenshot helpers to `drive/driver.mjs` as needed: a convenience that calls `__ringTest.seedMessages(chatId, n, opts)` to build a lengthy chat fast, a scroll-up pass helper, and a screenshot sweep (reuse existing `createAccount`/`pair`/`group`/`say`/`shot`/`sweep`/`preflight`).
- [X] T023 [US2] Create `drive/scenarios/lengthy-chat-scroll.mjs`: 5 users connect via request+accept → form 1:1 + a group → exchange text / voice-audio / video-message / image-upload / video-upload in both → build a lengthy chat (real sends + bulk-seed for length) → open it and scroll up with a screenshot pass to `.tmp/drive/` (SC-005, SC-007); end with `sweep` for a clean re-run (FR-009).
- [X] T024 [US2] Run `node drive/scenarios/lengthy-chat-scroll.mjs` against the local `make start` stack; confirm all 5 connect, every message kind is delivered to + renders for all intended participants across 1:1 + group, the lengthy chat scrolls back smoothly, and read the `.tmp/drive/*.png` screenshots to confirm continuous content (no blank flash/snap); verify a second run sets up from scratch and leaves no lingering accounts.

**Checkpoint**: The end-to-end exercise passes and visually confirms US1 on a real lengthy chat.

---

## Phase 5: User Story 3 - Jumping to older-than-loaded content stays smooth (Priority: P2)

**Goal**: Tapping a reply-quote / starred message older than the loaded window brings it into
view (loading intervening history) instead of "not available".

**Independent Test**: In a long chat, tap a reply quoting a message far above the window → it
mounts and centers within ~1s, no error; jump-to-newest unaffected.

**Depends on**: US1 (window + `withScrollAnchor` + bounded reads).

### Tests for User Story 3 (write first — must fail)

- [X] T025 [P] [US3] Add a failing e2e to `e2e/chat-media-scroll.spec.ts` (INV-6 / SC-006): on a 5,000-msg seeded chat, tap a reply-quote whose target is older than the loaded window → the target `[data-mid]` mounts and is centered within **1.0s**, with no "Original message not available" toast.

### Implementation for User Story 3

- [X] T026 [US3] Implement `seekToMessage(id)` in `ChatDetailPage.vue` by generalizing the existing jump-to-date retry/poll loop (`onPickDate` ~1010-1015) and `scrollToMessage` (~1674-1686): when the target isn't in `rows`, load older batches (grow `start` / seek the batch containing it by timestamp) in a bounded loop until the row mounts, then center it via `withScrollAnchor`; keep jump-to-newest behavior unchanged (D7).

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns (research open-risks + gates)

**Purpose**: Verify the genuinely-new/risky parts, the behavioral-equivalence risks called out
in research, and run the definition-of-done gates.

- [X] T027 [P] Verify the riskiest path — eviction BELOW the viewport + downward re-entry stability — on a 5,000-msg seeded chat (scroll far up, then back down through evicted regions): position stays ≤2px and rows re-mount without a jump. If unstable, apply the documented fallback (grow-only window + aggressive look-ahead + bounded reads + `loadOlder` guards; bounds memory, defers strict DOM eviction) and note it in plan.md. (`ChatDetailPage.vue`)
- [X] T028 [P] Verify media LRU re-resolve on re-entry. **Scenario**: seed a 5,000-msg chat with `mediaEvery` so more than `MAX_MEDIA` posters exist; scroll far up until the LRU revokes a tracked media row's poster URL and that row is evicted; then scroll back down so the row re-enters. **Assert**: the poster re-resolves AND the anchor delta stays ≤2px in the same frame the media re-decodes (no flash, no drift — INV-1 holds through re-decode). (`ChatDetailPage.vue` media LRU path)
- [X] T029 [P] Verify incremental-apply behavioral equivalence for every full-array consumer (`chatMediaMsgs`, `viewerItems`, `albumMessageIds`, message preview) against the `useChatHistory` incremental `rows` vs the old full-array source. (`ChatDetailPage.vue`)
- [X] T030 [P] Verify search scope agreement: search must use a consistent scope (whole-chat via `listMessages(chatId, q)`) and resetting/clearing search returns to a correct newest window — bounded reads + search agree, no missing results. (`ChatDetailPage.vue` + `src/db/queries.ts`)
- [X] T031 [P] Update `drive/README.md` (and the CLAUDE.md "Driving the dev app" note if needed) to list the `lengthy-chat-scroll.mjs` scenario and how to run/read it.
- [X] T032 Run the quickstart manual smoke (specs/1011-smooth-chat-history/quickstart.md): long chat hard flick-up (continuous, no stall/snap, line stays put), send/receive while scrolled up (no jump), group day-divider/avatar no-flicker at top edge (INV-7); and open the keyboard / resize the view mid-flick and confirm the scroll gesture is not fought (no stutter/teleport — relies on existing Ionic handling, no new logic). The INV-5 guard *logic* (MOMENTUM_QUIET_MS / suppressStickUntil) is unit-covered by T005/T010; this task additionally confirms iOS momentum *fling feel* on a **real device** — emulation can't fully prove it.
- [X] T033 Definition-of-done gate (Constitution VII): `npm run build`; `cd server && go build ./... && go vet ./... && go test ./...` (unchanged, must stay green); `npx vitest run`; `make db-up && npm run test:e2e` (incl. the 5k-seeded scroll assertions). All green = done.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no deps; start immediately.
- **Foundational (P2)** → depends on Setup; **BLOCKS all user stories**.
- **US1 (P3)** → depends on Foundational. **MVP.**
- **US2 (P4)** → depends on Foundational + US1 (exercises the smooth scroll).
- **US3 (P5)** → depends on Foundational + US1 (reuses window/anchor/bounded reads).
- **Polish (P6)** → depends on the user stories it verifies.

### Key within-phase dependencies

- Foundational tests T003–T007 before impls T008–T013. T012 needs T008; T013 needs T007 + T012.
- US1: T015 (e2e, fails first) → T016 → T017 → T018 → T019 → T020 → T021 (all same file `ChatDetailPage.vue`, so largely sequential).
- US2: T022 before T023 before T024.
- US3: T025 (fails first) → T026.

### Parallel opportunities

- **Setup**: T002 ∥ T001.
- **Foundational tests** T003 ∥ T004 ∥ T005 ∥ T006 ∥ T007 (distinct files).
- **Foundational impls** T008 ∥ T009 ∥ T010 ∥ T011 ∥ T014 (distinct files); T012/T013 follow their deps.
- **US1 vs US3 e2e authoring** (T015, T025) both extend `e2e/chat-media-scroll.spec.ts`: **T015 lands first** (US1, INV-1/2/3/4), **T025 appends** (US3, INV-6) — author sequentially in that order to avoid merge conflicts (not [P]).
- **Polish** T027 ∥ T028 ∥ T029 ∥ T030 ∥ T031 (distinct concerns/files).

---

## Parallel Example: Foundational phase

```bash
# Author all foundational failing tests together (distinct files):
vitest: src/utils/chat-pagination.test.ts      # T003
vitest: src/utils/chat-window.test.ts          # T004
vitest: src/utils/scroll-anchor.test.ts        # T005
vitest: src/utils/chat-grouping.test.ts        # T006
vitest: src/composables/useChatHistory.test.ts # T007

# Then implement the independent pure helpers together:
src/utils/chat-pagination.ts   # T008
src/utils/chat-window.ts       # T009
src/utils/scroll-anchor.ts     # T010
src/utils/chat-grouping.ts     # T011
src/services/testhook.ts       # T014 (seedMessages)
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (CRITICAL — blocks stories) → 3. Phase 3 US1 →
4. **STOP & VALIDATE**: T015 e2e green on a 5k-seeded chat (anchor ≤2px, page-before-top,
bounded, no-yank) → 5. Demo. This alone delivers the headline ask.

### Incremental delivery

- Setup + Foundational → foundation ready.
- + US1 → smooth bounded scroll-up (MVP).
- + US2 → repeatable 5-user proof + broad smoke test.
- + US3 → jump-to-older polish.
- + Polish → risk verification + all gates green.

---

## Notes

- [P] = different files, no incomplete-task dependency. Most US1 tasks share
  `ChatDetailPage.vue` → sequential by necessity.
- TDD: verify each test FAILS before implementing (Constitution III).
- Client-only — no server/migration/wire tasks (Principle I untouched; no `/speckit-checklist`).
- `DB_VERSION` stays 6; no new index (research D2). The compound `[chatId,timestamp]` index is a
  documented, forward-only, out-of-scope future step (plan.md Complexity Tracking).
- Commit after each task or logical group; each story is an independently testable increment.
