# Tasks: Merge a Waiting Caller into the Ongoing Call

**Input**: Design documents from `/specs/1041-merge-waiting-caller/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R8), data-model.md, contracts/join-request.md

**Tests**: REQUIRED (constitution Principle III) — failing tests precede the
implementation that satisfies them.

**Organization**: grouped by user story. US1 (consent-gated merge) is the
core; US2 (rejection-final) and US3 (timeout invariants) build on its state;
US4 (avatar fix) is fully independent and can land any time.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [ ] T001 Create the pure module skeleton `src/services/call/join-request.ts` (exported types for the per-call request state: roomId, pending map, rejected set) and empty `src/services/call/join-request.test.ts` wired into vitest

---

## Phase 2: Foundational — signal types + senders (blocks US1–US3)

- [ ] T002 [P] Write failing vitest specs in `src/services/call/join-request.test.ts` for the pure rules per data-model.md: `canRequest` (blocked by rejected set / pending / capacity via an injected check), `reject` (pending → rejected, final), `accept` (clears pending), teardown cancels every pending, waiting-attempt death clears its pending silently
- [ ] T003 Add `'joinreq' | 'joinreq-accept' | 'joinreq-reject' | 'joinreq-cancel'` to the `CallSignal.type` union in `src/services/crypto/message.ts` with a doc comment tying them to the sealed-inside-call-ice pattern (contracts/join-request.md)
- [ ] T004 Implement `src/services/call/join-request.ts` to green T002 (pure state transitions, no IO)
- [ ] T005 [P] Add `sendJoinRequest` / `sendJoinRequestReply` / `sendJoinRequestCancel` to `src/services/call/signalling.ts` (one-liners over `sendSealedSignal('call-ice', …)`, mirroring `sendJoinRoom` at signalling.ts:90-103)

**Checkpoint**: vitest green; `npm run build` green; wire unchanged for old peers.

---

## Phase 3: User Story 1 — Invite the waiting caller into the ongoing call (P1) 🎯 MVP

**Goal**: merge entry points send a consent REQUEST; the waiting/held party
gets a Join / Stay-waiting prompt; accept lands them in the room with their
OWN media kind; reject leaves their attempt untouched.

**Independent test**: new e2e `call-merge-consent.spec.ts` accept path;
quickstart step 2–3 on the dev stack.

- [ ] T006 [P] [US1] Write failing e2e `e2e/call-merge-consent.spec.ts` (accept path): A in a call with C, B calls A, A invites B, B sees the join request (new testhook), B accepts → all three in one room (`callRoster`), B's camera state matches B's own attempt kind (audio attempt in a video room → camera off), and B's 1:1 attempt ended without a missed log on either side
- [ ] T007 [US1] Rework the callee-side merge entry points in `src/composables/useCall.ts`: `mergeIncoming`/`mergeSecond` (second-incoming prompt) send `joinreq` (pre-minted roomId for a 1:1, existing roomId for a group; NO eager promotion — research R3) and register the pending request in the join-request state; wire `withAddInFlight` only around the on-accept conversion
- [ ] T008 [US1] Implement the accepter side in `src/composables/useCall.ts`: `case 'call-ice'` dispatch branches for `joinreq` (raise the consent prompt state when `meta.callId` matches a live outgoing attempt), accept → `joinreq-accept` + `convertActiveToRoom(roomId, ownKind, …)` reusing the captured stream, reject → `joinreq-reject`; prompt dismissed by attempt teardown and by `joinreq-cancel`; gate bare `joinroom` on own state (connected → promote follow as today; still-dialing → the same consent prompt — contracts compatibility rule)
- [ ] T009 [US1] Callee handles `joinreq-accept`: promote the active 1:1 into the pre-minted room via the existing conversion (`ensureActiveIsRoom` refactored to accept a fixed roomId, or a sibling), free/convert the relevant waiting/held slot, clear the pending request; existing roster/join-cue semantics take over
- [ ] T010 [US1] Consent prompt UI in `src/views/detail/CallActivePage.vue` (cw-prompt alertdialog idiom): "<Name> asks you to join their call" with Join / Stay waiting buttons; testhooks in `src/services/testhook.ts` (`joinRequestVisible`, `acceptJoinRequest`, `rejectJoinRequest`)
- [ ] T011 [US1] Held-party merge (FR-002): a "bring into this call" action on the held bar in `CallActivePage.vue` running the same request flow against `heldCall`'s party (capacity-gated, hidden when blocked); on accept the held slot frees as they join the room
- [ ] T012 [US1] Run the accept-path e2e green and the quickstart step-2/3 dev-stack pass

**Checkpoint**: consent-gated merge works end to end; no bare `joinroom` ever
reaches a party who has not accepted.

---

## Phase 4: User Story 2 — A rejection is final for this call (P2)

**Goal**: after a reject, no further requests to that party this call; only
hold/swap/decline remain; no memory into future calls.

- [ ] T013 [P] [US2] Extend `e2e/call-merge-consent.spec.ts` with the reject path (failing first): B rejects → A's invite affordance for B is absent/disabled (testhook `canRequestJoin(partyId)`), swap/hold still work, B's attempt keeps ringing; after both calls end, a fresh call offers merge again
- [ ] T014 [US2] Wire the rejection block in `src/composables/useCall.ts` + `CallActivePage.vue`: `joinreq-reject` marks the party in the join-request state; merge buttons (prompt + held bar) render disabled/hidden for blocked parties; state dies in `teardown` (FR-011); add the `canRequestJoin` testhook
- [ ] T015 [US2] Run the reject-path e2e green

---

## Phase 5: User Story 3 — An ignored second call still ends in "No answer" (P3)

**Goal**: pin that requests never extend attempt lifetimes and never leave
dangling prompts.

- [ ] T016 [P] [US3] Extend `e2e/call-merge-consent.spec.ts` (failing first): (a) a pending join request with nobody acting → the waiting caller's attempt ends by its own dial timeout with the standard no-answer outcome and the request prompt is gone; (b) the ongoing call ends with a request pending → the waiting party's prompt dismisses (`joinreq-cancel`) and their attempt keeps ringing the now-free callee; (c) the waiting caller hangs up → the callee's prompt and pending request clear (use the e2e backend's shrunken ring cadence via `setCallConfig` where applicable)
- [ ] T017 [US3] Implement the lifecycle edges in `src/composables/useCall.ts`: `teardown` of the ongoing call sends `joinreq-cancel` for every pending request; the waiting attempt's death (existing `call-cancel`/`call-end`/prompt auto-drop paths) clears its pending entry and dismisses the accepter prompt; verify no new timers were introduced (research R5)
- [ ] T018 [US3] Run the lifecycle e2e green

---

## Phase 6: User Story 4 — Avatars keep their shape during call join/leave (P4)

**Goal**: the tile avatar is a circle at every frame of join/leave/merge
transitions (see `avatar-stretch.png`).

- [ ] T019 [P] [US4] Add a failing roundness assertion to an existing call e2e (e.g. `e2e/call-join-cue.spec.ts` or a small `e2e/call-avatar-shape.spec.ts`): during a group call with a camera-off participant, measure the rendered `.tile-avatar` bounding box and assert width ≈ height (±2px) while a participant joins and leaves
- [ ] T020 [US4] Fix `.tile-avatar` in `src/views/detail/CallActivePage.vue` (research R8): declare `height: auto` so `aspect-ratio: 1` governs (UserAvatar's internal `img/.ua { height:100% }` currently wins); verify the emoji-avatar (`.ua`) branch still centers, across grid/stacked layouts and both orientations
- [ ] T021 [US4] Run the roundness e2e green; compare against `avatar-stretch.png` on the dev stack

---

## Phase 7: Polish & gates

- [ ] T022 [P] Copy sweep on the new prompt/affordance strings (app voice: warm, plain, "you"; no em-dashes or semicolons)
- [ ] T023 Full gates: `npm run build`, `npx vitest run` (+ coverage), `cd server && go build ./... && go vet ./... && go test ./...` (untouched but run), `npm run test:e2e` call/merge/waiting family green
- [ ] T024 Bump spec Status to `in-review`, `make roadmap`, prepare the PR body with `Closes #N` for every task issue

---

## Dependencies

- Phase 2 blocks US1–US3; US2 (T013–T015) and US3 (T016–T018) depend on US1's
  request flow (T007–T011); US4 (T019–T021) is independent of everything
- T007/T008/T009 touch `useCall.ts` sequentially; T010/T011 touch
  `CallActivePage.vue` sequentially
- Polish last

## Parallel opportunities

- T002 ∥ T003 ∥ T005 (different files); T006 ∥ T019 (different spec files);
  US4's whole phase ∥ any other phase; T022 ∥ verification tasks

## Implementation strategy

MVP = Phase 2 + US1 (consent-gated merge, accept path). Then US2 → US3
(guard rails on the same state), US4 whenever convenient (independent
one-liner + test). IMPORTANT: implementation starts only after spec 1040's
PR merges — rebase this branch onto `develop` first (useCall.ts and
CallActivePage.vue moved under 1040).
