---
description: "Task list for Reliable Push & Redesigned In-App Notifications"
---

# Tasks: Reliable Push & Redesigned In-App Notifications

**Input**: Design documents from `specs/1015-reliable-push-notifications/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED. Constitution Principle III (TDD) mandates failing tests
before implementation; new/changed crypto + HTTP-handler logic ships unit tests,
new user-facing behavior ships e2e. Visual behavior is verified via the
`showcase/` capture harness. Test tasks are ordered before their implementation.

**Organization**: Tasks are grouped by user story (priority order from spec.md)
so each story is an independently implementable, testable increment.

**GitHub issues** (zuptalo/ring — grouped one-per-phase; the develop PR MUST list
`Closes #N` for each): Setup #240 · Foundational #241 · US1 #242 · US2 #243 ·
US3 #244 · US4 #245 · US5 #246 · Polish #247.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 (setup/foundational/polish carry no story label)
- Exact file paths included in each task

## Path notes

- Client (Vue PWA) at repo root: `src/…`; e2e at `e2e/…`; visual at `showcase/…`
- Server (Go) at `server/internal/…`
- Gates (run before claiming done): `npm run build`; `cd server && go build ./... && go vet ./... && go test ./...`; `npm run test:e2e` (needs `make db-up`); `npm run showcase` (review artifacts)

---

## Phase 1: Setup (Shared test scaffolding)

**Purpose**: Make notification behavior drivable + assertable in the existing harnesses.

- [x] T001 [P] Extend the dev test hook to drive notification scenarios (force "no live socket"/closed-app state, trigger an in-app banner, and read `notifyBanners`) in `src/services/testhook.ts` (keep it guarded/stripped from prod; `notifyBanners` is already exposed at line ~213)
- [x] T002 [P] Add shared notification e2e helpers (background/close-app simulation, read the in-app banner, and `getBoundingClientRect` for banner/header/composer/call-control) in `e2e/helpers.ts`

**Checkpoint**: Tests can stage and inspect notifications across all stories.

---

## Phase 2: Foundational (Per-chat preference data layer — shared by US4 + US5)

**Purpose**: The device-local per-chat preference layer that User Stories 4 and 5
build on. **US1, US2, US3 do NOT depend on this phase** and may proceed in parallel.

**⚠️ Blocks**: US4 and US5 only.

- [x] T003 Add optional per-chat fields `notifyWebPush?`, `notifyInApp?`, `notifyContent?: 'full'|'generic'|'none'` to `interface Chat` in `src/db/types.ts` (alongside existing `mutedUntil?`; document as device-local, never synced)
- [x] T004 Add per-chat notification preference getter/setter with read-time defaults (web push=true, in-app=true, content='full') in `src/db/queries.ts` (depends on T003; persists via the existing chat-update path, excluded from own-data sync like `mutedUntil`)
- [x] T005 Create `src/services/notify-prefs.ts` — a read-through cache for per-chat prefs + the global `notifications.inapp.enabled` flag, refreshed on the `chats` + `settings` change bus (mirrors the `NotifyPrefs` cache pattern in `src/services/notify.ts`; depends on T004)
- [x] T006 [P] Add the global "In-app notifications" master toggle `notifications.inapp.enabled` (default true) to the Notifications screen in `src/settings/schema.ts`

**Checkpoint**: Per-chat + global in-app preferences are readable/writable client-side.

---

## Phase 3: User Story 1 - Reliable delivery + complete decryption (Priority: P1) 🎯 MVP

**Goal**: Backgrounded/closed recipients get a notification with real decrypted
content; nothing is silently dropped before display; no duplicates; clean
content-free fallback when locked/undecryptable.

**Independent Test**: Background the app, send a message → rich notification within
seconds; lock → generic fallback, content on unlock; inject display failure → item
not lost.

### Tests for User Story 1 (write first, must FAIL)

- [x] T007 [P] [US1] Extend `e2e/sw-decrypt.spec.ts`: full decrypted sender+text when unlocked (FR-002); content-free generic when locked (FR-004); malformed/undecryptable → generic, never garbled (FR-004a)
- [ ] T008 [P] [US1] New `e2e/notifications-delivery.spec.ts`: an item is acked only after durable persist + notify-dispatch (FR-005); exactly one notification across page + service worker (FR-006/SC-009); not dropped under injected display failure, surfaces on next open (SC-003)

### Implementation for User Story 1

