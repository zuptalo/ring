---
description: "Task list for Hovering Scroll-to-Latest Button (spec 1012)"
---

# Tasks: Hovering "Scroll to Latest" Button in Chat

**Input**: Design documents from `/specs/1012-scroll-to-bottom-button/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D6), data-model.md, contracts/scroll-to-latest.md, quickstart.md

**Tests**: REQUIRED. Constitution III (TDD) is non-negotiable — failing tests (vitest pure
helpers + Playwright e2e) are authored before the implementation they cover.

**Scope**: **Client-only.** No server, wire, stored-ciphertext, or DB-schema change. Reuses
spec 1011's scroll primitives (`stickBottom`/`nearBottom`/`onContentScroll`/`scrollToNewest`/
`scrollToMessage`) — no new scroll/anchor/windowing mechanics.

**Organization**: By user story (US1 the button = P1/MVP, US2 the unread badge + first-unread =
P2). US2 layers onto US1 (it badges the same control and extends the same tap handler), so it
depends on US1.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 (Setup, Polish carry no story label)
- Exact file paths are in each description.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the unit-test runner and capture a green baseline (the server gates must
stay green untouched — Constitution VII).

- [ ] T001 Confirm `npx vitest run` is green and that the new pure helper runs under the existing `node` env (no DOM needed). As `src/utils/chat-unread.ts` lands, append it to `vitest.config.ts` `coverage.include` so the 80% gated floor ratchets onto it (Constitution VII). No new runner/config.
- [ ] T002 [P] Capture the baseline green gates before any change: `npm run build` (vue-tsc + vite) and `cd server && go build ./... && go vet ./... && go test ./...`. These must stay green for the whole feature.

**Checkpoint**: `vitest` runs; baseline build/server gates green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None beyond Setup. US1 and US2 are independent vertical slices over one view +
one small pure helper; there is no shared blocking work to extract here (the control created in
US1 is the thing US2 enhances, so it lives in US1, not Foundational).

**⚠️ No user-story work depends on a separate Foundational phase for this feature.**

---

## Phase 3: User Story 1 - Jump back to the newest message (Priority: P1) 🎯 MVP

**Goal**: A floating "scroll to latest" control that is hidden at the bottom, fades in once the
user scrolls up, and on tap smoothly returns to the newest message — fading out as the bottom
is reached. No badge yet (that's US2).

**Independent Test**: Open a long chat, scroll up a screen → the control fades in above the
composer on the trailing side; tap it → the view returns to the newest message and the control
fades out. Resting at the bottom shows no control.

### Tests for User Story 1 (write first — must fail)

- [ ] T003 [P] [US1] Write failing vitest for the show/hide hysteresis predicate in `src/utils/chat-unread.test.ts`: `jumpButtonVisible(distancePx, shown, showPx, hidePx)` returns true past `showPx`, false within `hidePx`, keeps the current `shown` in the gap, and never oscillates given `showPx > hidePx`.
- [ ] T004 [P] [US1] Write a failing e2e in `e2e/scroll-to-latest.spec.ts` (seed/scroll via `__ringTest`, mobile emulation): **B-1** the control is absent while resting at the bottom; **B-2** it fades in after scrolling up past the threshold (bottom-trailing, above the composer); **B-3/B-5** tapping it returns to the newest message and it fades out (no-unread case).

### Implementation for User Story 1

- [ ] T005 [US1] Implement `jumpButtonVisible` (pure, hysteresis) in `src/utils/chat-unread.ts` to pass T003 (no DOM).
- [ ] T006 [US1] Add the control to `src/views/detail/ChatDetailPage.vue`: an `ion-fab` (vertical=bottom, horizontal=end) inside `ion-content` with a small `ion-fab-button` + chevron-down `ion-icon`, bound to a `jumpVisible` ref and faded via a CSS opacity transition (~200ms). Style with theme tokens; trailing-side via logical properties (RTL); light/dark (FR-001/005/007, D1/D5).
- [ ] T007 [US1] Wire `jumpVisible` from the existing scroll state in `ChatDetailPage.vue`: in `onContentScroll`, compute distance-from-bottom (`scrollHeight - scrollTop - clientHeight`) and update `jumpVisible` via `jumpButtonVisible` (hysteresis); force-hide on reaching the bottom (`stickBottom`/`scrollToNewest`). Reuse the existing scroll metrics — no new listener (FR-002/003, D2).
- [ ] T008 [US1] Add the tap handler in `ChatDetailPage.vue` → `scrollToNewest()` (no-unread path); confirm auto-follow re-engages and the control fades out as the bottom is reached. Set an accessible name (e.g. "Scroll to latest") and an adequate touch target (FR-004/006/007, B-5/B-8).

**Checkpoint**: T003/T004 pass; US1 is independently demoable (MVP) — the button appears/hides,
fades, and returns to newest, clear of the composer.

---

## Phase 4: User Story 2 - Unread count badge + jump to first unread (Priority: P2)

**Goal**: While scrolled up, the control shows a count of new **incoming** messages, and tapping
it jumps to the **first unread** (earliest incoming since the user left the bottom), else to the
newest. The badge resets on activation or on reaching the bottom.

**Independent Test**: Scroll up; have the peer send 3 messages → the control shows "3"; tap it →
the view jumps to the first of those messages and the badge clears. Own/at-bottom messages never
badge.

**Depends on**: US1 (badges the same control; extends the same tap handler).

### Tests for User Story 2 (write first — must fail)

- [ ] T009 [P] [US2] Write failing vitest for `unreadSince` in `src/utils/chat-unread.test.ts`: `unreadSince(messages, boundaryTs, selfId)` → `{count, firstId}` over **incoming**, non-deleted messages with `timestamp > boundaryTs`, deterministic `(timestamp, id)` order, earliest as `firstId`; `boundaryTs === null` → `{0, null}`; outgoing/own excluded.
- [ ] T010 [US2] Add failing e2e to `e2e/scroll-to-latest.spec.ts` (append after the US1 cases — same file, sequential): **B-6** scrolled up + N incoming → badge shows N; an own/at-bottom message does NOT badge; large counts cap (`99+`); **B-4** tapping jumps to the first unread `[data-mid]` and clears the badge.

### Implementation for User Story 2

- [ ] T011 [US2] Implement `unreadSince` in `src/utils/chat-unread.ts` to pass T009.
- [ ] T012 [US2] Track the unread boundary in `ChatDetailPage.vue`: on leaving the bottom capture `unreadBoundaryTs = newestLoadedTs`; recompute `{unreadCount, firstUnreadId} = unreadSince(messages, unreadBoundaryTs, selfId)` off the existing `messages` change bus / `useChatHistory`; reset all three on reaching the bottom or on activation (D3, data-model.md).
- [ ] T013 [US2] Add the count `ion-badge` to the control in `ChatDetailPage.vue` (shown when `unreadCount > 0`, capped e.g. `99+`), and fold the count into the control's accessible name (FR-008, B-6/B-8).
- [ ] T014 [US2] Extend the tap handler in `ChatDetailPage.vue`: if `unreadCount > 0` and `firstUnreadId` → `scrollToMessage(firstUnreadId)` (spec 1011 seek; loads the target if it was trimmed) and clear the badge; else `scrollToNewest()` (FR-004, B-4, D4).

**Checkpoint**: T009/T010 pass; US2 layers the badge + first-unread jump on the working button.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T015 [P] Verify composer clearance: the control stays above the composer and never overlaps the input or the newest bubble's tap targets across keyboard open/close and reply/edit-bar states (B-7 / SC-004). (`src/views/detail/ChatDetailPage.vue`)
- [ ] T016 [P] Verify accessibility + i18n: the control is labeled and reachable by assistive tech, has an adequate touch target, renders on the trailing side in LTR **and** RTL, and is correct in light/dark (B-8 / SC-006-007).
- [ ] T017 [P] Verify no regression to spec 1011 scroll behavior (momentum, no-yank on incoming while scrolled up) and that the control adds no scroll-hot-path cost beyond the existing `onContentScroll`. (`src/views/detail/ChatDetailPage.vue`)
- [ ] T018 Run the quickstart manual smoke (specs/1012-scroll-to-bottom-button/quickstart.md), including **real-device** fade feel and tuning the appear-threshold / hysteresis magnitudes (emulation can't fully prove the feel — research D2 open risk).
- [ ] T019 Definition-of-done gate (Constitution VII): `npm run build`; `cd server && go build ./... && go vet ./... && go test ./...` (unchanged, must stay green); `npx vitest run`; `make db-up && npm run test:e2e` (incl. `e2e/scroll-to-latest.spec.ts`). All green = done.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no deps; start immediately.
- **US1 (P3)** → depends on Setup. **MVP.**
- **US2 (P4)** → depends on US1 (badges the same control, extends the same tap handler).
- **Polish (P5)** → depends on the stories it verifies.

### Key within-phase dependencies

- US1: T003/T004 (tests, fail first) → T005 → T006 → T007 → T008 (T006-T008 share `ChatDetailPage.vue`, so sequential).
- US2: T009/T010 (tests, fail first) → T011 → T012 → T013 → T014 (T012-T014 share `ChatDetailPage.vue`, sequential).
- `src/utils/chat-unread.ts` is created in US1 (T005, `jumpButtonVisible`) and extended in US2 (T011, `unreadSince`) — same file, so T011 follows T005.
- `src/utils/chat-unread.test.ts`: T003 (US1) lands first; T009 (US2) appends — same file, sequential.
- `e2e/scroll-to-latest.spec.ts`: T004 (US1) lands first; T010 (US2) appends — same file, sequential.

### Parallel opportunities

- **Setup**: T002 ∥ T001.
- **US1 tests**: T003 (vitest) ∥ T004 (e2e) — distinct files.
- **Polish**: T015 ∥ T016 ∥ T017 (distinct concerns); T018/T019 are the final manual + gate.

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → 2. Phase 3 US1 → 3. **STOP & VALIDATE**: T004 e2e green (hidden at bottom,
fade-in on scroll up, tap → newest, clear of composer) → 4. Demo. This alone delivers the
headline ask (a working scroll-to-latest button).

### Incremental delivery

- Setup → foundation ready.
- + US1 → the floating button (MVP).
- + US2 → unread count badge + jump-to-first-unread.
- + Polish → composer-clearance, a11y/i18n, 1011 no-regression, real-device tuning, all gates.

---

## Notes

- [P] = different files, no incomplete-task dependency. Most US tasks share `ChatDetailPage.vue`
  → sequential by necessity.
- TDD: verify each test FAILS before implementing (Constitution III).
- Client-only — no server/migration/wire tasks (Principle I untouched; no `/speckit-checklist`).
- No `DB_VERSION` change; no new index; no persisted state (all view-local).
- Commit after each task or logical group; each story is an independently testable increment.
