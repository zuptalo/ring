# Tasks: One-Tap Media Open & Inline Quick-React Bar

**Feature**: 1008-one-tap-media | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Client-only (Vue 3 + Ionic). No server, data-model, or migration changes. Tests are
Playwright e2e in the real chat view (per the constitution's TDD mandate + spec
quickstart); typecheck via `vue-tsc`.

**Story priorities**: US1 (P1) one-tap open · US2 (P1) inline quick-react ·
US3 (P2) direction-aware foot · US4 (P1) long-press menu · US5 (P2) exclusivity +
auto-dismiss.

---

## Phase 1: Setup

No setup tasks — no new dependencies, build config, or object stores. Work is on the
existing `feat/1008-one-tap-media` branch.

---

## Phase 2: Foundational (blocking prerequisites)

- [x] T001 Create `src/composables/useLongPress.ts`: a shared long-press helper
  (pointerdown→500ms timer→callback) that cancels on `pointermove` beyond a small
  threshold and on `pointerup`/`pointercancel`, and exposes a "suppress next click"
  flag so a fired long-press doesn't also trigger the bubble's `@click`.
- [x] T002 [P] Add a `dismissOpenPopovers()` helper in `src/views/detail/ChatDetailPage.vue`
  (tracks the currently-open popover handle) and call it from `onIonViewWillLeave` so
  any open quick-react/menu popover is dismissed on back **and** swipe-back (US5 base).

---

## Phase 3: US1 — One tap opens media (P1)

**Goal**: a single tap on image/video/album opens the media directly; text tap no-ops.
**Independent test**: tap each media kind → viewer/playback opens, no menu step.

- [x] T003 [US1] In `src/views/detail/ChatDetailPage.vue`, change the message bubble
  root so a single tap calls `openMediaViewer(m.id)` for image/video (non-videoNote)
  and does nothing for text/other kinds; remove the 1004 "tap opens the action menu"
  behavior from the bubble `@click`. (The menu's "View" item stays as a fallback,
  reachable via long-press.)
- [x] T004 [US1] In `src/views/detail/ChatDetailPage.vue`, keep the video poster's
  play-overlay as the explicit direct-play affordance (`@click.stop` → viewer) so a
  video bubble both opens on a plain tap and shows a clear play target; video **notes**
  keep tap-to-play inline (unchanged).
- [x] T005 [US1] In `src/views/detail/ChatDetailPage.vue`, make album cells open the
  viewer at the tapped item (`openMediaViewer(am.id)`) instead of opening the menu.
- [x] T006 [P] [US1] Update `e2e/message-menu.spec.ts`: a single tap on an image bubble
  opens `.viewer-modal` directly (no "View" step) — replacing the 1004 tap-opens-menu
  assertions for media. Video/album one-tap share the same tap handler and are covered
  by the quickstart manual smoke (seeding a video in e2e is impractical).

---

## Phase 4: US4 — Full message menu via long-press (P1)

**Goal**: long-press opens the full menu; it keeps all actions minus the inline emoji
row. **Independent test**: long-press a message → full menu with all actions.

- [x] T007 [US4] Edit `src/components/MessageActions.vue`: remove the inline quick-react
  emoji row (and its props/styles for it); keep the action list
  (reply/forward/edit/save/saveAll/copy/details/info/copy/select/delete/view).
- [x] T008 [US4] In `src/views/detail/ChatDetailPage.vue`, open the full menu
  (`openMenu`) from a **long-press** on the bubble using `useLongPress` (T001), for
  text, media, and album bubbles; call `dismissOpenPopovers()` first.
- [x] T009 [P] [US4] Refactor `src/components/VideoNote.vue` to use `useLongPress`
  (T001) instead of its inline timer (no behavior change), so there's one implementation.
- [x] T010 [P] [US4] Update `e2e/message-menu.spec.ts`: a long-press (pointerdown →
  >500ms → pointerup) on a text bubble opens the full menu (`.ma`) with its actions.

---

## Phase 5: US3 — Direction-aware bottom row (P2)

**Goal**: a slightly taller `.msg-foot` lays out time/tick and the reaction button by
direction. **Independent test**: render a sent vs received message; assert sides.