- [x] T009 [US1] Harden the read-only preview path for completeness + malformed fallback (full text, correct sender, no ratchet advance; degrade to generic on any decrypt error/partial) in `src/services/sw-inbox.ts` and `src/sw.ts` (FR-002/FR-003/FR-004/FR-004a)
- [x] T010 [US1] Enforce ack-after-persist-and-notify ordering on the relay drain/ack path in `src/composables/useSync.ts` (and the drain helper in `src/db/queries.ts`) so the WS `ack`/`POST /v1/relay/ack` fires only after the message is persisted and its notification dispatched/intentionally suppressed (FR-005)
- [x] T011 [US1] Verify/harden single-notification dedup between the live page (`ring:drain`/`ring:handled`) and the service worker, preferring the content-bearing notification, in `src/sw.ts` and `src/composables/useSync.ts` (FR-006)
- [x] T012 [P] [US1] Audit notification code paths to guarantee no decrypted content/identity/preference appears in any log/metric/error (FR-007a) across `src/sw.ts`, `src/services/sw-inbox.ts`, `src/services/notify.ts`, and `server/internal/push/push.go`

**Checkpoint**: US1 fully functional and independently testable (MVP).

---

## Phase 4: User Story 2 - Friend-request lifecycle push (Priority: P1)

**Goal**: Offline users are woken for connection request/accept/reject via a
content-free `conn` tickle; the client renders identity-safe notifications.

**Independent Test**: With B closed, A sends a request → B is pushed; B accepts/
rejects with A closed → A is pushed.

### Tests for User Story 2 (write first, must FAIL)

- [x] T013 [P] [US2] Extend `server/internal/push/push_test.go`: `NotifyConn` sends a content-free `{"t":"conn"}` tickle to every subscription of the target user (fake sender), and is a no-op on a nil notifier
- [x] T014 [P] [US2] Extend `server/internal/api/connections_handlers_test.go`: `requestConnection`/`acceptConnection`/`rejectConnection` each invoke `Notifier.NotifyConn` for the correct user (fake notifier), preserving existing live-frame behavior
- [ ] T015 [P] [US2] Extend `e2e/friendship.spec.ts` (and `e2e/connect.spec.ts`): a closed recipient receives a friend-request notification intent; accept/reject notifies the requester; an unknown inbound requester yields a generic identity-safe label, never a raw id (FR-012a)

### Implementation for User Story 2

- [x] T016 [US2] Add `connParams()` (`{"t":"conn"}`, topic `ring-conn`, high urgency) and `NotifyConn(ctx, userID)` to `server/internal/push/push.go`
- [x] T017 [US2] Add `NotifyConn(ctx, userID)` to the `Notifier` interface in `server/internal/ws/hub.go` (and confirm `Handlers.Notifier` in `server/internal/api/router.go` still satisfies it via `*push.Notifier`)
- [x] T018 [US2] Fire `h.Notifier.NotifyConn(...)` after the existing `notifyConn(...)` live-frame send in `requestConnection`/`acceptConnection`/`rejectConnection` in `server/internal/api/connections_handlers.go` (depends on T016, T017)
- [x] T019 [US2] Decode the `conn` kind in `src/sw.ts` `pushKind()` and show a generic, identity-safe notification by syncing connection state (`GET /v1/connections`) in `src/services/sw-inbox.ts`, deep-linking to requests/contact (FR-008/FR-011/FR-012a). Make it **idempotent**: a duplicate/re-pushed `conn` tickle or a repeated state sync MUST NOT produce a second notification for the same unchanged event (Edge Case "friend-request decision races")
- [x] T020 [US2] Resolve the peer name for `connect-update` accept/reject (known locally to the requester) and use a generic label for an unknown inbound request in `src/composables/useSync.ts` (currently passes the literal "Someone") (FR-009/FR-010/FR-012a). Ensure a rejected-then-resent or multi-device-accepted race yields no contradictory/duplicate outcome notification (dedup on the connection state transition, Edge Case "friend-request decision races")

**Checkpoint**: US2 works independently; US1 still green.

---

## Phase 5: User Story 3 - Redesigned in-app banner (Priority: P2)

**Goal**: Translucent greenish, dismissible banner anchored below the header, never
covering the header/composer/call controls.

**Independent Test**: Trigger a banner on the chats list, inside a chat, and on a
call screen → green translucent, below header, dismissible, no overlap.

### Tests for User Story 3 (write first, must FAIL)

