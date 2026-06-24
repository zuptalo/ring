---
description: "Task list for spec 0005 — call waiting (hold, swap, drop)"
---

# Tasks: Call waiting — hold, swap & drop between two concurrent calls

**Input**: Design documents from `specs/0005-call-waiting-hold/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/hold-signals.md, quickstart.md

**Tests**: INCLUDED — the constitution mandates TDD (Principle III). The pure slot state
machine + cue-trigger decisions get vitest unit tests (written first); user-facing behaviour
gets `e2e/call-waiting.spec.ts`. Hold/resume media flow is exercised e2e; iOS/Safari is
verified on-device (the headless-WebKit limitation from spec 0004 still applies).

**Organization**: By user story (US1–US5), each independently testable. Builds entirely on the
spec 0004 calling stack; no server code or DB migration.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 (setup/foundational/polish carry no story label)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The shared primitives every story builds on (pure data/types — no behaviour yet).

- [x] T001 Add `'hold' | 'resume'` to the `CallSignal` union (with `callId`, optional `roomId`) in `src/services/crypto/message.ts`. Carry them over an EXISTING sealed call frame (`call-ice`, already relayed + allowlisted) via `sendSealedSignal` in `src/services/call/signalling.ts` — the outer frame is just an opaque carrier; the receiver dispatches on the inner `CallSignal.type` (T007). This keeps the contract's promise of NO new transport frame and NO server change: confirm `transport.ts`, the server relay allowlist (`hub.go`), and the client `sync.ts` allowlist all need no edit.
- [x] T002 [P] Add the four cue recipe names (`callwaiting`, `hold`, `resume`, `swap`) to `RECIPES` in `src/services/sound.ts` (distinct, subtle tones; `callwaiting` ≠ the normal incoming ring).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The two-slot model, the pure slot reducer, and the media pause/resume primitives
that ALL user stories depend on.

**⚠️ CRITICAL**: No user-story work begins until this phase is complete.

- [x] T003 [P] Write FAILING unit tests for the slot reducer in `src/services/call/slots.test.ts` (TDD — authored before the reducer, MUST fail first): accept holds the current call; swap exchanges active⇄held N times; dropActive promotes held→active; dropHeld leaves active; remoteEndedHeld frees the held slot; a third accept while full is rejected (cap).
- [x] T004 Create the PURE slot reducer in `src/services/call/slots.ts` to turn T003 green: a `CallSlots` state (`active`, `held`) + `reduce(state, action)` for `accept` / `swap` / `dropActive` / `dropHeld` / `remoteEndedHeld`, with the two-call cap encoded (no WebRTC, no IndexedDB — pure).
- [x] T005 Implement `MeshSession.pause()` / `resume()` in `src/services/call/mesh.ts`: `replaceTrack(null)` / `replaceTrack(liveTrack)` on every leg's senders and send the sealed `hold` / `resume` per leg; stop/restart that session's adaptive sampling while paused (resume restarts at the low tier).
- [x] T006 Add 1:1 pause/resume helpers in `src/composables/useCall.ts` (the `pc` path): `replaceTrack(null|live)` on the audio + video senders and send the sealed `hold`/`resume` to the peer; stop/restart the 1:1 stats sampler while paused.
- [x] T007 Handle inbound `hold` / `resume` signals in `src/composables/useCall.ts`: in the sealed-signal receive path (mesh `handleMeshSignal` and the 1:1 signal handler), open the `CallSignal` and DISPATCH ON ITS INNER `.type` — `hold`/`resume` branch off BEFORE the offer/answer/ice handling, so no new outer frame type is needed. On `hold`: set the per-call `remoteHeld` flag and pause OWN outgoing to the holder (`replaceTrack(null)`); on `resume`: clear it and restore (`replaceTrack(live)`) — media stops/returns in both directions.
- [x] T008 Add the `held` slot holder + slot wiring to `src/composables/useCall.ts`: a `heldCall` holder of `{ meta, pc|groupSession, remoteHeld }`, reactive `heldCall`/`isHeld`/`canHoldIncoming`, and the single shared `getUserMedia` track set owned by the ACTIVE slot (held slot's senders carry `null`). Drive transitions through the `slots.ts` reducer.
- [x] T009 [P] Expose the new hooks for tests in `src/services/testhook.ts`: `acceptAndHold()`, `swapCalls()`, `endActive()`, `endHeld()`, `heldMeta()`, `isRemoteHeld()`, `canHoldIncoming()`.

**Checkpoint**: Foundation ready — media can pause/resume and the slot machine is unit-green.

---

## Phase 3: User Story 1 — Take a second call without losing the first (Priority: P1) 🎯 MVP

**Goal**: Accepting a second incoming call holds the current one (media paused both ways, "on
hold" shown to the other side) and connects the new one.

**Independent Test**: With A in a call and B calling, A chooses Accept & hold; the first call's
media pauses both ways and shows "on hold", the second connects with working media.

- [x] T010 [P] [US1] Write FAILING e2e `e2e/call-waiting.spec.ts` (chromium): A↔B connected; C calls A; A accept-and-holds → A↔B media pauses both ways + B sees `remoteHeld`/"on hold"; A↔C connects live. Plus a group case: A holds a group of {A,B,C} → B↔C media unaffected, B/C see A "on hold".
- [x] T011 [US1] Extend the second-incoming handlers in `src/composables/useCall.ts` (the 1:1 offer handler ~`:1244` and the group-invite handler ~`:1082`): when a held slot is free, surface the incoming call with an Accept & hold path instead of replying busy.
- [x] T012 [US1] Implement `acceptAndHold()` in `src/composables/useCall.ts`: pause the current active call (T005/T006), park it in `heldCall`, and connect the incoming call into the active refs. Handle both hold-during-setup sub-cases (data-model transitions): a still-RINGING outgoing first call is cancelled (not parked) when the second is accepted; a still-CONNECTING first call is parked and then either resumes or is cleaned up per its own connect/fail outcome (never left stranded).
- [x] T013 [P] [US1] Add the **Accept & hold** action to `src/components/IncomingCallOverlay.vue`, shown only when `canHoldIncoming` (stock Ionic + `--ring-*` tokens; alongside Decline / normal Accept).
- [x] T014 [P] [US1] Render the "on hold" affordance for `remoteHeld` in `src/views/detail/CallActivePage.vue` — the 1:1 peer / each other group member shows the holder as "on hold" (reuse the existing tile/call-view styling).
- [x] T015 [US1] Add the `callwaiting` cue trigger (second call arrives while in a call) and the `hold` cue trigger (on `acceptAndHold`) via the existing `callCue` gate in `src/composables/useCall.ts`.

**Checkpoint**: A can take a second call without losing the first — MVP demonstrable.

---

## Phase 4: User Story 2 — Swap back and forth (Priority: P1)

**Goal**: Toggle between the active and held call any number of times; each call's media pauses
when held and restores when resumed; the "on hold" indicator follows the held call.

**Independent Test**: With one active + one held call, swap ≥ 3 times; confirm media is paused
when held and restored when resumed each time, and a held group call re-publishes on resume.

- [x] T016 [P] [US2] Extend `e2e/call-waiting.spec.ts`: swap ≥ 3 times → each time exactly one call active (media both ways) + one held; the on-hold indicator follows the held call; a resumed GROUP call's other members see the holder active again within a few seconds.
- [x] T017 [US2] Implement `swapCalls()` in `src/composables/useCall.ts`: pause the active slot, resume the held slot (move the live track set via `replaceTrack`, send `hold`/`resume`), and exchange active⇄held via the `slots.ts` reducer.
- [x] T018 [P] [US2] Add the tap-to-swap **"On hold — <name>"** bar + a swap control to `src/views/detail/CallActivePage.vue` (stock `ion-item`/`ion-chip`/control button + `--ring-*` tokens), bound to `heldCall` and `swapCalls()`.
- [x] T019 [US2] Add the `resume` + `swap` cue triggers on `swapCalls()` via `callCue` in `src/composables/useCall.ts`.

**Checkpoint**: US1 + US2 work — full hold/swap loop.

---

## Phase 5: User Story 3 — Drop one and continue on the other (Priority: P1)

**Goal**: End either the active or the held call and continue on the remaining one (the
remaining call resumes if it was held); a remote-ended held call frees its slot cleanly.

**Independent Test**: End the active call → the held one resumes as the sole normal call; end
the held call instead → the active is undisturbed; remote ends the held call while held → its
slot frees and the user is informed, active untouched.

- [x] T020 [P] [US3] Extend `e2e/call-waiting.spec.ts`: drop active → held resumes as sole call; drop held → active undisturbed; remote-ends-held → held slot freed, active untouched (SC-005). Also the concurrency edge (spec Edge Cases): a remote party ends one call AT THE SAME TIME the user swaps → resolves deterministically to a single, correct remaining call with no orphan/"ghost" slot.
- [x] T021 [US3] Implement `endActive()` / `endHeld()` in `src/composables/useCall.ts`: tear down the chosen slot; if the held slot remains, resume it into active (via `slots.ts` + T017's resume path); when only one call remains, behaviour is exactly the normal single-call path.
- [x] T022 [US3] Handle a remote-ended HELD call in `src/composables/useCall.ts`: detect the held call's teardown (1:1 hang-up, or a group where everyone else left), free the held slot, inform the user, and leave the active call undisturbed (FR-009). Also handle a held call dying past the grace window (spec 0004 recovery) → free its slot, no auto-recall. Resolve the concurrency edge deterministically: a remote-end that races a `swapCalls()` MUST route the teardown through the `slots.ts` reducer against the post-swap state (one reducer mutation at a time) so the correct slot is freed and no ghost slot is left.

**Checkpoint**: US1–US3 — the full hold/swap/drop lifecycle returns cleanly to one call.

---

## Phase 6: User Story 4 — Only two at a time; further callers get busy (Priority: P2)

**Goal**: At the two-call limit, a third incoming call gets busy/unavailable and the user is
not prompted for a third slot.

**Independent Test**: Put A in two calls (active + held); a third party calls A → they get
busy/unavailable and A sees no third prompt.

- [x] T023 [P] [US4] Extend `e2e/call-waiting.spec.ts`: with A at the two-call cap, a third caller (1:1 and group invite) gets busy/unavailable and A is shown no third prompt (SC-004).
- [x] T024 [US4] Enforce the two-call cap in the second-incoming handlers in `src/composables/useCall.ts`: when `heldCall` is already set (two calls), reply busy exactly as spec 0004 does (1:1 `call-busy`; group `sendGroupBusy`) and do NOT raise the Accept & hold prompt.

**Checkpoint**: The feature is bounded — never more than two calls.

---

## Phase 7: User Story 5 — Hear the hold/swap moments (Priority: P3)

**Goal**: Distinct, subtle, rate-limited cues for the call-waiting alert, hold, resume, and
swap, honouring the tone/mute settings.

**Independent Test**: Trigger a second incoming call, accept-and-hold, swap, resume; each emits
its distinct cue, and disabling tones silences them.

- [x] T025 [P] [US5] Add FAILING vitest for the cue-trigger decisions (pure: which cue for which transition, gated off when sounds disabled) in `src/services/call/slots.test.ts` (or a sibling `cues` test), and assert the four recipes exist in `src/services/sound.ts`.
- [x] T026 [P] [US5] Extend `e2e/call-waiting.spec.ts` using the `recordCues`/`cuesFired` hooks (spec 0004): `callwaiting`/`hold`/`resume`/`swap` each fire distinctly across the transitions, and NONE fire when "Call sounds" is off (SC-006).
- [x] T027 [US5] Finalise the cue recipes + triggers (tones tuned, rate-limited via the existing `claimCue` de-dup) in `src/services/sound.ts` and `src/composables/useCall.ts` — ensure rapid hold/swap doesn't storm cues (cue-fatigue edge).

**Checkpoint**: All five stories complete.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T028 [P] Confirm a held-then-resumed call logs as ONE history entry (no log on hold/swap/resume) — assert in `e2e/call-waiting.spec.ts` (FR-010).
- [x] T029 [P] Bidi/a11y pass on the held-call bar + Accept & hold label in `src/views/detail/CallActivePage.vue` / `src/components/IncomingCallOverlay.vue` (RTL-correct, labelled, theme tokens — Principles X/XI).
- [x] T030 Run the full gate: `npm run build`; `cd server && go build ./... && go vet ./... && go test ./...`; `npm run test:unit`; `RING_E2E_PORT=8085 npm run test:e2e` (call-waiting + no regression to spec 0004 call specs).
- [ ] T031 Walk `specs/0005-call-waiting-hold/quickstart.md` end-to-end, including the on-device iOS/Safari hold/swap check via `make deploy-dev` (the hard cross-browser constraint, FR-013).
- [x] T032 [P] Zero-knowledge review: confirm the server relays only sealed hold/resume signals (indistinguishable from other sealed signals), logs/metrics never print a hold marker or which call is active, and no new server state/metadata was added (FR-012 / Principle I). Satisfies the required `/speckit-checklist` zero-knowledge pass.
- [x] T033 Flip spec `Status:` in `specs/0005-call-waiting-hold/spec.md` to `in-progress` (then `in-review` at PR) and run `make roadmap`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1: T001–T002)**: no dependencies.
- **Foundational (P2: T003–T009)**: depends on Setup — BLOCKS all user stories. (T003 is the failing reducer test, T004 makes it green; they are the pure spine.)
- **User Stories (P3–P7)**: all depend on Foundational. US1 is the MVP; US2/US3 build naturally on US1's hold/connect; US4 is a guard on the US1 handlers; US5 is additive polish.
- **Polish (P8)**: after the desired stories.

### User-story dependencies

- **US1 (P1)**: after Foundational. The MVP.
- **US2 (P1)**: needs US1's held slot + pause/resume; the swap is the resume path applied both ways.
- **US3 (P1)**: needs US1 (a held slot to drop) + US2's resume path (to promote held→active).
- **US4 (P2)**: guards the US1 second-incoming handlers — small, after US1.
- **US5 (P3)**: additive cues over US1–US3 transitions; independent.

### Within each story

- Tests written FIRST and FAIL before implementation (TDD): T003 (failing reducer test) before T004 (reducer impl); T010/T016/T020/T023/T026 before their implementation tasks.
- Pure reducer (`slots.ts`) before the `useCall` wiring that drives it; mesh/1:1 pause primitives before the actions that call them.

### Parallel opportunities

- T001 ‖ T002 (different files).
- T003 ‖ T004 (impl + its test), T009 ‖ T005–T008 setup.
- Within a story, the `[P]` test + UI tasks run alongside the core `useCall` change (different files), e.g. T013 ‖ T014 ‖ T010.

---

## Implementation Strategy

### MVP first (US1)

1. Phase 1 Setup → Phase 2 Foundational (the two-slot spine + pause/resume + green unit tests).
2. Phase 3 US1 → **STOP & VALIDATE**: take a second call without losing the first (1:1 and group), media paused both ways, "on hold" shown. Demo.

### Incremental delivery

US1 (MVP) → US2 swap → US3 drop → US4 cap guard → US5 cues → Polish. Each story is an
independently testable increment that doesn't regress single-call behaviour (spec 0004).

## Notes

- Entirely client-side: `useCall.ts`, `mesh.ts`, `signalling.ts`/`crypto/message.ts`,
  `sound.ts`, `CallActivePage.vue`, `IncomingCallOverlay.vue`, `testhook.ts`, plus the pure
  `slots.ts`. **No server code, no DB migration** (confirm the relay forwards the sealed
  hold/resume signal unchanged).
- Reuse, don't reinvent: pause/resume via the established renegotiation-free `replaceTrack`;
  hold/resume over the existing sealed-signal path; cues via the spec 0004 `callCue` gate;
  busy via the spec 0004 busy reply.
- `/speckit-checklist` (zero-knowledge) is REQUIRED before `/speckit-implement` (touches
  Principle I) — T032 is its in-tasks counterpart.
