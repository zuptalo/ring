# Tasks: Robust Calls + Add-to-Call (Merge Incoming, Add People)

**Input**: Design documents from `/specs/1028-robust-audio-and/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/internal-api.md, quickstart.md

**Tests**: REQUIRED — constitution Principle III (TDD) + spec SC-007 (all call tests stay
green). Pure helpers are unit-first; each user-facing slice writes a failing e2e before
the orchestration lands. Design ids (R1–R10, D1–D6, INV-1..4) reference research/plan/data-model.

**CI constraint**: 3-person **video** mesh is NOT runnable headless — e2e uses **audio**
meshes (3–4) + 2-person proxies; the **video** path is drive/real-device only.

## Format: `[ID] [P?] [Story?] Description`

---

## Phase 1: Setup & capacity gate (Slice 0 — pure, no WebRTC)

**Purpose**: The pure cap math every add path depends on (blocks US2/US3/US6).

- [ ] T001 (#639) [P] Failing unit tests in `src/services/call/capacity.test.ts`: `capOf` (video 4 / audio 8), `headcount` (distinct roster ∪ invited ∪ self), `remainingSlots`, `canAdd` — incl. invited-counts-against-cap, the 5th-video / 9th-audio boundaries, and the US6 combined-headcount case
- [ ] T002 (#640) Implement `src/services/call/capacity.ts` (`capOf`/`headcount`/`remainingSlots`/`canAdd`, kind-specific reason copy) until T001 is green
- [ ] T003 (#641) Wire `callRemainingSlots()` in `src/composables/useCall.ts` to `capacity.ts` (reads the active call's kind + roster + invited)

**Checkpoint**: cap math locked by unit tests.

---

## Phase 2: Foundational — the `joinroom` sealed signal + dispatch (Slice 3 core, blocks merge/promotion)

**Purpose**: The one new wire element (sealed, opaque to the server) + its receive path. R2/D1.

- [ ] T004 (#642) [P] Extend the `CallSignal` union in `src/services/transport.ts` with `{ type: 'joinroom', roomId, kind }` (sealed payload only — rides the existing `call-ice` frame, no new transport frame)
- [ ] T005 (#643) [P] Failing unit test in `src/services/call/signalling.test.ts` (or nearest): a `joinroom` `CallSignal` seals and opens round-trip over a pair's session (reusing `sealForChat`/`openPacket`), and its payload carries ONLY `{roomId, kind}` — assert the serialized signal contains no name/contact/plaintext beyond an opaque room id + the kind enum (FR-017 zero-knowledge bound)
- [ ] T006 (#644) Implement `sendJoinRoom(chatId, peerUserId, callId, roomId, kind)` in `src/services/call/signalling.ts` (mirrors `sendHoldResume`)
- [ ] T007 (#645) Add the `joinroom` dispatch case to `handleCallFrame`/`call-ice` handling in `src/composables/useCall.ts`: on receipt, auto-join the room (reuse the shared capture), tear the prior 1:1 PC down on leg-connect, and surface the join cue (US1 cue wired in Phase 3)

**Checkpoint**: a device can be told to join a room over the sealed channel.

---

## Phase 3: User Story 2 — Add people to an ongoing GROUP call (Priority: P1) 🎯 MVP

**Goal**: Ring new contacts into an existing group call; they mesh with everyone. No
promotion yet (start from a group call).

**Independent Test**: A+B+C in a group AUDIO call; A adds D; D rings, accepts, meshes with
A, B, AND C (assert from B, a non-initiator).

### Tests (write first, must FAIL)

- [ ] T008 (#646) [P] [US2] Failing Playwright e2e `e2e/call-add-merge.spec.ts` (part 1, audio 3→4): A/B/C in a group audio call, A adds D via Add people, D joins and meshes with every existing participant (verified from B)
- [ ] T009 (#647) [P] [US2] Failing unit test for the pure invite-planning helper — dedup an id list against `roster ∪ invited` and clamp to `remainingSlots` — in a small pure module (e.g. `src/services/call/invite-plan.ts` + `.test.ts`), so `inviteToRoom`'s decision is testable without WebRTC

### Implementation

- [ ] T010 (#648) [US2] Implement `inviteToRoom(ids)` in `src/composables/useCall.ts`: dedup vs `roster ∪ invited`, `canAdd` gate, add to `meta.invited`, `call-ring` each (reuses the in-room `call-ring` seam)
- [ ] T011 (#649) [US2] Add an **Add people** button + existing contact-picker entry in `src/views/detail/CallActivePage.vue`, gated by `callRemainingSlots()`; confirm → `addPeople(ids)` (which for a group call is just `inviteToRoom`)
- [ ] T012 (#650) [P] [US2] Extend `drive/scenarios/group-call-4.mjs` to add a 4th participant mid-call and assert the full mesh; also assert no camera/mic re-prompt on the adder (SC-006 on the add path, complementing the merge-path assertion in T015)

**Checkpoint**: you can grow an existing group call — MVP add path.

---

## Phase 4: User Story 3 — Size limits respected before you add (Priority: P1)

**Goal**: Pre-emptive client cap gate on every add path (FR-010/FR-011), server `call-full`
as backstop.

**Independent Test**: Fill an audio call to 8 and a video call to 4; Add people is
disabled/blocked with a kind-specific reason; just-below is allowed; the local call is
never disturbed by a refusal.

### Tests (write first, must FAIL)

- [ ] T013 (#651) [P] [US3] Failing Playwright e2e `e2e/call-add-cap.spec.ts`: audio call at 8 → Add people blocked with reason; video call at 4 → blocked; a call one below cap → allowed; assert the existing call is undisturbed when an over-cap attempt is refused

### Implementation

- [ ] T014 (#652) [US3] Enforce `canAdd` in the picker (disable selections past `callRemainingSlots()`) and as a guard in `addPeople`/`mergeIncoming`/`mergeGroupInvite` before any ring; surface the kind-specific reason (stock Ionic, Principle XI)

**Checkpoint**: no add can exceed 4 video / 8 audio, and the user learns why up front.

---

## Phase 5: User Story 1 — Merge an incoming caller into your call (Priority: P1)

**Goal**: Promote a 1:1 to a mesh room and merge an incoming DIRECT caller into it,
reusing the capture; existing peer auto-follows with a cue; kind reconciliation. R2/R5/R6.

**Independent Test**: A+B in a 1:1 call; C calls A; A taps Add to call → A, B, C all
meshed, A's capture reused, B auto-followed with a cue; if C declines, the call is
unaffected.

### Tests (write first, must FAIL)

- [ ] T015 (#653) [P] [US1] Failing Playwright e2e `e2e/call-add-merge.spec.ts` (part 2, audio 1:1→3): A+B in a 1:1, A promotes and merges incoming C → three-way audio mesh; assert B auto-followed (no ring shown to B) and saw the "{name} joined the call" cue (SC-008), and A's capture was reused (no second gUM — SC-006)
- [ ] T016 (#654) [P] [US1] Failing unit test for kind reconciliation (D4): video caller + audio call ≤4 → wants-upgrade true; >4 → audio-only; pure decision function

### Implementation

- [ ] T017 (#655) [US1] Implement `ensureActiveIsRoom()` in `src/composables/useCall.ts` (R2): if active is 1:1, mint `roomId`, `MeshSession(roomId, kind).start(existingStream)`, `sendJoinRoom` to the existing peer, tear down the 1:1 PC on leg-connect; idempotent if already a room; add the promotion timeout / clean half-formed-room fallback (R7)
- [ ] T018 (#656) [US1] Implement `mergeIncoming()` (`ensureActiveIsRoom()` → `sendJoinRoom` to the incoming caller so they join instead of a 1:1 answer) + the "{name} joined the call" cue on `joinroom`/new roster member, via existing toast/cue infra
- [ ] T019 (#657) [US1] Kind reconciliation after merge: if wanted AND combined ≤ `VIDEO_MAX`, run the existing consent-gated `requestVideoUpgrade`; else audio-only (reuse — no new mechanism)
- [ ] T020 (#658) [US1] Add the **Add to call** action for a direct incoming caller in `src/components/IncomingCallOverlay.vue` (alongside Hold/Decline) → `mergeIncoming`

**Checkpoint**: the headline capability works on audio; capture reused; peer auto-follows.

---

## Phase 6: User Story 4 — Merge coexists with call waiting (Priority: P2)

**Goal**: Merge acts only on the active call; a held call is untouched and still swappable.
FR-005/FR-014, INV-1.

**Independent Test**: A active with X, holding Y; C calls; A merges C into X; Y stays held
+ paused; swap to Y works; single-held-slot invariant holds.

### Tests (write first, must FAIL)

- [ ] T021 (#659) [P] [US4] Failing Playwright e2e (extend `e2e/call-waiting.spec.ts`): active + held, merge an incoming caller into the active call, assert the held call stays held/paused and swaps correctly afterward; at most one held call throughout

### Implementation

- [ ] T022 (#660) [US4] Add an add-in-flight guard so a merge/add completes (or cancels cleanly) before a swap parks the active call — no half-open leg (FR-014); confirm `heldSlot` is never read/written by merge/add paths

**Checkpoint**: hold/swap (specs 0005/2009) fully intact alongside merge.

---

## Phase 7: User Story 6 — Merge an incoming GROUP INVITE (Priority: P2)

**Goal**: Fold an incoming group invite's roster into the current call within the combined
cap, or block with a reason. R3/D2, SC-009.

**Independent Test**: A+B in a call; C invites A to a group with D; A Add to call → one
combined call (A,B,C,D) within cap, shared members deduped; a variant where combined
headcount exceeds the cap → blocked with reason.

### Tests (write first, must FAIL)

- [ ] T023 (#661) [P] [US6] Failing Playwright e2e `e2e/call-add-merge.spec.ts` (part 3, audio): merge a group invite into an ongoing call → combined mesh within cap; and a blocked case when combined headcount exceeds the cap (SC-009); a shared member resolves to one participant (INV-4)

### Implementation

- [ ] T024 (#662) [US6] Implement `mergeGroupInvite()`: `canAdd(combined distinct headcount)` → `ensureActiveIsRoom()` → `inviteToRoom(inviteRoster − present)` → `call-leave` the incoming invite room; block with a clear reason when over cap
- [ ] T025 (#663) [US6] Add the **Add to call** action for an incoming group invite in `src/components/IncomingCallOverlay.vue` → `mergeGroupInvite`

**Checkpoint**: the richest merge path works, cap-bounded, dedup-correct.

---

## Phase 8: User Story 5 — Robust under churn (Priority: P2)

**Goal**: Correct convergence under concurrent join/leave, simultaneous same-person add,
and invitee reload mid-ring. FR-013, SC-005.

**Independent Test**: Scripted churn on an audio mesh — add C while D leaves; add two at
once; invitee reloads mid-ring then accepts — final roster/tiles/connectivity correct on
every device with no orphaned ringing or duplicate.

### Tests (write first, must FAIL where behavior changes)

- [ ] T026 (#664) [P] [US5] Failing/pinning Playwright e2e (audio mesh churn): concurrent join+leave and simultaneous add of the same person converge to the correct roster with no stuck tile / no duplicate; extend or add `e2e/call-add-churn.spec.ts`
- [ ] T027 (#665) [P] [US5] Drive scenario `drive/scenarios/call-add-churn.mjs` for the harder multi-party churn on the live stack

### Implementation

- [ ] T028 (#666) [US5] Verify/harden `applyRoster` set semantics + `inviteToRoom` dedup + the join cue against the churn tests, INCLUDING the promotion-timeout path (R7): a peer that never joins after `joinroom` leaves a clean state (no stuck half-formed room, no orphaned tile); fix anything the tests expose (reuse the existing serialized `rosterChain`; reuse spec-2012 invite recovery for the reload case — no new mechanism)

**Checkpoint**: growing a call is reliable under churn.

---

## Phase 9: Polish & Cross-Cutting

- [ ] T029 (#667) [P] Fix the misleading "SFU" comments in `src/composables/useCall.ts` (~L1346, ~L1526) to say "mesh session"; `rg` the tree for dead SFU identifiers and remove any unreachable remnants (no behaviour change) (FR-016)
- [ ] T030 (#668) Verify **no `server/` diff** is needed and FR-017 holds: `cd server && go build ./... && go vet ./... && go test ./...` green with the server untouched (constitution I/VI); confirm `git diff --stat origin/develop -- server/` is empty; if a gap is found, STOP and escalate before adding any server capability
- [ ] T031 (#669) [P] Drive scenario `drive/scenarios/promote-1to1-video.mjs`: promote a 1:1 to a 3-way VIDEO call on the live stack (real-device/interactive — NOT headless CI); capture a screenshot of the 3-tile grid
- [ ] T032 (#670) Run ALL existing call e2e + unit tests and confirm green (SC-007): `call-waiting`, `call-waiting-slot`, `call-caps`, `call-reinvite`, `calls`, `call-adaptive`, `call-quality`, `call-busy`, `call-connect-speed`, plus `quality`/`duration`/`slots` unit tests
- [ ] T033 (#671) Full gates: `npm run build`, `npx vitest run` (coverage floors), `npm run test:e2e`, `cd server && go build ./... && go vet ./... && go test ./...`
- [ ] T034 (#672) Bump spec `**Status**:` to `in-progress` → `make roadmap` (start of implement); bump to `in-review` + re-run at PR time

---

## Dependencies & Execution Order

- **Phase 1 (capacity)** and **Phase 2 (`joinroom` signal)** are foundational; Phase 2's
  dispatch (T007) is needed by promotion (Phase 5).
- **US2 (Phase 3)** is the MVP and needs only capacity — it starts from an existing group
  call, no promotion. **US3 (Phase 4)** layers the pre-emptive gate over US2's add path.
- **US1 (Phase 5)** needs Phase 2 (`joinroom`) + `ensureActiveIsRoom`; it is the riskiest.
- **US4 (Phase 6)** needs US1's merge.
- **US6 (Phase 7)** needs US1's promotion + US2's `inviteToRoom`.
- **US5 (Phase 8)** exercises everything; do after the add/merge paths exist.
- **Polish (Phase 9)** last; T030 (no-server-diff) and T033 (gates) gate the PR.

### Parallel opportunities
- T001+T004+T005 (pure/foundational tests), T008+T009, T015+T016, per-slice test pairs.
- Drive-scenario tasks (T012, T027, T031) run parallel to their story's e2e.
- The video drive validation (T031) is independent of the audio e2e path.

---

## Implementation Strategy

**MVP = Phases 1–4 (US2 + US3)**: add people to an existing group call, cap-gated. That
alone delivers "grow a call" for group calls with zero promotion risk. Then Phase 5 (US1
merge + the risky 1:1→mesh promotion, isolated behind the proven late-join path), then US4
(coexist with hold), US6 (group-invite merge), US5 (churn), and polish. Each checkpoint is
independently testable; the server stays untouched throughout (verified by T030).
