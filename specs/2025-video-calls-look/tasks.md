# Tasks: Video calls look sharp again and recover from quality dips

**Input**: Design documents from `/specs/2025-video-calls-look/`

**Prerequisites**: plan.md (design decisions R1–R7), spec.md

**Tests**: INCLUDED and MANDATORY-FIRST — hotfix band (constitution III): failing
regression tests reproducing the defects land before the fixes.

**Organization**: user stories share one pure core (`quality.ts`), so the Foundational
phase carries the red tests + core changes; the story phases wire the consumers.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

No setup tasks — existing repo and toolchain.

---

## Phase 2: Foundational (red tests + pure-core changes)

**⚠️ CRITICAL**: the failing tests (T001) must be committed/observed failing before
T002 lands.

- [X] T001 Extend `src/services/call/quality.test.ts` with FAILING regression + decision tests: (a) floor trap — from `off`, samples that read "bandwidth-limited because nothing but our cap constrains the encoder" must not keep it congested once `off` is a real pause: encode the new contract that a paused sender yields `limitedBy: null` samples and the ladder climbs back (FR-005/SC-003); (b) `limitedBy: 'bandwidth'` with `fractionLost ≤ 0.02` and healthy estimate → NOT congestion (holds/climbs, FR-004); (c) `limitedBy: 'bandwidth'` corroborated by loss > 0.02 → congestion (sustained back-off retained); (d) `limitedBy: 'cpu'` → congestion exactly as today; (e) `initialController('high')` starts at `high` (default stays `medium`); (f) `hd` encoding carries `maxBitrate ≥ 4_000_000`; (g) `downlinkClassFrom` keeps the previous class when the window has < 50 packets; (h) dropped-frame trim requires ratio > 0.25; (i) relaxed loss thresholds map as designed (R5)
- [X] T002 Implement the `quality.ts` changes making T001 green: `StatsSnapshot.limitedBy` replaces `qualityLimited` (update `snapshotFromReport`), corroborated-bandwidth congestion rule in `nextTier` (R1), `initialController(start: Tier = 'medium')` (R3), `TIER_ENCODING.hd.maxBitrate = 4_000_000` (R3), `downlinkClassFrom` minimum-evidence + `> 0.25` drop-trim + relaxed thresholds (R5)

**Checkpoint**: `npx vitest run src/services/call/quality.test.ts` green; all other
vitest suites still green.

---

## Phase 3: User Story 1 — A good connection looks great, quickly (P1)

**Goal**: 1:1 starts `high`, reaches `hd` (now 4 Mbps) ≤6 s; HD capture on non-iOS.

**Independent Test**: drive probe shows tier `high→hd` within ~6 s and ≥1280×720
capture on desktop Chromium.

- [X] T003 [US1] In `src/composables/useCall.ts`: initialize and reset the 1:1 controller with `initialController('high')` (call-start + teardown reset), and adapt every second `pollStats` tick (~2 s cadence, R6) while keeping the 1 s byte/warning/ⓘ updates
- [X] T004 [US1] In `src/composables/useCall.ts`: add a shared `videoConstraints()` helper — `facingMode` + `frameRate ideal 30` + (non-iOS only) `width/height ideal 1280×720` — and use it in `gumConstraints` AND the camera-flip / camera-restore `getUserMedia` call sites, preserving the iOS-unconstrained rule and its iPhone-8 rationale comment
- [X] T005 [P] [US1] Write `drive/scenarios/probe-call-quality.mjs`: two accounts, 1:1 video call on the live dev stack; print captured track settings (expect ≥1280×720), sample the outgoing tier each second for ~20 s (expect `high` at connect, `hd` ≤6 s, no down-steps — SC-001/SC-002 evidence), then `sweep`

**Checkpoint**: probe output shows the climb + steady state; `npm run build` green.

---

## Phase 4: User Story 2 — Quality holds steady (P1)

**Goal**: consumers feed the new `limitedBy` signal; no behavior change needed beyond
Phase 2's core rule.

- [X] T006 [US2] Wire `useCall.ts` and `src/services/call/mesh.ts` to the renamed snapshot field (`limitedBy`), keeping the mesh ⓘ limitation readout working; typecheck-driven sweep of all `qualityLimited` references

**Checkpoint**: `npm run build` + full vitest green.

---

## Phase 5: User Story 3 — Video comes back after a dip (P2)

**Goal**: tier `off` is a real, self-clearing pause in both call paths.

- [X] T007 [US3] 1:1 suspend/resume in `src/composables/useCall.ts`: entering `off` detaches the video sender's track (`replaceTrack(null)`) with an adaptation-owned suspended flag; leaving `off` re-attaches the live local video track + applies the tier encoding; flag cleared on teardown/hold/camera-off so adaptation never re-attaches a track the user (or hold) removed
- [X] T008 [US3] Mesh per-leg suspend/resume in `src/services/call/mesh.ts` `setLegTier`: same semantics per leg (detach on `off`, re-attach on leaving it), guarded against the leg-hold path (`paused`/held peers) and camera-off
- [X] T009 [P] [US3] Extend the probe (or a targeted vitest where feasible) to force the floor via a `low` pin + severe-loss simulation isn't scriptable from outside — so assert the OBSERVABLE contract in the probe instead: pin `low`, confirm tier clamps; unpin, confirm climb resumes ≤10 s (SC-003 proxy at the integration level; the trap itself is covered by T001a at the unit level)

**Checkpoint**: vitest + probe green.

---

## Phase 6: User Story 4 — Receiver hiccups don't cap the sender (P3)

Covered in the pure core (T001g–i / T002); no consumer wiring needed — `reportLegHealth`
and `reportHealthToPeer` already pass per-interval deltas into `downlinkClassFrom`.

- [X] T010 [US4] Verify by inspection + unit tests only: confirm both consumers pass (received+lost) counts such that the < 50-packet windows short-circuit correctly (audio-only intervals, first-window-after-connect), adjusting call sites if the delta plumbing needs the raw counts

**Checkpoint**: full vitest green.

---

## Phase 7: Polish & Gates

- [X] T011 Run gates: `npm run build`, `npx vitest run`, `npx playwright test e2e/call-adaptive.spec.ts e2e/call-quality.spec.ts e2e/call-connect-speed.spec.ts e2e/mutual-call.spec.ts e2e/call-waiting.spec.ts` (hold/resume interplay)
- [X] T012 Bump spec 2025 `**Status**:` (in-progress → in-review) + `make roadmap`

---

## Dependencies & Execution Order

- T001 → T002 (red → green) block everything
- US1: T003, T004 sequential (same file); T005 [P] parallel to both
- US2: T006 after T002 (field rename)
- US3: T007 → T008 (same semantics, two files); T009 [P] after T007
- US4: T010 after T002
- Gates last

## Implementation Strategy

Single hotfix increment: the pure core (Phase 2) is the fix; story phases are wiring
+ evidence. Every phase leaves the suite green; the branch is shared with spec 1039,
so each phase is its own commit referencing spec 2025.
