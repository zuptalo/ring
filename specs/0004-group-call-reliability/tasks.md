---
description: "Task list for spec 0004 — group call reliability, adaptive quality, caps, cues & busy"
---

# Tasks: Group call reliability, adaptive quality, caps, audio cues & busy signalling

**Input**: Design documents from `specs/0004-group-call-reliability/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ws-call-frames.md, quickstart.md

**Tests**: INCLUDED — the constitution mandates TDD (Principle III), and US1/US2 are
bug-class fixes that MUST begin with a failing regression test.

**Organization**: by user story (priority order). Delivery sequence from plan.md:
US1 → US2 → US3 → US6 → US4 → US5. Each story is an independently testable increment.

## Format: `[ID] [P?] [Story] Description`
- **[P]** = parallelizable (different files, no incomplete dependency)
- **[Story]** = US1..US6 (Setup/Foundational/Polish carry no story label)

## Path Conventions
Web app monorepo: client at repo root (`src/`, `e2e/`), server under `server/`.

---

## GitHub issues (for PR `Closes #N`)

| Issue | Scope | Tasks |
|---|---|---|
| #397 | Setup & foundational | T001–T004 |
| #398 | US1 — leaving means leaving | T005–T010 |
| #399 | US2 — busy / no dead-end | T011–T019 |
| #400 | US3 — participant caps | T020–T028 |
| #401 | US6 — SFU teardown + docs | T029–T038 |
| #402 | US4 — adaptive quality + relay creds | T039–T044, T054–T055 |
| #403 | US5 — audio cues | T045–T049 |
| #404 | Polish & cross-cutting | T050–T053 |

The feature→`develop` PR MUST list `Closes #397`…`#404`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared constants the cap + quality work reference.

- [x] T001 [P] Added client call caps `VIDEO_MAX = 4`, `AUDIO_MAX = 8` in `src/services/call/types.ts` (tier ladder lands with US4)
- [x] T002 [P] Added server call caps `VideoMax = 4`, `AudioMax = 8` (var, test-overridable) in `server/internal/call/registry.go`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared test scaffolding reused by multiple stories. No app logic here.

**⚠️ CRITICAL**: complete before the story phases that rely on these helpers.

- [ ] T003 Add an e2e helper for a multi-account group call (join/leave/reconnect a member) in `e2e/support/` reused by US1/US2/US3 specs
- [ ] T004 [P] Add an e2e network-throttling helper (per-context bandwidth/loss) in `e2e/support/` reused by US4

**Checkpoint**: shared helpers ready — story phases can begin.

---

## Phase 3: User Story 1 — Leaving a call means leaving it (Priority: P1) 🎯 MVP

**Goal**: A member who leaves a group call is never auto-re-rung/rejoined by a buffered invite.

**Independent Test**: member joins then leaves; force a socket reconnect within 60s → not
rung/rejoined; a never-joined offline invitee still rings on reconnect.

> **Root cause corrected during TDD** — the buffer hypothesis was disproven (buffer is consumed
> on first reconnect, before any join). Real cause: the server re-ring **reminder loop** is only
> cancelled by join/room-empty/caller-remove, and a declining group invitee never told the server
> to stop (`rejectCall` was silent for group). See research §1.

### Tests for User Story 1 ⚠️ (write first, must FAIL)

- [x] T005 [US1] Failing regression test `server/internal/ws/groupring_test.go`: a declining invitee (`call-leave`) stops the re-ring reminders; positive control proves a silent invitee IS re-rung. Adds the `SetGroupRingCadenceForTest` seam (`groupRingInterval`/`groupRingCount` → `var`) in `internal/ws/testhooks.go`
- [ ] T008 [P] [US1] e2e regression `e2e/call-reinvite.spec.ts`: dismissing a group invite → no re-ring after the reminder interval; a deliberate caller **recall** after decline still rings (FR-004)

### Implementation for User Story 1

