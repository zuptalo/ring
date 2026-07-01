# Tasks: App-wide UX polish and fixes

**Feature**: 1025-app-ux-polish | **Branch**: `feat/1025-app-ux-polish`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Nine independent user stories (P1–P3). Each phase is a standalone, testable slice and can be
implemented and shipped on its own. Tests come before or with the implementation they cover
(constitution III). `[P]` = parallelizable (different files, no ordering dependency).

## Phase 1: Setup

- [ ] T001 Confirm branch `feat/1025-app-ux-polish` is checked out and green baseline (`npm run build`) before edits.

## Phase 2: Foundational (shared helpers used by later stories)

- [ ] T002 [P] Add `formatDay(ts)` → `YYYY-MM-DD` in `src/utils/time.ts`, with a `src/utils/time.test.ts` case (unit).
- [ ] T003 [P] Add `computeCallTotals(calls)` in `src/utils/call-totals.ts` (audio/video minutes, audio/video/combined bytes; missing bytes → 0), with `src/utils/call-totals.test.ts` (unit).

## Phase 3: US1 — Deep-link back navigation (P1)

- [ ] T004 [US1] Add `e2e/deeplink-back.spec.ts`: simulate a cold-start deep link (seed pending-nav / navigate to a `/chat/:id` and `/tabs/wall` with empty history) then Back → resolves to `/tabs/chats` (fails first).
- [ ] T005 [US1] In `src/App.vue` `routeRelevant`, when routing a cold-start deep-link target, seed `/tabs/chats` into history before pushing the target (replace to Chats, then push).
- [ ] T006 [US1] In `src/main.ts`, adjust the base-history seed so a deep-link landing keeps `/tabs/chats` as the underlying entry (non-`/tabs/*` landing). Verify T004 passes.

## Phase 4: US2 — Notification preview wiring + hidden precedence (P1)

- [ ] T007 [US2] Add `e2e/notification-preview.spec.ts`: with `notifications.showPreview` off, the in-app/background note title+body are generic; a hidden chat stays generic even with preview on (fails first).
- [ ] T008 [US2] In `src/services/notify.ts`, genericize the notification TITLE (not just body) when `showPreview` is off for non-hidden chats; keep the hidden early-return branch first.
- [ ] T009 [US2] In `src/services/sw-inbox.ts`, genericize the background notification title when preview is off; keep the hidden generic branch first. Verify T007 passes.

## Phase 5: US3 — Hidden-chat swipe reveal (P2)

- [ ] T010 [US3] In `src/components/ChatListItem.vue`, make `.hidden-row` background OPAQUE (composite the hidden tint over a solid themed base) so swipe reveals buttons cleanly with no bleed-through.
- [ ] T011 [US3] Verify via the drive harness: unlock hidden chats, swipe a row, confirm opaque row + buttons only in the revealed area (screenshot).

## Phase 6: US4 — Media viewer video poster (P2)

- [ ] T012 [US4] In `src/views/detail/ChatDetailPage.vue`, for the full-screen viewer `thumb`, prefer the large `posterUrl` (posterBlob) over `stripUrl` for video items.
- [ ] T013 [US4] In `src/components/VideoPlayer.vue`, give `.vid-el` `width:100%; height:100%; object-fit:contain` so the poster fills the frame.
- [ ] T014 [US4] Verify via the drive harness: a video in the viewer fills the frame with a centered play control (screenshot).

## Phase 7: US5 — Disappearing countdown placement (P2)

- [ ] T015 [US5] In `src/views/detail/ChatDetailPage.vue`, add spacing between the timestamp and `.ttl-left`, and under `.msg-foot.in` reorder so the countdown sits to the RIGHT of the timestamp for incoming messages.
- [ ] T016 [US5] Verify via the drive harness: incoming vs outgoing disappearing messages show correct spacing + side (screenshot).

## Phase 8: US6 — Calls list + detail (P2)

- [ ] T017 [US6] Add `e2e/calls-summary.spec.ts`: seed audio+video calls, assert `YYYY-MM-DD` dates, swapped Video/Message button order on detail, and totals (audio minutes, video minutes, data per kind + combined) (fails first).
- [ ] T018 [US6] In `src/views/tabs/CallsPage.vue`, use `formatDay` for dates and render a totals summary from `computeCallTotals`.
- [ ] T019 [US6] In `src/views/detail/CallDetailPage.vue`, use `formatDay` for dates and swap the Video and Message action columns (Video → Audio → Message). Verify T017 passes.

## Phase 9: US7 — Single Animations setting, honored (P3)

- [ ] T020 [US7] Add `e2e/animations-setting.spec.ts`: exactly one Animations entry in Settings; toggling `chats.animGifs` off suppresses GIF autoplay (fails first for the GIF wiring).
- [ ] T021 [US7] In `src/settings/schema.ts`, remove one of the duplicate `Animations` link entries (keep the Appearance one; drop the Chats one, or vice versa) leaving a single source of truth.
- [ ] T022 [US7] In `src/directives/autoplay-visible.ts`, honor `chats.animGifs` (in addition to `prefers-reduced-motion`) so turning it off stops GIF autoplay. Verify T020 passes.

## Phase 10: US8 — Remove dead Vibrate toggle (P3)

- [ ] T023 [US8] In `src/settings/schema.ts`, remove the `notifications.inapp.vibrate` toggle from the In-app notifications screen (no empty gap left).
- [ ] T024 [US8] In `src/services/notify.ts`, remove the now-unused `inappVibrate` pref and the `navigator.vibrate` call (or leave a single unconditional best-effort with no setting); ensure no dangling references.

## Phase 11: US9 — Help screen cleanup (P3)

- [ ] T025 [US9] In `src/settings/schema.ts`, change the Help `Version` stat from the hardcoded `'0.1.0'` to `__APP_VERSION__`; keep the (meaningful) Run self-test.

## Phase 12: Polish & gates

- [ ] T026 Run `npm run build` (typecheck) and `npx vitest run`; fix any breakage.
- [ ] T027 Run the affected e2e specs locally (deeplink-back, notification-preview, calls-summary, animations-setting) to green.
- [ ] T028 Bump the spec Status to `in-review`, run `make roadmap`, and confirm the roadmap guard is satisfied.

## Dependencies / ordering

- Phase 2 (T002, T003) precedes US6 (T018/T019 use the helpers).
- Within each story, the test task precedes its implementation task(s).
- Stories are otherwise independent and may be implemented in any order; US1 and US2 (P1) first for MVP value.
