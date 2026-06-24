---
description: "Task list for spec 2008 — make the first call connect as fast as a call-waiting second call"
---

# Tasks: Make the first call connect as fast as a call-waiting second call

**Input**: Design documents from `specs/2008-fast-first-call-connect/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: REQUIRED. This is a `2001+` bug fix, so per the constitution (Principle III) it begins
with a **failing regression test** that reproduces the slow/serial behavior deterministically
(ordering/overlap assertions via connect-milestone instrumentation), satisfied by the fix.

**Organization**: Tasks are grouped by user story (spec.md). US1 (caller) + US2 (callee) are both
P1 and together are the real fix; US1 alone is the smallest demonstrable slice.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (setup, foundational, polish carry no story label)

## Path Conventions

Single Vue PWA client (change is client-only). Key paths: `src/composables/useCall.ts`,
`src/services/call/turn.ts`, `src/services/call/mesh.ts`, `src/services/testhook.ts`, `e2e/`.

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Confirm the e2e harness can observe time-to-first-media via the existing remote-stream/
  track hooks (`remoteTracks`/`waitRemotes`/`callState` in `e2e/helpers.ts`); note any gap to fill
  in T002–T003. No code change if already sufficient.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ MUST complete before the user-story phases — both US1 and US2 tests depend on these.**

- [ ] T002 Add a dev-only connect-milestone recorder in `src/composables/useCall.ts`: a module
  record reset at the start of each 1:1 call that timestamps `callStart`, `turnWarmStart`,
  `turnReady`, `gumStart`, `gumResolved`, `pcCreated`, `remoteDescriptionSet`,
  `offerSent`/`answerSent`, `firstRemoteMedia` (per data-model.md). Recording is a no-op unless the
  test hook is active; nothing persisted, nothing sent to the server.
- [ ] T003 [P] Expose the milestones read-only via `src/services/testhook.ts`
  (`connectMilestones()`), stripped from production builds like the rest of the hook, and add a
  matching `connectMilestones(client)` helper in `e2e/helpers.ts`.
- [ ] T004 [P] Add a fire-and-forget `warmTurnConfig()` to `src/services/call/turn.ts` that calls
  `getTurnConfig().catch(() => {})` (idempotent against the existing TTL cache), so callers can warm
  the credential cache off the critical path without awaiting or throwing.

**Checkpoint**: instrumentation + TURN-warm helper exist; no behavior changed yet.

---

## Phase 3: User Story 1 — Placing a call connects quickly (Priority: P1) 🎯 MVP

**Goal**: A first OUTGOING 1:1 call's media appears for the caller about as fast as a second call.

**Independent test**: Place a first 1:1 call A→B in the harness; assert the caller-side overlap
invariant (TURN warm not gated behind gUM) and that the caller receives B's media within the parity
margin of the second-call path.

- [ ] T005 [US1] Write the FAILING regression e2e `e2e/call-connect-speed.spec.ts` (chromium): place
  a first 1:1 audio call A→B, B answers; assert the **caller overlap invariant** from data-model.md
  — `turnWarmStart <= gumStart` (TURN warming is not serialized after `getUserMedia`). This FAILS on
  current code (TURN is fetched inside `newPeerConnection`, strictly after gUM).
- [ ] T006 [US1] Extend the same spec: assert first-call caller **time-to-first-media** (caller
  receives the callee's decoded audio/video) is within a generous margin of the second/call-waiting
  path (SC-001/SC-002). Also add the video variant.
- [ ] T007 [US1] Implement the caller fast path in `startDirectCall` (`src/composables/useCall.ts`):
  call `warmTurnConfig()` at call intent, run `getUserMedia` and TURN warming **concurrently**
  (e.g. `Promise.all`), then build the PC from the already-resolved TURN config, add tracks, create
  + send the offer. Record the US1 milestones (T002). Preserve all existing semantics
  (dialing/ringback/dial-timeout, failure → teardown).
- [ ] T008 [US1] Run T005–T006 to GREEN; run `e2e/calls.spec.ts` (outgoing-call cases) to confirm no
  regression to ring/answer/cancel/no-answer.

**Checkpoint**: outgoing first call connects without the cold-TURN + serial-gUM stall.

---

## Phase 4: User Story 2 — Answering a call connects quickly (Priority: P1)

**Goal**: A first INCOMING 1:1 call connects media for both sides promptly after the callee accepts.

**Independent test**: Answer a first 1:1 call in the harness; assert the callee-side overlap
invariant (SDP/PC setup not gated behind gUM) and that BOTH parties receive media within the parity
margin after accept.

- [ ] T009 [US2] Extend `e2e/call-connect-speed.spec.ts`: place a first 1:1 call to A, A answers;
  assert the **callee overlap invariant** — `remoteDescriptionSet`/`pcCreated` is reached without
  first awaiting `gumResolved` (capture overlaps SDP/PC setup). FAILS on current code (serial gUM →
  PC → setRemote in `acceptCall`).
- [ ] T010 [US2] Extend the spec: assert accept→media time-to-first-media for BOTH directions
  (callee receives caller media AND caller receives callee media) is within the parity margin
  (SC-002), audio and video.
- [ ] T011 [US2] Warm TURN on incoming ring: in the 1:1 offer-receipt path of
  `src/composables/useCall.ts` (where the incoming call is presented / starts ringing), call
  `warmTurnConfig()` so the cache is warm before the callee accepts. MUST NOT capture camera/mic
  before accept (privacy, Principle IX) — network/SDP prep only.
- [ ] T012 [US2] Implement the callee fast path in `acceptCall` (`src/composables/useCall.ts`): start
  `getUserMedia` **concurrently** with creating the PC + `setRemoteDescription(offer)` + draining
  buffered ICE (these don't need the stream); once the stream resolves, add tracks, `createAnswer`,
  `setLocalDescription`, send the answer. Record the US2 milestones (T002). Preserve failure →
  reject/teardown behavior.
- [ ] T013 [US2] Run T009–T010 to GREEN; run `e2e/calls.spec.ts` + `e2e/call-waiting.spec.ts` to
  confirm no regression to answering, busy, or the (already-fast) second-call path.

**Checkpoint**: the full 1:1 first call — both placing and answering — is as snappy as a second call.

---

## Phase 5: User Story 3 — The first group-call leg connects quickly (Priority: P3)

**Goal**: A group call's first peer leg connects about as fast as a second-call connection (or is
verified to already do so).

**Independent test**: Start a 3-person group call in the harness; measure per-leg time-to-first-
media against the second-call path.

- [ ] T014 [US3] Investigate `src/services/call/mesh.ts` `start()`/`buildLeg()` for the same serial
  `getUserMedia` → TURN/leg pattern (note: `start()` already warms TURN before legs build). Record
  the finding in `research.md` (confirmed asymmetry, or no-op).
- [ ] T015 [US3] IF an asymmetry is confirmed: overlap the initial `getUserMedia` in `mesh.start()`
  with TURN warming (mirror US1), leaving leg-building unchanged. IF not: add an e2e assertion in
  `e2e/call-connect-speed.spec.ts` that a group first leg already meets the parity margin (verify
  no regression) and close the story.

**Checkpoint**: group first-leg connect is at parity (fixed or verified).

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T016 [P] Confirm no dropped early ICE on the first call: assert in
  `e2e/call-connect-speed.spec.ts` that the first call connects on the first attempt with early
  candidates applied (SC-003).
- [ ] T017 Zero-knowledge confirmation (Principle I): verify the change adds no server interaction
  beyond the existing `/v1/turn-credentials` request (only its timing moved), no new frame, no new
  metadata, no stored state; the instrumentation hook is dev-only. Satisfies the required
  `/speckit-checklist` zero-knowledge pass.
- [ ] T018 Run the full gate: `npm run build`; `npm run test:unit`; `cd server && go build ./... &&
  go vet ./... && go test ./...` (must stay green — server untouched); `RING_E2E_PORT=8085
  npm run test:e2e` (call-connect-speed + calls + call-waiting all green).
- [ ] T019 Walk `specs/2008-fast-first-call-connect/quickstart.md`, including the on-device
  iOS/Safari first-call check via `make deploy-dev` (FR-008) and the no-pre-accept-camera privacy
  check.
- [ ] T020 Flip spec `Status:` in `specs/2008-fast-first-call-connect/spec.md` to `in-progress`
  (then `in-review` at PR) and run `make roadmap`.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T004)** must complete before any user story.
- **US1 (T005–T008)** and **US2 (T009–T013)** both depend only on Foundational; they touch the same
  file (`useCall.ts`) in different functions, so do US1 then US2 (sequential on that file), not in
  parallel.
- **US3 (T014–T015)** depends on Foundational; independent of US1/US2.
- **Polish (T016–T020)** after the user stories.
- **TDD order within each story**: the failing test task precedes its implementation task
  (T005/T006 before T007; T009/T010 before T012).

## Parallel Execution Examples

- Foundational: **T003** and **T004** can run in parallel (different files: `testhook.ts`/
  `helpers.ts` vs `turn.ts`); **T002** (in `useCall.ts`) should land first as both reference the
  milestone record.
- Polish: **T016** (e2e assertion) can be authored in parallel with **T017** (ZK review doc).

## Implementation Strategy

- **MVP = US1** (caller fast) — the smallest independently demonstrable slice. **US1 + US2** together
  are the real 1:1 fix the user asked for (both P1); ship them as the core increment.
- **US3** is a low-priority, evidence-driven extension — fix only if a measured group asymmetry
  exists, otherwise verify-and-close.
- Keep the deterministic **ordering/overlap** assertions as the gate; treat the wall-clock TTFM
  parity as generous-margin validation to avoid CI flake.
- The Go server is untouched; the zero-knowledge boundary is unchanged (timing-only).