- [x] T006 [US1] `call-leave` handler calls `stopGroupMemberRing(roomID, c.userID)` so a decline/leave cancels that member's reminder loop, in `server/internal/ws/hub.go`
- [x] T007 [US1] Client: `rejectCall()` (group branch) and the unanswered-invite timeout send `call-leave {roomId}` via new `sendGroupLeave` (`src/services/call/signalling.ts` + `src/composables/useCall.ts`); a joined call already leaves via mesh teardown
- [x] T009 [US1] Recall safety (FR-004): no client suppression guard added; `teardown` clears `callMeta` and `handleGroupInvite` only ignores invites for a room we're currently in, so a recall still rings — verified, no code change needed

**Checkpoint**: US1 server + client done and unit-tested (server suite green, client typechecks). Remaining: the e2e regression (T008).

---

## Phase 4: User Story 2 — No incoming call is a silent dead-end (Priority: P1)

**Goal**: Every un-takeable incoming call (1:1 or group) returns busy/unavailable; both sides logged.

**Independent Test**: A in a call; B's 1:1 audio, 1:1 video, and group invite each resolve to
busy on B within ~5s; 1:1 decline-with-message still posts; both sides get a history entry.

### Tests for User Story 2 ⚠️ (write first, must FAIL)

- [x] T011 [US2] Regression test `server/internal/ws/groupring_test.go` (`TestGroupBusyRelayedAndStopsRering`): a `call-busy` carrying `roomId` is relayed to the caller (sender stamped) AND stops re-ringing the busy member
- [ ] T012 [P] [US2] e2e `e2e/call-busy.spec.ts`: while A is in a call, a group invite to A resolves A's tile to "busy/unavailable" on the caller within ~5s; other invitees unaffected; 1:1 busy + decline-with-message still work; **multi-device (FR-008)**: when A is busy on one device but idle on another, the idle device rings (NOT busy)
- [ ] T013 [P] [US2] e2e assertion: a refused/declined/missed call writes a history entry on BOTH caller and callee

### Implementation for User Story 2

- [x] T014 [US2] `call-busy` already carries optional `roomId`/`from` (`CallControlFrame` in `src/services/transport.ts`) and the server frame struct carries `RoomID` — no shape change needed
- [x] T015 [US2] `handleGroupInvite` (`src/composables/useCall.ts`): when `callState !== 'idle'` sends `call-busy {to: frame.from, roomId}` via new `sendGroupBusy` instead of silently returning
- [x] T016 [US2] Server: `call-busy` with a `roomId` is relayed to `to` and calls `stopGroupMemberRing(roomId, c.userID)` (the busy sender) in `server/internal/ws/hub.go`
- [x] T017 [US2] Caller side: `call-busy` with a matching `roomId` → `markMemberBusy(from, true)` + clear that member's ring timer, WITHOUT ending the call; non-overriding — the `call-roster` join path clears busy (FR-008). New `busyMembers` ref in `src/composables/useCall.ts`
- [x] T018 [US2] Render the per-invitee "busy"/"Unavailable" tile state (new `'busy'` Tile state + recall menu, stock markup + `--ring-*` tokens) in `src/views/detail/CallActivePage.vue`
- [x] T019 [US2] Call history now distinguishes the outcome: a `Call`/`CallLog` gains `outcome: 'busy'|'unavailable'|'declined'` (no `DB_VERSION` bump — schemaless), `markCallMissed` records it, and the Calls-tab subtitle + chat call-row read "Busy"/"Unavailable"/"Declined" instead of "No answer". `callLogPreview` extracted to a pure `src/db/calllog.ts` and unit-tested (`calllog.test.ts`). (Fixes the reported "busy call logs No answer" bug; callee still logs the incoming as missed.)

**Checkpoint**: US2 core (busy signalling + caller-side tile resolution) done and unit-tested; server suite + client build green. Remaining: e2e (T012/T013) and two-sided history (T019).

---

## Phase 5: User Story 3 — Participant caps (Priority: P1)

**Goal**: 4-video / 8-audio caps enforced client + server; audio→video upgrade blocked above 4.

**Independent Test**: start/join video@5 and audio@9 refused with message+cue; server refuses a
client that bypasses the UI; camera upgrade blocked when roster > 4.

### Tests for User Story 3 ⚠️ (write first, must FAIL)