- [x] T021 [P] [US3] New `e2e/notifications-inapp.spec.ts` banner-geometry block: assert `getBoundingClientRect` of the banner has zero intersection with the header/back, composer, and call controls on phone + desktop viewports (SC-005/FR-014); also assert non-overlap with **≥2 stacked banners** present (FR-017/US3 AS5); explicit dismiss removes it and it does not reappear for the same event (FR-015/FR-016)
- [ ] T022 [P] [US3] Extend `showcase/capture.spec.ts`: stage and screenshot the banner on (a) the chats list, (b) an open chat with the composer visible, (c) the active-call screen — in light + dark across iphone/ipad/android/desktop (FR-013/FR-014); hold the banner synchronously before capture (auto-dismiss ~4.5s)

### Implementation for User Story 3

- [x] T023 [US3] Restyle `src/components/NotificationBanners.vue`: translucent green from `--ion-color-primary` / existing `--ring-*` tokens, legible light + dark (FR-013); anchor offset below the header so it clears the toolbar/back, composer, and call controls (FR-014); add an always-visible close affordance alongside the existing swipe/grab dismiss (FR-015); preserve dedup, cap, pinned-reply, gesture, and bidi behavior (FR-017)

**Checkpoint**: US3 visually verified via showcase + geometry assertion; US1/US2 green.

---

## Phase 6: User Story 4 - Global + per-chat in-app toggles (Priority: P2)

**Goal**: Turn in-app notifications off globally, and off for an individual chat.

**Independent Test**: Global off ⇒ no banners anywhere; per-chat off ⇒ that chat
silent in-app, others banner normally.

**Depends on**: Phase 2 (per-chat preference data layer).

### Tests for User Story 4 (write first, must FAIL)

- [x] T024 [P] [US4] Extend `e2e/notifications-inapp.spec.ts`: global `notifications.inapp.enabled` off ⇒ zero banners while system push/badge unaffected (FR-018); per-chat in-app off ⇒ banners suppressed for that chat only (FR-019)

### Implementation for User Story 4

- [x] T025 [US4] Honor the global `notifications.inapp.enabled` flag and per-chat `notifyInApp` in `notifyIncoming` in `src/services/notify.ts` (read via `notify-prefs.ts`; depends on T005) (FR-018/FR-019). The global master switch MUST also suppress **friend-request** in-app banners (kind `request`), per the FR-008/FR-018 precedence — while friend-request **web push** still fires (T019 is independent of this flag)
- [x] T026 [P] [US4] Add a per-chat "Notifications" section with an in-app toggle (stock `ion-list`/`ion-item`/`ion-toggle`) to `src/views/detail/ContactDetailPage.vue` (1:1) (FR-019/FR-020)
- [x] T027 [P] [US4] Add the same per-chat "Notifications" section to `src/views/detail/GroupInfoPage.vue` (groups — FR-021 scope) (FR-019/FR-020)

**Checkpoint**: US4 works; prior stories green.

---

## Phase 7: User Story 5 - Per-chat notification privacy controls (Priority: P3)

**Goal**: Per-chat web-push on/off and content visibility (full/generic/none, where
none = badge-only); per-chat web-push-off/mute also silences that chat's calls.

**Independent Test**: content=none ⇒ badge only; generic ⇒ placeholder; full ⇒
preview; web-push-off ⇒ no system notif + no call ring for that chat.

**Depends on**: Phase 2 (data layer) and Phase 6 (shared per-chat UI section).

### Tests for User Story 5 (write first, must FAIL)

- [x] T028 [P] [US5] Extend `e2e/notifications-inapp.spec.ts`: content=none ⇒ badge increments, no banner/text (SC-007/FR-024); generic ⇒ placeholder; full ⇒ decrypted preview; web-push-off ⇒ no system notification for that chat (FR-021/FR-022); muted/web-push-off ⇒ no call ring on the page path (FR-022a)

### Implementation for User Story 5

