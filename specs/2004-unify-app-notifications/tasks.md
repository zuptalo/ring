# Tasks: Unify in-app notifications/toasts + user-friendly "What's new"

**Branch**: `fix/2004-unify-app-notifications` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

**Input**: plan.md, research.md, data-model.md (no data model), quickstart.md. No contracts/
(internal client UI; no external interface).

**Tests**: TDD per Constitution Principle III. The one unit-testable change (`prettify`) is
written failing-first. Banner/toast rendering is verified via `drive/` screenshots (a
recorded harness limitation — no DOM-screenshot in vitest); see plan.md Constitution Check.

---

## Phase 1: Setup

- [X] T001 Confirm dev gates run clean on the branch baseline: `npm run build` (vue-tsc + vite) and `npx vitest run` both green before any change.

## Phase 2: Foundational (shared surfaces — blocks the user-story phases)

- [X] T002 Add the `'action'` notification kind to `src/services/notify.ts`: extend `IncomingKind` with `'action'`; extend `NotifyBanner` with `actions?: { text: string; role?: 'cancel'; handler: () => void }[]` and a persistent flag; add `showActionBanner({ name, body, icon, actions })` (fixed `url: 'app-update'` so re-prompts replace via the existing `pinnedUrls` dedup; pinned → exempt from `MAX_BANNERS` and the `BANNER_MS` auto-dismiss) and `dismissActionBanner(url)`.
- [X] T003 Render the action kind in `src/components/NotificationBanners.vue`: when `kind === 'action'`, show an `ion-button` row (the `actions`) under the body, reusing the existing card chrome/positioning (no avatar quick-reply) so it is pixel-identical to message/system cards.
- [X] T004 [P] Create `src/services/toast.ts` exporting `appToast({ message, duration?, color?, icon? })` → one `toastController.create({ position: 'top', cssClass: 'app-toast', duration: duration ?? 1800, color, icon, message }).present()`.

## Phase 3: User Story 1 — update prompt looks like every other notification (P1)

**Goal**: the update prompt is a rounded card below the header with working actions.
**Independent test**: trigger the prompt (drive/console) → rounded card below header, What's new / Update / Later all work, re-prompt replaces (drive screenshots, quickstart.md).

- [X] T005 [US1] In `src/composables/useAppUpdate.ts`, replace the `toastController.create({ cssClass:'app-update-toast', … })` update prompt with `showActionBanner({ name:'Update available', body: label, icon: sparklesOutline, actions:[ {text:\`What's new (N)\`, handler:→presentWhatsNew}, {text:'Update', handler:→updateServiceWorker(true)}, {text:'Later', role:'cancel', handler:→dismissActionBanner} ] })`. Keep the `WhatsNewSheet` modal + the foreground re-prompt + the `prompting` guard.
- [X] T006 [US1] Remove the now-dead `ion-toast.app-update-toast` CSS block from `src/App.vue`.
- [X] T007 [US1] Verify via `drive/` (live `make start`): update card renders rounded, below header, with the three actions; dismiss + foreground re-prompt shows a single card (no stack). Capture screenshots (quickstart.md). Covers SC-001.

## Phase 4: User Story 2 — all notification cards share one surface (P1)

**Goal/Independent test**: a single styling change to the shared card updates all four kinds.
(Satisfied structurally by Phase 2/3 — the update prompt now flows through the same overlay.)

- [X] T008 [US2] Confirm the four kinds (message/request/system/action) all render through `NotificationBanners.vue` with one shared style block (no per-surface position/corner CSS remains); note it in the PR. Covers SC-002.

## Phase 5: User Story 3 — functional toasts are mutually consistent (P2)

**Goal**: confirmation/error toasts share one helper (position, rounding, default duration).
**Independent test**: trigger several toasts from different screens → uniform; one helper change updates all.

- [X] T009 [US3] Add the `ion-toast.app-toast` style to `src/App.vue` (rounded corners + below-header offset) — the single tuning point for functional toasts.
- [X] T010 [P] [US3] Migrate confirmation/error `toastController.create` call sites to `appToast(...)` in: `src/views/tabs/WallPage.vue`, `src/views/tabs/ContactsPage.vue`.
- [X] T011 [P] [US3] Migrate in: `src/views/detail/ChatDetailPage.vue`, `src/views/detail/PostDetailPage.vue`, `src/views/detail/ContactDetailPage.vue`.
- [X] T012 [P] [US3] Migrate in: `src/views/detail/AddByIdPage.vue`, `src/views/detail/ContactQrPage.vue`, `src/views/detail/ScanPage.vue`, `src/views/detail/DirectoryPage.vue`, `src/views/detail/SelfTestPage.vue`.
- [X] T013 [P] [US3] Migrate in: `src/components/ChatListItem.vue`, `src/composables/useCall.ts`, `src/composables/useConnect.ts`, and the error-path toast in `src/components/NotificationBanners.vue`.
- [X] T014 [US3] Confirm only the documented exceptions still call `toastController.create` directly (App.vue sticky failed-sends with its own buttons; the update prompt is now a banner). Covers SC-003.

## Phase 6: User Story 4 — "What's new" reads as plain language (P2)

**Goal**: no internal spec/issue reference text in "What's new".

- [X] T015 [US4] Add FAILING `prettify` tests to `src/services/release-notes.test.ts`: `"(spec 1013 US2/US3)"` stripped; `"(+ flaky test fix)"` stripped; a no-reference subject returned unchanged. Run `npx vitest run` and confirm they fail.
- [X] T016 [US4] In `src/services/release-notes.ts`, broaden `TRAILING_REF` to `\((?:spec\s*\d+[^)]*|#\d+|gh-\d+)\)\s*$` and add a trailing `\s*\(\+[^)]*\)\s*$` strip; re-run `npx vitest run` until green. Covers SC-004.

## Phase 7: User Story 5 — governance keeps release notes user-friendly (P2)

- [X] T017 [P] [US5] Amend `.specify/memory/constitution.md` Principle VII (Quality Gates): require user-facing commit types (feat/fix/perf/security) to have plain-language, benefit-focused, jargon-free, reference-free subjects (they become "What's new"). Bump version `1.1.0 → 1.2.0` (Sync Impact header + footer "Last Amended").
- [X] T018 [P] [US5] Add a "Release-note subjects for end users" note (good/bad example) under "Commit messages" in `CLAUDE.md`. Covers SC-005.

## Phase 8: Polish & cross-cutting

- [X] T019 Run the full client gate: `npm run build` (vue-tsc + vite) and `npx vitest run` — both green.
- [X] T020 Set spec `**Status**: in-progress` (→ shipped on merge) and run `make roadmap`; confirm `git diff` of ROADMAP.md is intended (never hand-edit).

---

## Dependencies
- Phase 2 (T002–T004) blocks Phase 3/5.
- T002 → T003 → T005/T006 (same overlay; sequential).
- T004 → T009 → T010–T013 (helper + style before migrations).
- T015 (failing test) → T016 (implementation).
- Phase 7 (T017/T018) is independent (docs) — parallel-safe.

## Parallel example
- After T004+T009: T010, T011, T012, T013 touch disjoint files → run together.
- T017 and T018 (docs) → run together.

## MVP
US1 (T002, T003, T005–T007) — fixes the reported broken update prompt.
