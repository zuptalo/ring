# Tasks: Simultaneous mutual calls connect instead of ringing each other

**Input**: Design documents from `/specs/1039-simultaneous-mutual-calls/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/signalling.md

**Tests**: INCLUDED — the constitution's TDD principle (III) mandates failing tests
before the implementation that satisfies them; this feature changes user-facing call
behavior, so both unit (pure decision module) and e2e coverage are required.

**Organization**: Grouped by user story; each story is independently implementable and
testable once the Foundational phase is done.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task belongs to (US1, US2, US3)

## Phase 1: Setup

No setup tasks — existing repo, existing toolchain, no new dependencies or scaffolding.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the pure glare-decision core and the attempt-lifetime guard that every
story builds on.

**⚠️ CRITICAL**: complete before any user story phase.

- [X] T001 Write FAILING decision-table unit tests in `src/services/call/glare.test.ts`: all four decision rows from data-model.md (no attempt → `none`; attempt + `selfId < from` → `ignore`; attempt + `selfId > from` + kinds match → `auto-accept`; kinds differ → `ring`), plus exclusions (group offer, different peer, already-answered attempt → `none`) and a symmetry property (for any id pair exactly one side ignores)
- [X] T002 Implement the pure decision module `src/services/call/glare.ts` (inputs: selfId, from, current attempt {peerUserId, kind, isGroup, answered}, offer kind → decision enum) making T001 green; pure function style matching `src/services/call/capacity.ts` et al.
- [X] T003 Add the outgoing-attempt token guard in `src/composables/useCall.ts` `startDirectCall`: capture the attempt's callId at entry and bail out after every `await` if the active attempt changed (yielded/torn down), so an abandoned attempt never mutates shared state (`setState('dialing')`, tones, navigation) — research R3

**Checkpoint**: `npx vitest run src/services/call/glare.test.ts` green; typecheck passes.

---

## Phase 3: User Story 1 — Calling each other at the same moment just connects (P1) 🎯 MVP

**Goal**: same-kind mutual attempts always resolve into one connected call, no manual
accept, at any tap offset (including inside the setup window).

**Independent Test**: two e2e browsers place calls at each other simultaneously (audio
and video, 0ms and ~1s offsets) and both land connected with no incoming-call UI.

### Tests for User Story 1 (write first, must FAIL)

- [X] T004 [P] [US1] Write FAILING e2e `e2e/mutual-call.spec.ts`: same-kind mutual attempts (audio at ~0ms offset, video at ~0ms, audio at ~1s offset) → both sides reach `connected`, neither side ever shows the incoming-call UI or plays the incoming ring, no manual accept, and each side's call history has exactly one answered entry (SC-001/003/005); drive via the `window.__ringTest` hook like the existing call e2e specs

### Implementation for User Story 1

- [X] T005 [US1] Rework the glare gate in `src/composables/useCall.ts` `handleOffer`: replace the `callState !== 'idle'`-scoped check with the `glare.ts` decision keyed on the synchronously-set `callMeta` (covers the setup window, research R2); decision `ignore` (we win) drops the crossing offer before any record/UI is created
- [X] T006 [US1] Implement the yield path in `src/composables/useCall.ts`: on `auto-accept`, invalidate the attempt token (T003), send `call-cancel` for the abandoned callId (existing control frame, research R5), delete the abandoned outgoing call record via `deleteCalls` from `src/db/queries.ts` (research R6), stop/hand over local media per R4 (reuse the captured stream if it resolved; never a second concurrent getUserMedia)
- [X] T007 [US1] Implement the silent auto-accept in `src/composables/useCall.ts`: factor the 1:1 accept flow so the yield path can join the surviving offer with no `setState('incoming')`, no ring tone, and no incoming UI (FR-008), reusing the yielded stream when available and writing the normal incoming-answered record; ensure the glare branch runs before the per-chat-mute suppression (research R8)
- [X] T008 [US1] Guard against late redelivery in `src/composables/useCall.ts`: a crossing/yielded offer arriving after resolution (relay retention, spec 2012) is dropped — extend the existing duplicate/withdrawal guards to cover callIds cancelled by the yield path
- [X] T009 [US1] Verify US1: `npx vitest run` green, `npm run build` green, `npm run test:e2e -- mutual-call` US1 scenarios green

**Checkpoint**: MVP — mutual same-kind calls connect; ordinary calls unaffected.

---

## Phase 4: User Story 2 — Mismatched kinds never switch on a camera uninvited (P2)

**Goal**: audio-vs-video mutual attempts resolve to ONE surviving call presented as a
normal incoming ring on the yielding side; no camera without explicit accept.

**Independent Test**: e2e where A places audio and B places video simultaneously →
single surviving call rings on the yielder showing its kind; decline ends cleanly.

### Tests for User Story 2 (write first, must FAIL)

- [X] T010 [P] [US2] Extend `e2e/mutual-call.spec.ts` with FAILING mismatched-kind scenarios: audio-caller yields to video offer → normal incoming ring (kind shown), no local camera capture before accept (SC-004); and decline → both sides idle with no timeout (US2 acceptance 2)

### Implementation for User Story 2

- [X] T011 [US2] Route the `ring` decision in `src/composables/useCall.ts`: yield the own attempt (same cancel/record/token steps as T006, releasing any captured media since kinds differ) then fall through to the existing incoming-ring presentation of the surviving offer

**Checkpoint**: US1 + US2 behaviors verified together.

---

## Phase 5: User Story 3 — A different caller during setup doesn't wreck the call being placed (P3)

**Goal**: an unrelated incoming offer during the setup window leaves the outgoing
attempt intact and gets the existing busy/call-waiting treatment.

**Independent Test**: e2e where C calls B in the instant B places a call to A → B↔A
proceeds and can connect; C sees busy (or the call-waiting prompt per existing rules).

### Tests for User Story 3 (write first, must FAIL)

- [X] T012 [P] [US3] Extend `e2e/mutual-call.spec.ts` with FAILING scenarios: (a) C's offer lands during B's setup window → B's outgoing call to A still rings/connects, and C receives the busy/call-waiting outcome (FR-006); (b) a mutual attempt while one side is already in a connected call follows the existing busy/call-waiting rules, not glare resolution (spec edge case, FR-009)

### Implementation for User Story 3

- [X] T013 [US3] Gate non-glare incoming offers on `callMeta` (not just `callState`) in `src/composables/useCall.ts` `handleOffer`, routing a different-peer offer during the setup window to the existing busy/call-waiting flow instead of the normal-incoming path that clobbers `callMeta`

**Checkpoint**: all three stories independently green.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T014 Run the full gates: `npm run build`, `npx vitest run` (coverage floors), `npm run test:e2e` (full suite — confirms no regression to busy, call-waiting spec 0005/2009, group calls, upgrade flow)
- [X] T015 Bump `**Status**:` in `specs/1039-simultaneous-mutual-calls/spec.md` to `in-progress` → `in-review` as appropriate and run `make roadmap` so the CI roadmap guard stays green

---

## Dependencies & Execution Order

- **Foundational (Phase 2)**: T001 → T002 (tests then module); T003 independent of T001/T002 → all three block every story
- **US1 (Phase 3)**: T004 [P] may be written while T005–T008 are pending (it must fail first); T005 → T006 → T007 → T008 → T009
- **US2 (Phase 4)**: depends on T006 (yield steps reused); T010 [P] before T011
- **US3 (Phase 5)**: depends on T005 (gate rework); T012 [P] before T013
- **Polish (Phase 6)**: after all desired stories

### Parallel Opportunities

- T001 and T003 touch different files → parallel
- T004, T010, T012 are all e2e-spec authoring in one new file — parallel with
  implementation tasks of *other* stories but serialized with each other
- US2 and US3 implementation (T011, T013) touch the same composable — serialize

## Implementation Strategy

MVP = Phase 2 + Phase 3 (US1): mutual same-kind calls connect. US2 (consent on
mismatch) and US3 (setup-window busy routing) are small increments on the same
gate/yield machinery and land next. Stop at any checkpoint; every phase leaves
ordinary call behavior intact.