- [x] T029 [US5] Enforce per-chat `notifyWebPush` + `notifyContent` (most-private-wins) on the service-worker path — read prefs from IndexedDB and suppress/redact before `showNotification` — in `src/services/sw-inbox.ts` and `src/services/push.ts` (`notifyLocal`) (FR-021/FR-022/FR-023/FR-024)
- [x] T030 [US5] Enforce per-chat content visibility (full/generic/none) on the page path in `src/services/notify.ts` (none ⇒ badge-only, no banner/system text) (FR-022/FR-024)
- [x] T031 [US5] Call-mute (FR-022a): hard-enforce on the page/call path where the caller/chat is resolvable, and best-effort fail-open in the service worker when the caller can't be resolved from the content-free `call` tickle, in `src/sw.ts` / `src/services/sw-inbox.ts` and the call-handling path (`src/composables/useSync.ts` and the call composable/service under `src/composables/useCall.ts` / `src/services/call/` — confirm the exact incoming-call entry point during implementation)
- [x] T032 [P] [US5] Add the web-push toggle + content-visibility control (stock `ion-toggle` + `ion-radio-group`/`ion-segment`) to the per-chat Notifications section in `src/views/detail/ContactDetailPage.vue` and `src/views/detail/GroupInfoPage.vue` (depends on T026, T027) (FR-021/FR-022)

**Checkpoint**: All user stories independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T033 [P] Graceful denied/revoked OS-permission handling — in-app + badge keep working, user is guided to re-enable system notifications — in `src/services/notifications.ts` and the relevant onboarding/settings UI (FR-028)
- [x] T034 [P] Update `e2e/README.md` coverage and `showcase/README.md` to list the new notification specs + banner capture states
- [x] T035 Run all gates and `quickstart.md` validation US1–US5: `npm run build`; `cd server && go build ./... && go vet ./... && go test ./...`; `npm run test:e2e`; review `npm run showcase` banner artifacts (light/dark × devices)
- [ ] T036 Manual cross-device push pass on installed iOS + Android PWAs: 20 trials/platform for message push (SC-001), content correctness (SC-002), and friend-request push (SC-004); record results (Web Push wake can't run headless). Explicitly exercise the transport-reliability edge cases that have no automated coverage (FR-001): iOS `pushsubscriptionchange` / re-subscribe-on-foreground, dead-subscription pruning + revalidation (`src/services/push.ts` `revalidatePushSubscription`), and recovery after a throttled/failed push — confirm a device that quietly lost its subscription self-heals and still receives a later push

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; **blocks US4 + US5 only** (not US1/US2/US3).
- **US1, US2, US3**: depend only on Setup → can run in parallel with each other and with Phase 2.
- **US4**: depends on Phase 2.
- **US5**: depends on Phase 2 + US4 (shared per-chat UI section).
- **Polish (Phase 8)**: after the desired stories are complete.

### Story dependencies

- US1 (P1), US2 (P1), US3 (P2): independent of each other.
- US4 (P2): needs the per-chat data layer (Phase 2).
- US5 (P3): needs Phase 2 and the US4 chat-settings section (T026/T027) for T032.

### Within each story

- Tests first and FAILING, then implementation (Red → Green).
- Server: interface (T017) before its handler call sites (T018); method (T016) before both.
- Client: data layer (Phase 2) before consumers; shared UI section (US4) before US5's controls.

### Parallel opportunities

- T001 ∥ T002 (setup).
- T006 ∥ rest of Phase 2 after T005.
- US1 test T007 ∥ T008; US2 tests T013 ∥ T014 ∥ T015.
- US1/US2/US3 can be developed concurrently by different people.
- T026 ∥ T027 (different view files); T012, T022, T033, T034 are [P].

---

## Parallel Example: User Story 2

```bash
# Write the failing tests together:
Task: "Extend server/internal/push/push_test.go for NotifyConn tickle"
Task: "Extend server/internal/api/connections_handlers_test.go for NotifyConn wiring"
Task: "Extend e2e/friendship.spec.ts for closed-recipient friend-request push"

# Then implement server method + interface before the handler call sites:
Task: "Add connParams() + NotifyConn to server/internal/push/push.go"
Task: "Add NotifyConn to Notifier interface in server/internal/ws/hub.go"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 (Setup) → 2. US1 (decryption completeness + ack ordering + dedup +
   fallback) → 3. **STOP and validate** US1 independently → demo: reliable, real-
   content notifications that are never silently dropped.

### Incremental delivery

1. Setup → US1 (MVP) → US2 (friend-request push) → US3 (banner redesign) → then
   Phase 2 + US4 (toggles) → US5 (per-chat privacy) → Polish.
2. Each story is a shippable increment; per-chat work (US4/US5) is gated on the
   Phase 2 data layer.

### Notes

- [P] = different files, no incomplete-task dependency.
- Keep the zero-knowledge invariant in every wire-touching change (push stays
  content-free; per-chat prefs never synced).
- Run `go vet` + the typecheck before finishing each task; commit per task/group.
- The `/speckit-checklist` `security.md` gate must stay clean (or be waived) before
  `/speckit-implement`.
