# Tasks: Incoming Call & Friend-Request Notifications — Identity, Badge, and Missed-Call Trace

**Input**: Design documents from `/specs/1040-incoming-call-notifications/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R8), data-model.md, contracts/

**Tests**: REQUIRED (constitution Principle III) — every phase orders failing
tests before the implementation that satisfies them.

**Organization**: grouped by user story; stories are independently testable
increments. US1/US2/US4/US5 share the `callEvent` foundation (Phase 2); US3 is
fully independent of it.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Create the pure module skeleton `src/services/call-events.ts` (exported types for `CallEventPayload`, badge units, reconcile decisions; no logic yet) and empty test file `src/services/call-events.test.ts` wired into vitest

---

## Phase 2: Foundational — sealed `callEvent` frame (blocks US1, US2, US4, US5)

**Purpose**: the marker type, its pure logic, and the sender sites; nothing
user-visible yet.

- [x] T002 [P] Write failing vitest specs in `src/services/call-events.test.ts` for marker construction/validation (ring + ended shapes per contracts/call-event.md), freshness/staleness against the ring window, and the reconcile decision table from data-model.md (ended/missed creates, ended/answered clears, stale ring → missed, existing-row wins)
- [x] T003 Add the optional `callEvent` field (typed, documented) to `MessagePayload` in `src/services/crypto/message.ts` per contracts/call-event.md — types + doc comment only, no behavior
- [x] T004 Implement `src/services/call-events.ts` pure logic to green T002: `buildRingEvent`/`buildEndedEvent`, `isRingStale`, `reconcileCallEvent(pending, existingRow, outcome)`, and badge-unit transition helpers (`applyCallTickle`, `applyOutcome`, `clearUnits`, stale sweep)
- [x] T005 Wire fire-and-forget marker sends in `src/composables/useCall.ts`: `ring` at 1:1 dial and per-invitee at group ring start; `ended/missed` at the caller no-answer timeout; `ended/cancelled` on caller cancel; `ended/answered` on answer — reusing the existing sealed payload-only send path (same class as reactions), never blocking call setup

**Checkpoint**: `npx vitest run src/services/call-events.test.ts` green;
`npm run build` green; wire behavior unchanged for old receivers.

---

## Phase 3: User Story 1 — Know who is calling from the notification (P1) 🎯 MVP

**Goal**: closed-app ring shows "📹/🎙️ \<Name\> is calling you" (group: "…is
calling in \<Group\>"); generic fallback when locked/unresolvable/hidden.

**Independent test**: quickstart step 2 on a real device; vitest for every
note variant.

- [x] T006 [P] [US1] Write failing vitest specs in `src/services/sw-inbox.calls.test.ts` for the call-note builder: 1:1 audio/video named copy, group copy with group-name resolution via `roomId`, hidden-chat → generic, unresolvable identity → generic, raw-id never shown (FR-006)
- [x] T007 [US1] Implement the call-note builder in `src/services/sw-inbox.ts`: recognize `callEvent` ring frames in the preview path (`noteForPayload`/a dedicated `previewCallRing`), resolve caller/group names from local stores, apply the hidden-chat gate before naming, return the note or null
- [x] T008 [US1] Update the `{"t":"call"}` wake path in `src/sw.ts`: run a bounded pending preview for a fresh ring marker; show the named ring (same `tag: 'ring-call'`, `renotify`, `requireInteraction`) or today's generic; re-ring wakes re-run the preview so identity upgrades in place (research R2); never delay the first alert (FR-004). NOTE: the `swNotifiedIds` shown-ledger dedups message notes — ring notes must stay re-buildable from the same pending marker across reminder wakes
- [ ] T009 [US1] Verify on the dev stack per quickstart.md step 2 (named audio, named video, group, and locked-device generic fallback); record results in the PR description

**Checkpoint**: US1 delivers standalone value (named rings) with zero
missed-call/badge behavior yet.

---

## Phase 4: User Story 2 — Every missed call leaves a trace (P2)

**Goal**: unanswered calls always produce the existing call-log trace (chat
row + Calls tab), even when the app never ran during the ring; unanswered
rings are replaced by a "Missed call from \<name\>" notification.

**Independent test**: e2e spec drives an unanswered 1:1 call and asserts the
trace; device pass per quickstart step 3.

- [x] T010 [P] [US2] Extend `src/services/call-events.test.ts` with failing specs for receive-side integration decisions: dedup against a live-logged `calls` row (FR-018), group placement via `roomId` (group chat vs Calls-tab-only), declined/answered-elsewhere never logged as missed (FR-016)
- [x] T011 [P] [US2] Write failing e2e spec `e2e/missed-call-trace.spec.ts`: account A calls account B (B never answers), A's no-answer timeout ends the attempt, then B (app open, or reopened) shows the missed-call row in the 1:1 chat and the Calls tab entry with the missed badge until viewed (FR-013/014/017)
- [x] T012 [US2] Implement the `callEvent` receive branch in `src/db/queries.ts` `receiveIncomingInner` (silent side-effect pattern, no chat bubble): pending-ring bookkeeping, `ended/missed|cancelled` → missed `calls` row + `logCallToChat` placement per data-model.md, `ended/answered` → clear pending, plus stale-ring reconciliation on drain/open; idempotent by `callId`, never overwrites, hidden-chat exclusions intact
- [x] T013 [US2] Implement the missed-replacement in `src/services/sw-inbox.ts` + `src/sw.ts`: preview of `ended/missed|cancelled` shows "☎️ Missed call from \<Name\>" reusing the `ring-call` tag (FR-012/FR-012a) with chat deep-link (Calls tab when no chat resolves); `ended/answered` closes the ring notification and ends the wake via the quiet terminal (iOS visible-ending rule)
- [x] T014 [US2] Run the new e2e spec green (`npm run test:e2e -- missed-call-trace`) and the quickstart step-3 device pass; verify no duplicate rows when B was open the whole ring

**Checkpoint**: missed calls are never lost; ring notifications never go stale.

---

## Phase 5: User Story 3 — Friend-request outcomes are announced truthfully (P3)

**Goal**: acceptance shows "\<Name\> accepted your friend request", never "New
friend request"; fallback copy is event-neutral. Fully independent of Phases
2–4.

**Independent test**: Go handler test + vitest for the SW path + quickstart
step 5.

- [x] T015 [P] [US3] Write failing Go tests (fake store + handler) in `server/internal/api/connections_handlers_test.go` and the store fake: outgoing set includes `accepted` rows updated within 24h, excludes older accepted rows, keeps pending/rejected unchanged, DTO passes state through (contracts/connections-api.md)
- [x] T016 [US3] Change `OutgoingRequests` in `server/internal/store/connections.go` to include `state = 'accepted' AND updated_at > now() - interval '24 hours'`; update the in-memory fake store to match; `go build ./... && go vet ./... && go test ./...` green
- [x] T017 [P] [US3] Write failing vitest specs (mocked fetch) in `src/services/sw-inbox.calls.test.ts` or a sibling file for `previewConnections`: accepted outgoing row → "accepted your friend request" note named via public profile, dedup ledger announces at most once (FR-022), rejected unchanged
- [x] T018 [US3] Neutralize the fallback placeholder in `src/sw.ts` (`showConnNotification`): title/body copy that does not claim a new incoming request (e.g. "Contact updates" / "Tap to review" — app voice, no em-dashes), same tag/url; confirm the incoming-request path still says "wants to be friends" (FR-020/FR-021)
- [ ] T019 [US3] Verify end-to-end per quickstart step 5 on the dev stack (request → accept with requester's app closed → named accepted notification; decline path shows declined copy)

**Checkpoint**: the reported bug is dead: 0% of acceptances can render "New
friend request" copy.

---

## Phase 6: User Story 4 — A ringing call badges the app icon once (P4)

**Goal**: first ring notification adds exactly one badge unit; re-rings never
add more; ringing→missed hands over the same unit.

**Independent test**: vitest transition table; device badge observation per
quickstart step 2/3.

- [x] T020 [P] [US4] Extend `src/services/call-events.test.ts` with failing badge-unit specs: first tickle appends (FR-007), fresh-window/`callId` dedup on re-ring (FR-008), two distinct calls → two units, ringing→missed flip keeps one unit (FR-010), answered removes, stale sweep drops
- [x] T021 [US4] Implement `sw.callBadge` units in the SW: persist units in the idb `settings` store (shared-key pattern), include `units.length` in `updateAppBadge`'s total in `src/sw.ts`, append on call wake (marker `callId` when decryptable, ring-window heuristic otherwise), flip/remove on outcome preview (uses T004 helpers)
- [ ] T022 [US4] Device verification: badge N → N+1 across a full re-ringing unanswered call, N+2 for two distinct calls (quickstart steps 2–3); note results in the PR

**Checkpoint**: badge is truthful while the app is closed.

---

## Phase 7: User Story 5 — Opening the app clears the ring's footprint (P5)

**Goal**: open during ring → notification swept, badge unit gone, no further
OS notifications while the app handles the ring.

**Independent test**: quickstart step 4; unit coverage of the clearing helper
already in T020.

- [x] T023 [US5] Extend the foreground sweep in `src/composables/useAppBadge.ts` to clear `sw.callBadge` units (ringing AND missed — the `calls` store owns missed from that moment), alongside the existing notification close-all and summary clear (FR-009/FR-011); confirm server-side push suppression on foreground needs no change (research R6)
- [ ] T024 [US5] Verify open-during-ring on the dev stack per quickstart step 4: notification gone, badge back to pre-call count within 5s (SC-003), in-app ring unaffected, missed trace still recorded if left unanswered (US5 scenario 3)

**Checkpoint**: all five stories independently verified.

---

## Phase 8: Polish & gates

- [x] T025 [P] Sweep copy against the app voice (no em-dashes/semicolons, "you" phrasing) across all new notification strings in `src/sw.ts` / `src/services/sw-inbox.ts`
- [x] T026 Run the full gate set: `npm run build`, `npx vitest run`, `cd server && go build ./... && go vet ./... && go test ./...`, `npm run test:e2e` (needs `make db-up`); fix anything red
- [x] T027 Bump spec Status to `in-review`, run `make roadmap`, and prepare the PR body listing `Closes #N` for every task issue (constitution VIII)