- [x] T020 [US3] `server/internal/call/registry_test.go` (`TestJoinIfRoom`): `JoinIfRoom` admits up to `max`, refuses the over-cap join without mutating, and always re-admits an already-present user
- [x] T021 [P] [US3] `server/internal/ws/groupring_test.go` (`TestVideoCallCapRefusesOverCapJoin`): an over-cap `call-join` → `call-full` to the joiner and NO roster broadcast (uses `SetVideoMaxForTest`; added `tokC`/`user-c`)
- [ ] T022 [P] [US3] e2e `e2e/call-caps.spec.ts`: 5th video joiner refused, 9th audio refused, camera-on blocked when participants > 4, raw over-cap join refused by server — DEFERRED (e2e)

### Implementation for User Story 3

- [x] T023 [US3] `Registry.JoinIfRoom(roomID, userID, max)` in `server/internal/call/registry.go` (idempotent re-admit; no mutation on refusal)
- [x] T024 [US3] `call-join` derives `max` from `kind` (video→`VideoMax` else `AudioMax`), uses `JoinIfRoom`; on refusal sends `call-full` to the joiner and skips the roster broadcast, in `server/internal/ws/hub.go`
- [x] T025 [P] [US3] Added the `call-full` frame `{ t, roomId, kind }` to `src/services/transport.ts` (`CallFullFrame` + union)
- [x] T026 [US3] Handle inbound `call-full` in `src/composables/useCall.ts`: tears down the local join attempt + "This call is full" toast (cue wired in US5)
- [x] T027 [P] [US3] Cap selection by kind in `NewGroupCallPage.vue` (ad-hoc) and the group call-start in `ChatDetailPage.vue` (selected + self vs cap)
- [x] T028 [US3] Gate the audio→video upgrade in `toggleVideoMode` on `roster.length <= VIDEO_MAX` with an explanatory toast

**Checkpoint**: caps hold at start (picker), at join (server-authoritative `call-full`), and on upgrade. Remaining: e2e (T022).

---

## Phase 6: User Story 6 — One coherent calling architecture (Priority: P3, low-risk)

**Goal**: Delete the dead SFU stack, rewrite CALLING.md, strip migration diagnostics.
(Sequenced before US4 so frame-type edits churn once.)

**Independent Test**: build/vet/test pass with SFU gone; a real group call connects on
iOS/Safari + Chromium; no "group-call SFU ready" boot log; CALLING.md describes the mesh.

### Tests for User Story 6 ⚠️

- [x] T029 [US6] Removed the SFU-specific relay tests (`TestGroupCallKeyRequestRelayed`/`TestGroupCallStreamIdRelayed`) from `server/internal/ws/call_test.go`; `go test ./...` green with those frames no longer handled
- [ ] T030 [P] [US6] Ensure the existing group-call e2e runs under the WebKit (Safari) project to prove no regression in `e2e/` config — DEFERRED (e2e)

### Implementation for User Story 6

- [x] T031 [US6] Deleted `server/internal/sfu/`; ran `go mod tidy` (dropped pion/webrtc, interceptor, rtp, rtcp)
- [x] T032 [US6] Removed SFU construction/wiring + the "group-call SFU ready" log in `server/cmd/ringd/main.go`; cleaned the now-unused `webrtc`/`sfupkg` imports; the TURN loopback (SFU-only) removed and `turn.Start` returns `(*Server, error)`
- [x] T033 [US6] Removed `sfu-*` handlers, the `call-key`/`call-key-request`/`call-streamid` relay cases, and `SetSFU`/`SendCallSignal`/`CallSFU`/`sfu` field from `server/internal/ws/hub.go`; removed the `sfu` hint from `turn_handlers.go`
- [x] T034 [P] [US6] Deleted client `src/services/call/{sfu,e2ee,e2ee-worker,e2ee-format}.ts`
- [x] T035 [US6] Removed the dead `sfu-*`/`call-key*`/`call-streamid` cases in `handleCallFrame` + `services/sync.ts`, the dead senders in `signalling.ts`, and the frame types in `src/services/transport.ts` (added `call-full` routing in sync.ts)
- [x] T036 [US6] Removed the SFU decrypt-tally code from `src/services/call/diag.ts` and de-"DIAG"'d `mesh.ts`'s stats timer comments
- [x] T037 [P] [US6] Kept the ⓘ stats panel as a permanent feature (diag.ts header rewritten; fed by the mesh per-leg stats timer) in `src/views/detail/CallActivePage.vue`
- [x] T038 [P] [US6] Rewrote the relevant `server/docs/CALLING.md` sections for the mesh (no SFU/VP8/insertable-streams/Chromium-only); kept the TURN-over-TLS-on-443 deployment recipe

