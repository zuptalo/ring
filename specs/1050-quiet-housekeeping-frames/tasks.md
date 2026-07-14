# Tasks: Push Classes, Conversation Mutes & Notification Routing

**Input**: Design documents from `/specs/1050-quiet-housekeeping-frames/`

**Prerequisites**: spec.md (3 clarify sessions), checklists/zk.md (25/25), plan.md, research.md, contracts/push-routing.md, data-model.md

**Tests**: first, always (Principle III). Server tests run against the fake store; client pure helpers red-first; e2e for behaviors headless clients can observe; the real-device halves are enumerated in quickstart.md and stay owed to the user.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Foundational wire plumbing (blocks everything; no behavior change until gates flip)

- [x] T001 Migration server/internal/db/migrations/0028_push_prefs.sql (`prefs JSONB NOT NULL DEFAULT '{}'`) + store read/replace of prefs with the subscription row in server/internal/store/push.go, red-first tests incl. fake-store parity and prefs dying with the row (FR-011)
- [x] T002 [P] Red-first hub-gate table tests (contract rows 1–8: blocked, active-fresh, housekeeping-never, mention-pierce, classesOff, mutedPrids, postSenders, default-push; absent class = message) in server/internal/ws/hub_test.go and server/internal/push/push_test.go
- [x] T003 Implement: WS frame `class`/`prid` fields + pass-through in hub.go `case "msg"`; `Notifier.Notify(ctx, userID, class, prid)` with the per-subscription gate; `NotifyPost(ctx, recipient, author)`; go build/vet/test green
- [x] T004 `PUT /v1/push/prefs` handler (full-state replace, 204, auth) + router wiring + sibling handler test red-first in server/internal/api/push_handlers*.go
- [x] T005 Client plumbing: `MessagePayload.prid` opaque passthrough (src/services/crypto/message.ts), outbox rows + useSync frames carry class/prid, `Chat.prid` mint/adopt/converge in src/db/queries.ts — adopt/converge pure helper red-first (lexicographic winner, re-register hook)
- [x] T006 New pure src/services/push-prefs.ts (+ red-first push-prefs.test.ts: toggle→class mapping table, mute/webPushOff→prids, HIDDEN EXCLUSION guard = SC-011, full-state shape) + registration wiring in src/services/push.ts (subscription upsert + settings-bus/mute-write triggers, debounced)

**Checkpoint**: both stacks green; behavior unchanged for untagged frames (T002 default rows prove it)

## Phase 2: User Story 1 — removals invisible (P1)

- [x] T007 [P] [US1] Red-first frame-class tests (client contract table) in src/db/frame-class.test.ts: removal→housekeeping all recipients; add→reaction author/co-reactors, housekeeping bystanders; create card→housekeeping; mention/reply recipient→mention; defaults
- [x] T008 [US1] Implement `classifyFrame` + thread per-recipient class through sealAndEnqueue / sealAndEnqueueGroup send sites in src/db/queries.ts
- [x] T009 [US1] *(satisfied by the existing reaction-notify removal step — banner-free with state convergence)* Extend e2e/reaction-notify.spec.ts: removal produces no banner AND no withheld-frame loss (state converges); add unchanged

## Phase 3: User Story 2 — group fan-out (P1)

- [x] T010 [P] [US2] Red-first co-reactor tests: page (notify.reactions.test.ts) + SW (sw-inbox.reactions.test.ts) — "«name» also reacted …" when I have a reaction on the target; bystander branch stays the pre-1048 silent shape
- [x] T011 [US2] Implement co-reactor notify in handleReaction (queries.ts) + sw-inbox wording; per-recipient class already lands via T008
- [x] T012 [US2] New e2e/push-routing.spec.ts: 3-member fan-out matrix (SC-002) — author rich, bystander nothing-with-state-converged, second reactor rich to author+first-reactor

## Phase 4: User Story 3 — quiet group creation (P2)

- [x] T013 [US3] Create-card class housekeeping (T008 table already red for it) + e2e: creation silent for members, chat list gains the group, first message notifies (SC-003); invite-consent path untouched (existing group-invite e2e stays green)

## Phase 5: User Story 4 — acceptances (P2)

- [x] T014 [P] [US4] Red-first server test: `wakeConn` presence-gated (active-fresh recipient ⇒ no NotifyConn) in connections handler tests; implement via the hub presence interface
- [x] T015 [US4] *(already shipped in spec 1040: classifyConnEvents composes "accepted your friend request" with the accepter’s name — the field bug was the ungated tickle, fixed in T014)* Accepted rich note: conn-wake reconcile distinguishes accepted-outgoing and composes "«name» accepted your invitation" (SW) with the page keeping its banner — red-first sw-inbox/notify tests
- [x] T016 [US4] *(CI half = the presence-gate Go unit + spec-1040 conn-note units; the visible-double check is on the real-device matrix)* e2e: accept while requester visible ⇒ banner only (SW surface empty); closed-path note shape unit-asserted (SC-004)

## Phase 6: User Story 5+6 — mutes & post preferences

- [x] T017 [US5] *(mention pierce client-side = mentions.spec.ts; server no-notify = AllowPush/allowFrame units; muted-group push absence is a real-device item)* e2e muted-group matrix: ordinary member message ⇒ no banner + server unit shows no notify (SC-009 CI half); @mention in muted group ⇒ banner (pierce, extends mentions.spec.ts); unmute restores
- [x] T018 [US6] Per-friend "Notify me about new posts": contact-surface control (schema data edit + contact flag stored like the wall per-person mute), prefs mapping (push-prefs.ts), server postSenders gate tests incl. always-beats-global (SC-010)

## Phase 7: User Story 7 — banner swipe dismiss

- [x] T019 [US7] Swipe-up dismiss on collapsed banners in src/components/NotificationBanners.vue (existing pointer-gesture pattern; reply-mode keeps discard; ✕ → SR-only focusable dismiss) + e2e/notifications-inapp.spec.ts gesture case (SC-008); pointer-tap-guard rules respected (no bare pointerdown.prevent)

## Phase 8: Polish & gates

- [x] T020 Full gates (client build+vitest, server build/vet/test, full e2e), dev-stack rebuild for the user's device round, quickstart real-device list handed over, spec status flips + `make roadmap`

## Dependencies

T001→T003→T004 (server chain); T002 red before T003; T005/T006 parallel to server chain after T001; every US phase needs Phase 1 done; T008 before T011/T013; T012/T017 after T003+T008; T018 after T003+T006; T019 independent after Phase 1; T020 last.

## Implementation Strategy

Server first (fast fake-store loops), then client plumbing, then behaviors in story order, e2e as each lands. One PR-able stack; the real-device matrix is the user's final gate.
