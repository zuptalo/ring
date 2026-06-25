---
description: "Task list for spec 2010 — navigation & notification robustness"
---

# Tasks: Navigation & notification robustness

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

**Tests**: REQUIRED. The notification ownership decision is factored into a pure predicate with unit
tests (TDD); navigation + cross-context notification behavior are covered by Playwright e2e.

**Organization**: by user story. US1 (navigation) is independent and smallest; US2 (consistent
content) + US3 (single notification / badge) share one deterministic page↔SW hand-off.

## Format: `[ID] [P?] [Story] Description with file path`

---

## Phase 1: Setup

- [x] T001 Confirm the e2e harness can (a) read `window.history.length` / current route in a tab root,
  and (b) drive a backgrounded message + observe the resulting notification path via the existing
  `__ringTest` / SW message hooks; note any hook gap to add.

## Phase 2: Foundational

- [x] T002 Add a pure, unit-testable predicate `notificationOwner(state)` (new
  `src/services/notify-policy.ts`): given app-visibility, lock state, per-chat prefs
  (content/in-app/web-push/mute), active-chat, and whether the item was push-woken, return who alerts
  — `page-banner` | `sw-notification` | `suppress` — so the page and SW agree deterministically (no
  ack-on-unlocked). Pure; no DOM/IDB.

## Phase 3: User Story 1 — Back-swipe never escapes the app (Priority: P1)

**Goal**: A back navigation from a tab root keeps the user in-app; no blank/browser view; no path
renders blank.

- [x] T003 [US1] Add a catch-all route `{ path: '/:pathMatch(.*)*', redirect: '/tabs/chats' }` at the
  end of the route table in `src/router/index.ts` (FR-002).
- [x] T004 [US1] Anchor a shell history entry beneath the tab roots so depth ≥ 2 at a fresh tab root,
  using stock routing (keep `/` as a real entry; the OS back-swipe pops to `/` → redirect bounces back
  into `/tabs/chats`). Touch `src/router/index.ts` and the app entry (`src/views/tabs/AuthPage.vue` /
  `src/main.ts`) only as needed; do NOT change `swipeBackEnabled` or `switchTab` flattening (FR-001/
  FR-003/FR-004).
- [x] T005 [US1] e2e in `e2e/navigation.spec.ts`: at a fresh tab root assert `history.length >= 2`;
  simulate a back at the tab root and assert the app stays on an in-app route (not a blank document);
  assert an unknown path resolves to `/tabs/chats`. Confirm detail-page back still returns to parent.

**Checkpoint**: back-swipe at a tab root keeps the app mounted; no blank/browser view; unknown paths
redirect.

## Phase 4: User Story 2 — Notifications consistently show the real message (Priority: P1)

**Goal**: In the unlocked state, the same chat reliably shows content per `notifyContent` — no random
generic.

- [x] T006 [US2] Write FAILING unit tests for `notificationOwner` (`notify-policy.test.ts`): unlocked
  + visible + full-content + not-active → `page-banner`; unlocked + hidden → `sw-notification`;
  active-chat / content=none / muted → `suppress`/badge per pref; push-woken item must NOT be
  suppressed by the settle window.
- [x] T007 [US2] Make the page ack deterministic in `src/App.vue`: ack `ring:handled` ONLY when the
  page actually presents an in-app banner (owner === `page-banner` AND it rendered); otherwise do not
  ack → the SW owns the OS notification. Remove the ack-on-`isUnlockedNow()` behavior (FR-007).
- [x] T008 [US2] In `src/services/notify.ts`: have `notifyIncoming` use `notificationOwner` and return
  whether it presented a banner; exclude push-woken items from the `settledUntil` suppression so a
  woken message is never swallowed-then-acked; the page no longer shows OS notifications via
  `notifyLocal` for the hand-off (the SW owns OS notifications) (FR-005/FR-006/FR-007).
- [x] T009 [US2] Fix SW timing in `src/sw.ts` + `src/services/sw-inbox.ts`: widen `SETTLE_MAX_MS`
  above `PENDING_FETCH_TIMEOUT_MS` so a decrypt within the fetch budget always upgrades the generic;
  start libsodium `ready()` + `attemptDeviceUnlock()` in PARALLEL with the `/relay/pending` fetch to
  cut cold-start latency (FR-008, cold-start edge case). Run T006 to GREEN.
- [x] T010 [US2] e2e: with a chat at full content + unlocked + backgrounded, deliver several messages
  and assert every resulting notification carries the decrypted content (no generic) and content/
  generic/badge-only each behave per setting (SC-001).

**Checkpoint**: unlocked notifications consistently honor the content setting; no random generic.

## Phase 5: User Story 3 — Exactly one notification per message; accurate badge (Priority: P2)

**Goal**: One alert per message across app states; badge accurate for every content setting.

- [x] T011 [US3] Verify/:ensure the deterministic owner yields exactly one alert: visible →
  page-banner only (SW suppressed via ack); hidden/closed → SW only (no page duplicate). Adjust
  `App.vue`/`sw.ts` hand-off if any double/zero remains (FR-006).
- [x] T012 [US3] Confirm badge accuracy across content settings (incl. badge-only/muted) in
  `src/sw.ts` / `useBadges.ts`; the badge reflects true unread even when no banner shows (FR-009).
- [x] T013 [US3] e2e: deliver a message in visible / backgrounded states and assert exactly one
  user-facing alert each, and the badge matches unread (SC-002/SC-005).

**Checkpoint**: single notification per message; badge accurate.

## Phase 6: Polish & Cross-Cutting

- [x] T014 Zero-knowledge confirmation (Principle I): no content in the push payload; SW fetch+decrypt
  over the existing sealed relay only; no server/DB/migration change (FR-011/FR-012).
- [~] T015 iOS-safe check (FR-013): the SW presents a notification per push; the badge-only path is
  iOS-acceptable. On-device confirmation via the dev deployment (a backgrounded message shows content
  consistently; a back-swipe at a tab root never shows browser chrome).
- [x] T016 Full gate: `npm run build`; `npx vitest run`; `cd server && go build/vet/test`;
  `RING_E2E_PORT=8085 npm run test:e2e` (navigation + notification + no regression to call suites).
- [x] T017 Flip spec `Status:` to `in-progress` (then `in-review` at PR) and run `make roadmap`.

## Dependencies

- **Foundational (T002)** before the notification stories. **US1 (T003–T005)** is fully independent
  and can land first. **US2 (T006–T010)** establishes the deterministic hand-off that **US3
  (T011–T013)** verifies. Polish last.

## Tracking Issues

One issue per phase/story group (the feature→develop PR must `Closes` each) — created by
`taskstoissues`.