- [x] T011 [US3] In `src/views/detail/ChatDetailPage.vue`, replace the bubble's `.time`
  span with a flex `.msg-foot` row containing the reaction button and the time+tick,
  ordered by `m.outgoing` (sent → react left / time+tick right; received → time left /
  react right); apply the same foot to the album bubble.
- [x] T012 [US3] Add `.msg-foot` styles in `src/views/detail/ChatDetailPage.vue`
  (slightly taller row, alignment by direction, RTL-safe via logical properties),
  using existing theme tokens.

---

## Phase 6: US2 — Inline quick-react (7 most-used + "+") (P1)

**Goal**: the reaction button opens a transient popover of 7 most-used emoji + "+",
all visible. **Independent test**: open it, see 7 + "+", apply one, add a custom one.

- [x] T013 [US2] Create `src/components/QuickReactBar.vue`: a single non-scrolling flex
  row of 7 emoji (via the existing `Emoji` component) + a trailing `add-circle-outline`
  "+"; emits `{ action: 'react', emoji }` or `{ action: 'more' }` and dismisses the
  popover (stock Ionic + theme tokens; aria-labels).
- [x] T014 [US2] In `src/views/detail/ChatDetailPage.vue`, add `openQuickReact(m, ev)`:
  `dismissOpenPopovers()`, then present an `ion-popover` (anchored to the reaction
  button) hosting `QuickReactBar` with `await quickReactEmojis(7)`; wire `react` →
  `onReact(m.id, emoji)` and `more` → `openEmojiPicker(m)`.
- [x] T015 [US2] Wire the `.msg-foot` reaction button (`add-circle-outline`) to
  `openQuickReact(m, $event)` for message and album bubbles, with an aria-label. For an
  album, target its representative message (`item.messages[0]`), matching the existing
  album menu behavior.
- [x] T016 [P] [US2] Create `e2e/quick-react.spec.ts`: opening the reaction button shows
  7 emoji + "+" all visible (no scroll); tapping one applies it (`getReactions`); a
  custom emoji via the tally surfaces in `quickReactEmojis(7)`.

---

## Phase 7: US5 — Popups exclusive + auto-dismiss (P2)

**Goal**: only one popup open at a time; none lingers after leaving the chat.

- [x] T017 [US5] In `src/views/detail/ChatDetailPage.vue`, ensure opening the
  quick-react or the full menu first dismisses the other (via the tracked handle), so
  only one is ever open.
- [x] T018 [P] [US5] Extend `e2e/quick-react.spec.ts`: open a popover, navigate back
  (router back / swipe-back), assert no popover (`.ma` / quick-react) remains in the DOM.

---

## Phase 8: Polish & cross-cutting

- [x] T019 Run `npx vue-tsc --noEmit` + `npm run build`; fix any type/build issues.
- [x] T020 [P] Verify RTL + light/dark: the `.msg-foot` mirrors correctly and the
  quick-react popover stays fully on-screen for top/bottom-edge messages.
- [x] T021 Run the full e2e for touched areas (`message-menu`, `quick-react`,
  `reactions`, `reply`, `paste-image`, `edit-delete`) and confirm green; update the
  spec **Status** to `in-review` and run `make roadmap`.

---

## Dependencies & order

- **T001** (useLongPress) blocks T008/T009 (US4) and the tap/long-press split in T003.
- **T002** (dismissOpenPopovers) blocks T014/T017 (US2/US5) and is used by T008.
- **US3 foot (T011–T012)** hosts the **US2 reaction button (T015)** → do US3 before
  T015. US2's component (T013) and popover (T014) can be built in parallel with US3.
- **US1 (T003–T006)** and **US4 (T007–T010)** are the paired gesture rewire (tap vs
  long-press); do them adjacent.
- Parallel `[P]` tasks touch different files (new components, separate e2e specs).

## MVP / increments

- **MVP**: Foundational + US1 + US4 = the new gesture model (tap opens media,
  long-press opens the menu) — already a viable, testable slice.
- **+US3 +US2** = the inline quick-react bar (the headline UX win).
- **+US5** = the exclusivity/dismissal polish.