**Checkpoint**: one architecture, accurate docs, no dead code or false boot log. Remaining: WebKit e2e (T030).

---

## Phase 7: User Story 4 — Adaptive per-receiver quality (Priority: P2, largest)

**Goal**: Start low, climb only with headroom, back off on local + remote-reported congestion,
protect audio (suspend video at the floor), independently per mesh leg and for 1:1.

**Independent Test**: throttled link connects at `low`, climbs, drops mid-call (video suspends,
audio survives); a 3-peer mesh with one throttled peer differentiates tiers per leg.

### Tests for User Story 4 ⚠️ (write first, must FAIL)

- [x] T039 [US4] `src/services/call/quality.test.ts` (12 tests): `nextTier` — K=3 healthy→climb; drop on bandwidth-limit / loss>5% / avail<target; clamp = upper bound; below-pin on congestion; floor→`off`; Safari (missing fields) caps climb at `high`. + `clampForPin`
- [ ] T040 [P] [US4] e2e `e2e/call-adaptive.spec.ts` (throttling): start low (never hd), climb with headroom, drop+video-suspend on throttle while audio continues, per-leg differentiation — DEFERRED (e2e)

### Implementation for User Story 4

- [x] T041 [US4] Pure controller `src/services/call/quality.ts`: `Tier` ladder + `TIER_ENCODING` (low≈150k/medium≈500k/high≈1.2M/hd≈2.5M), `StatsSnapshot`, `nextTier` (AIMD; HD only with demonstrated headroom; never blind-climbs past `high` without a known bitrate), `clampForPin`
- [x] T042 [US4] Per-leg controller in `src/services/call/mesh.ts`: each leg has its own `ControllerState`, sampled from that leg's `getStats()` in the 2s stats tick (`adaptLeg`/`snapshotFromReport`) and applied via `applyLegEncoding`; starts low — true per-receiver adaptation
- [x] T043 [US4] Replaced the publisher-count heuristic: `applyOutgoingQuality` pushes `setQualityClamp(clampForPin(pin, lessData))` to the mesh; the per-leg controllers adapt toward that upper bound
- [x] T044 [US4] 1:1 PC now adapts too: `oneToOneQc` controller stepped from the existing 1s `pollStats` (`adaptOneToOne`), applied via `applySenderTier`; the manual pin + data-saver are the clamp (`qualityClamp`); starts low, reset per call. Shared `snapshotFromReport` moved to `quality.ts`. The old publisher-count `effectiveTier`/`QUALITY_ENCODING` 1:1 path is removed.
- [~] T054 [US4] (FR-034) No unit layer — `buildLeg`/`recover` need a real `RTCPeerConnection` (absent in vitest); covered by the deferred late-joiner e2e (with T040/T030).
- [x] T055 [US4] (FR-034) Refresh TURN creds for late legs + ICE restart in `src/services/call/mesh.ts`: `buildLeg` now calls `getTurnConfig()` per leg (refreshes ~30s before expiry) instead of a once-cached `this.turn` (field removed); a new `restartLegIce` `setConfiguration(rtcConfig(fresh))` before `restartIce` in `recover()`/`onLegState`, so a long-call leg re-gathers with valid creds.

**Checkpoint**: calls survive real networks; quality differs per receiver; audio protected; late joiners connect with valid relay creds (FR-034).

---

## Phase 8: User Story 5 — Audio cues for call states (Priority: P3)

**Goal**: Distinct, subtle, rate-limited cues for every call state/toggle + in-call message.

**Independent Test**: each event emits its distinct cue; rapid toggles don't storm; tones-off silences all.

### Tests for User Story 5 ⚠️ (write first, must FAIL)

- [ ] T045 [US5] Failing unit tests `src/services/sound.test.ts`: `cue()` suppresses a repeat of the same cue within the de-dup window, and every new `ToneName` has a recipe
- [ ] T046 [P] [US5] e2e `e2e/call-cues.spec.ts`: cues fire across state transitions/toggles/call-full/in-call-message, and are silenced when tones are disabled

