---
description: "Task list for Expanding Jump Pill + Visibility-Driven Seen Receipts (spec 1013)"
---

# Tasks: Expanding "Jump to Latest" Pill + Visibility-Driven Seen Receipts

**Input**: Design documents from `/specs/1013-jump-pill-seen-receipts/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D7), data-model.md, contracts/seen-and-pill.md,
quickstart.md

**Tests**: REQUIRED. Constitution III (TDD) is non-negotiable — failing tests (vitest pure helpers
+ the idb migration unit test + Playwright e2e) are authored before the implementation they cover.

**Scope**: **Client-only.** Reuses spec 1010's receipt path/envelope/privacy toggle, spec 1011's
bounded scroll, and spec 1012's control + `unreadSince`. The only persisted change is one optional
`Message` field with a forward IndexedDB migration (`DB_VERSION` 6→7). No server, SQL, or
wire-format change (Zero-Knowledge boundary unchanged — see spec's Zero-Knowledge Impact).

**Organization**: By user story — US1 the expanding pill (P1, the visible MVP), US2
visibility-driven Seen (P1), US3 catch-up + open-at-first-unseen + persistence (P2). US2 and US3
share `useSync.ts` + `ChatDetailPage.vue` and build on US1's count, so they are sequential.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)
- Exact file paths are in each description.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Capture a green baseline; confirm the unit-test gate already covers the pure module.

- [ ] T001 Capture the baseline green gates before any change: `npm run build` (vue-tsc + vite),
  `npx vitest run`, and `cd server && go build ./... && go vet ./... && go test ./...`. These must
  stay green for the whole feature (Constitution VII).
- [ ] T002 [P] Confirm `src/utils/chat-unread.ts` is already in `vitest.config.ts`
  `coverage.include` (added in spec 1012) so `seenFrontier` lands under the gated 80% floor — no
  config change expected; note it if missing.

**Checkpoint**: baseline build/vitest/go gates green; pure-module coverage gate confirmed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The persisted field + migration and the pure frontier helper that US1's pill count
and US2/US3's Seen logic all depend on. **Blocks all user stories.**

### Tests for Foundational (write first — must fail)

- [ ] T003 [P] Write a failing vitest for `seenFrontier` in `src/utils/chat-unread.test.ts`:
  `seenFrontier(messages, selfId)` returns the `(timestamp, id)` of the newest **incoming,
  non-deleted** message with `seenReportedAt` set, else `null`; excludes outgoing/own and deleted;
  deterministic by `(timestamp, id)`; ignores input order.
- [ ] T004 [P] Write a failing unit test for the migration in `src/db/idb.migration.test.ts`:
  `migrateMessageToV7(row)` preserves all existing fields, is a no-op for the new field (leaves
  `seenReportedAt` undefined), never throws on malformed/`null` rows (mirrors the
  `migrateMessageToV6` test pattern).

### Implementation for Foundational

- [ ] T005 Add `seenReportedAt?: number` (epoch ms; incoming-only; client-local) to the `Message`
  interface in `src/db/types.ts`, documented as distinct from `seenAt` (sender-side) and never
  sent/synced (FR-018, data-model.md).
- [ ] T006 Bump `DB_VERSION` 6→7 and add the pure `migrateMessageToV7` + its `onupgradeneeded`
  cursor wiring in `src/db/idb.ts` (forward, data-preserving; never throws) to pass T004
  (Constitution V).
- [ ] T007 Implement `seenFrontier` in `src/utils/chat-unread.ts` (pure, no DOM/IDB) to pass T003;
  reuse the existing `UnreadMsg`/`UnreadBoundary` types and `unreadSince` ordering.

**Checkpoint**: T003/T004 pass; the field + migration ship; `seenFrontier` is green and gated.

---

## Phase 3: User Story 1 - The expanding pill (Priority: P1) 🎯 MVP

**Goal**: The scroll-to-latest control is a plain circle when caught up and animates into a
stadium/pill with the count **inline** when there are not-yet-Seen incoming messages, shrinking
back to a circle at zero. Replaces spec 1012's corner badge.

**Independent Test**: Open a long chat, scroll up; with nothing not-yet-Seen the control is a
circle; with N not-yet-Seen it is a pill showing N and grows; as the count returns to 0 it shrinks
back to a circle.

### Tests for User Story 1 (write first — must fail)

- [ ] T008 [P] [US1] Write a failing e2e in `e2e/seen-on-view.spec.ts` (mobile emulation, seed +
  scroll via `__ringTest`): the control is a **circle** when the not-yet-Seen count is 0, becomes
  a **pill** with the inline count when peers send messages while scrolled up, grows with the
  count (capped `99+`), and shrinks back to a circle when caught up.

### Implementation for User Story 1

- [ ] T009 [US1] In `src/views/detail/ChatDetailPage.vue`, add `unseenCount` + `firstUnseenId`
  derived from `seenFrontier(...)` over a bounded not-yet-Seen read (mirror spec-1012
  `recomputeUnread`: `unreadSince(newer, seenFrontier(...), selfId)`); drive the control from
  `unseenCount` (FR-016).
- [ ] T010 [US1] Replace the spec-1012 corner `ion-badge` with an **inline count** inside the
  `ion-fab-button` (chevron + count) in `ChatDetailPage.vue` (Ionic-first, Principle XI).
- [ ] T011 [US1] Add the circle↔stadium CSS transition in `ChatDetailPage.vue` (animate
  width/border-radius; logical properties for RTL; keep the theme-inverted translucent frosted
  disc + solid icon; no composer overlap; accessible name conveys the count) to pass T008
  (FR-001/002/003/005, Principle X).

**Checkpoint**: T008 passes; the pill is independently demoable (grows/shrinks; circle at 0).

---

## Phase 4: User Story 2 - Seen only when actually viewed (Priority: P1)

**Goal**: A message's Seen receipt is sent only when it is ≥50% on screen while the chat is
foregrounded — not on chat-open. Off-screen messages are never reported; the privacy toggle still
fully suppresses.

**Independent Test**: Sender sends several while recipient is away; recipient opens but doesn't
scroll the older ones into view → sender shows only on-screen ones as Seen; scrolling one ≥50% in
→ sender flips it to Seen; toggle off → nothing sent.

**Depends on**: Foundational (the field) + US1 (the count source).

### Tests for User Story 2 (write first — must fail)

- [ ] T012 [P] [US2] Append failing e2e to `e2e/seen-on-view.spec.ts` (two accounts): an off-screen
  incoming message is **not** Seen on the sender; scrolling it ≥50% into view flips it to **Seen**
  within the timeout; with the "Seen receipts" privacy toggle **off**, viewing sends **nothing**;
  and an **own (outgoing)** message and a **deleted** message never emit a Seen receipt even when
  on screen (FR-011).

### Implementation for User Story 2

- [ ] T013 [US2] Add a second `IntersectionObserver` (`bubbleVisObs`, root = the ion-content scroll
  element, `threshold: 0.5`) in `ChatDetailPage.vue` observing `.bubble[data-mid]`; manage its
  lifecycle alongside the existing window sentinels ((un)observe as the render window slides;
  clean up on unmount); gate its callback on foreground (route active + `document.visibilityState
  === 'visible'`) (FR-007/012, D2).
- [ ] T014 [US2] In `src/composables/useSync.ts`, add a per-message Seen send that stamps
  `Message.seenReportedAt = now()` (DB) and emits the unchanged `receipt` envelope via the existing
  path; keep the `seenReceiptsEnabled` privacy gate and 1:1/group addressing; rebuild the
  in-session dedup from `seenReportedAt` (FR-009/010/013, D1).
- [ ] T015 [US2] Wire the observer callback in `ChatDetailPage.vue` to the new send for the visible
  message, and **remove** the on-open/on-foreground bulk `sendSeenReceipts(chatId)` call sites
  (the `onMounted`/`onVisibilityChange` triggers) to pass T012 (FR-007/008).

**Checkpoint**: T012 passes; Seen is visibility-driven; off-screen and toggle-off send nothing.

---

## Phase 5: User Story 3 - Catch-up + open-at-first-unseen + persistence (Priority: P2)

**Goal**: Viewing any message reports Seen for it and all older not-yet-Seen incoming (uniform
catch-up); a chat with not-yet-Seen messages opens at the first such message; the seen state
persists across restarts (stable pill, no re-send).

**Independent Test**: Seed a backlog; bring a message partway down ≥50% on screen → it + all older
not-yet-Seen are reported, newer off-screen stay unreported; reopen/reload → pill count stable, no
duplicate receipts.

**Depends on**: US2 (extends the same send path + observer).

### Tests for User Story 3 (write first — must fail)

- [ ] T016 [P] [US3] Append failing e2e to `e2e/seen-on-view.spec.ts`: bringing a mid-backlog
  message ≥50% into view reports Seen for it **and all older** not-yet-Seen (newer off-screen stay
  unreported); after a full app reload the pill count reflects only still-unseen messages and the
  sender receives **no duplicate** Seen receipts; opening a chat with unseen messages lands at the
  **first not-yet-Seen** message.

### Implementation for User Story 3

- [ ] T017 [US3] Extend the send into `reportSeenAndOlder(message)` (in `useSync.ts` /
  `ChatDetailPage.vue`): stamp `seenReportedAt` + emit a receipt for the message **and every older
  not-yet-Seen incoming, non-deleted** message, once each (dedup via `seenReportedAt`) (FR-014/015,
  D3). Consider batching the sends (see T020).
- [ ] T018 [US3] Implement **open-at-first-unseen** in `ChatDetailPage.vue`: on chat open, if
  `firstUnseenId` exists, `seekTo`/`scrollToMessage` it (momentum-safe via `suppressStickUntil`,
  spec 1011), else open at the newest; align the control's tap target to the first not-yet-Seen
  (FR-006/017, D5) to pass T016.

**Checkpoint**: T016 passes; catch-up, open-at-first-unseen, and restart persistence all hold.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T019 [P] Verify **no regression to spec 1011** scroll behavior (momentum, no-yank when a
  message arrives while scrolled up); confirm `bubbleVisObs` is read-only w.r.t. scroll position
  (only the open-at-first-unseen seek moves it, momentum-safe). (`src/views/detail/ChatDetailPage.vue`)
- [ ] T020 [P] Fling safety/perf: defer/batch Seen sends while a fling is active (reuse
  `lastScrollAt`) so a fast scroll doesn't burst receipts; `log`/cap if a very large backlog is
  collapsed in one catch-up. (`src/views/detail/ChatDetailPage.vue`, `src/composables/useSync.ts`)
- [ ] T021 [P] Accessibility + i18n: the pill is labeled with the count, reaches an adequate touch
  target, renders trailing-side in LTR **and** RTL (logical properties), and is correct in
  light/dark. (`src/views/detail/ChatDetailPage.vue`) (Principles X/XI)
- [ ] T022 Run the quickstart manual smoke (`specs/1013-jump-pill-seen-receipts/quickstart.md`),
  including real-device fade/feel, the foreground gate, and persistence across a reload.
- [ ] T023 Definition-of-done gate (Constitution VII): `npm run build`; `npx vitest run`;
  `cd server && go build ./... && go vet ./... && go test ./...` (unchanged, must stay green);
  `make db-up && npm run test:e2e` (incl. `e2e/seen-on-view.spec.ts`). All green = done.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no deps; start immediately.
- **Foundational (P2)** → depends on Setup. **Blocks all user stories** (field + migration +
  `seenFrontier`).
- **US1 (P3)** → depends on Foundational. **MVP** (the visible pill).
- **US2 (P4)** → depends on Foundational + US1 (uses the count; replaces the seen trigger).
- **US3 (P5)** → depends on US2 (extends the same send path + observer + open flow).
- **Polish (P6)** → depends on the stories it verifies.

### Key within-phase dependencies

- Foundational: T003/T004 (tests, fail first) ∥ → T005 → T006 (T006 passes T004) ; T007 passes T003.
  T005 (types.ts) before T006 (idb.ts).
- US1: T008 (e2e, fail first) → T009 → T010 → T011 (T009–T011 share `ChatDetailPage.vue`, sequential).
- US2: T012 (e2e, fail first) → T013 → T014 → T015 (T013/T015 `ChatDetailPage.vue`, T014 `useSync.ts`;
  T015 follows T014).
- US3: T016 (e2e, fail first) → T017 → T018 (share `useSync.ts`/`ChatDetailPage.vue`, sequential).
- `e2e/seen-on-view.spec.ts`: T008 (US1) creates it; T012 (US2) and T016 (US3) append — same file,
  sequential.
- `src/utils/chat-unread.test.ts`: T003 appends to the existing spec-1012 test file.

### Parallel opportunities

- **Setup**: T002 ∥ T001.
- **Foundational tests**: T003 (vitest) ∥ T004 (migration test) — distinct files.
- **Polish**: T019 ∥ T020 ∥ T021 (distinct concerns); T022/T023 are the final manual + gate.

---

## Implementation Strategy

### MVP first (US1)

Setup → Foundational → US1 → **STOP & VALIDATE** (T008 e2e green: circle at 0, pill with inline
count, grow/shrink). This delivers the headline visible change.

### Incremental delivery

- Foundation (field + migration + `seenFrontier`) ready.
- + US1 → the expanding pill (MVP).
- + US2 → Seen is honest (only what you've viewed; toggle still suppresses).
- + US3 → catch-up while reading down, open-at-first-unseen, restart-stable persistence.
- + Polish → 1011 no-regression, fling batching, a11y/i18n, real-device, all gates.

---

## Notes

- [P] = different files, no incomplete-task dependency. Most US tasks share `ChatDetailPage.vue`
  / `useSync.ts` → sequential by necessity.
- TDD: verify each test FAILS before implementing (Constitution III).
- Client-only — no server/SQL/wire task. The only persisted change is `Message.seenReportedAt` +
  the `DB_VERSION` 6→7 forward migration (Principle V).
- Zero-Knowledge: the receipt envelope and server role are unchanged; `seenReportedAt` is
  client-local. `/speckit-checklist` (zero-knowledge) is REQUIRED before `/speckit-implement`
  (Principle I).
- Commit after each task or logical group; each story is an independently testable increment.