---

## Dependencies

- Phase 2 (foundation) blocks US1 (T007–T009), US2 (T012–T014), US4 (T021)
- US2's T013 builds on US1's T007/T008 (same preview surface) — implement in
  order US1 → US2
- US3 (T015–T019) is fully independent — can run in parallel with any phase
- US4 (T020–T022) depends on Phase 2 helpers only; US5 (T023–T024) depends on
  US4's units existing
- Polish (T025–T027) last

## Parallel opportunities

- T002 ∥ T003 (test file vs type file)
- After Phase 2: the US3 server track (T015–T016) ∥ US1 client track
  (T006–T008); T006 ∥ T010 ∥ T011 ∥ T017 ∥ T020 (distinct test files)
- T025 ∥ final verification tasks

## Implementation strategy

MVP = Phase 2 + US1 (named rings) — immediately demonstrable value.
Then US2 (the data-integrity core), US3 (independent quick win, can land any
time), US4 → US5 (badge lifecycle). Each checkpoint is a working, testable
increment; nothing after Phase 2 changes the wire format again.

---

## Implementation notes (2026-07-12)

- T009/T019/T022/T024 (real-device lock-screen passes) remain open as MANUAL
  verification: OS notification visuals and app-icon badges cannot be observed
  in headless CI (plan.md Complexity Tracking). Everything they verify is
  covered at the unit level (note builders, badge-unit transitions, conn
  classification) and at the data layer by `e2e/missed-call-trace.spec.ts`.
  Follow quickstart.md steps 2–5 on an installed PWA to close them.
- T014's e2e half is green (3/3 in `missed-call-trace.spec.ts`); its device
  half folds into the manual pass above.