### Implementation for User Story 5

- [ ] T047 [US5] Add cue recipes (`connecting/connected/reconnecting/callended/mute/unmute/cameraon/cameraoff/callfull/incallmsg`) and a rate-limited `cue(name)` helper in `src/services/sound.ts`
- [ ] T048 [US5] Trigger state cues from `setState()` transitions and the mute/camera toggle paths (and the call-full path from T026) in `src/composables/useCall.ts`
- [ ] T049 [US5] Play the `incallmsg` cue when a message arrives while `callState !== 'idle'` in `src/composables/useSync.ts` `transport.onMessage` (distinct from the normal notification tone)

**Checkpoint**: the call is legible by ear; settings respected.

---

## Phase 9: Polish & Cross-Cutting

- [ ] T050 Run the full gate: `npm run build`, `cd server && go build ./... && go vet ./... && go test ./...`, `npm run test:e2e`
- [ ] T051 Walk `specs/0004-group-call-reliability/quickstart.md` end-to-end (all 6 stories incl. iOS/Safari group call + ZK spot check)
- [ ] T052 [P] Zero-knowledge review: confirm server logs/metrics never print SDP/ICE/media and that `call-full`/group `call-busy` carry only routing fields
- [ ] T053 Flip spec `Status:` to `in-progress` (then `in-review` at PR) and run `make roadmap`

---

## Dependencies & Execution Order

### Phase dependencies
- Setup (P1) → Foundational (P2, e2e helpers) → story phases.
- Delivery order (plan.md): **US1 → US2 → US3 → US6 → US4 → US5** → Polish.
- US1 is server-only and the smallest → true MVP.

### Cross-story notes
- US2 T017/T018 reuse the `markNotJoining`/tile machinery US3 also touches in `useCall.ts` /
  `CallActivePage.vue` — sequence US2 before US3 (same files) rather than parallel.
- US3 `call-full` handling (T026) shows a message now; its **cue** is wired in US5 (T047/T048) —
  US3 ships with a visible message; the cue lands with US5.
- US6 edits `transport.ts` and `useCall.ts` frame handling; do it before US4/US5 to avoid
  re-touching those files. US2/US3 also edit `transport.ts` (additive) — land those first.
- US4 is self-contained in `quality.ts` + `mesh.ts` + the `useCall` wiring it replaces.
- T054/T055 (FR-034, TURN-cred refresh for late joiners) live in the US4 phase by theme but
  are independent of the adaptive controller; they only touch `mesh.ts buildLeg`/`recover`
  and can land any time after US6's `mesh.ts` DIAG strip (T036) to avoid re-touching the file.
- T010 deliberately adds NO client suppression guard (would break recall, FR-004); US1 leans
  on the server-side buffer clear (T008/T009) + the existing in-room dedup.

### Within each story
- Tests first (must fail) → implementation → checkpoint.

### Parallel opportunities
- T001/T002 (client vs server constants) in parallel.
- Within a story, `[P]` tasks touch different files (e.g. US6 T034 client deletes ∥ T031 server delete ∥ T038 docs).
- US4 and US5 are largely independent (`quality.ts`/`mesh.ts` vs `sound.ts`) and could be staffed in parallel after US6.

---

## Parallel Example: User Story 6

```bash
# Independent deletions/rewrites (different files):
Task: "Delete client SFU modules src/services/call/{sfu,e2ee,e2ee-worker,e2ee-format}.ts"   # T034
Task: "Delete server/internal/sfu/ package"                                                  # T031
Task: "Rewrite server/docs/CALLING.md for the mesh"                                          # T038
```

---

## Implementation Strategy

### MVP (US1 only)
Setup → Foundational → US1 → validate (a leaver stays out). Smallest, server-only, highest trust.

### Incremental delivery
US1 → US2 → US3 (the three P1 correctness/safety fixes) → US6 (dead-code removal) →
US4 (adaptive, the headline quality win) → US5 (cues). Each ships and demos independently.

### Notes
- `/speckit-checklist` is REQUIRED before `/speckit-implement` (Principle I touched).
- `/speckit-analyze` must be clean (or findings waived) before implementing.
- Commit per task/group; commit subjects are plain-language release-note copy for `feat`/`fix`.
