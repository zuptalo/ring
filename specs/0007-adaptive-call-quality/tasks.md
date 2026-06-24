---
description: "Task list for spec 0007 — adaptive call quality (per-receiver, screen/network-aware, peer-reported health)"
---

# Tasks: Adaptive call quality — per-receiver, network- and screen-aware, with peer-reported health

**Input**: Design documents from `specs/0007-adaptive-call-quality/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/health-signal.md, quickstart.md

**Tests**: REQUIRED (TDD). Touches crypto/ZK (Principle I) and is a quality regression hunt, so the
pure-controller unit tests lead — the regression is reproduced as FAILING assertions, then fixed;
behavioral claims are covered by the throttled multi-party Playwright e2e.

**Organization**: by user story (spec.md). US1 (regression fix) is the MVP; US2 (health report) is
the core model improvement and folds in US3/US4 via the single receiver-requested ceiling.

## Format: `[ID] [P?] [Story] Description with file path`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5; setup/foundational/polish carry no story label

## Path Conventions

Single Vue PWA client (no server change). Key paths: `src/services/call/{quality,mesh,signalling,diag}.ts`,
`src/services/crypto/message.ts`, `src/composables/useCall.ts`, `src/views/detail/CallActivePage.vue`,
`src/services/call/quality.test.ts`, `e2e/`.

---

## Phase 1: Setup

- [ ] T001 Confirm the e2e harness can (a) apply/lift per-context network throttling via CDP
  `Network.emulateNetworkConditions`, and (b) read per-leg adaptive tier + inbound video bitrate via
  the existing test hooks (`meshDiag`/`groupCallDiag`, `remoteTracks`); note any gap to fill in T005.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ Complete before the user-story phases — the signal, plumbing, and test scaffolding all stories need.**

- [ ] T002 Add the sealed `qos` CallSignal kind + coarse payload (`requestedTier`, `downlinkClass`,
  `seq`) to `src/services/crypto/message.ts`, per `contracts/health-signal.md` (enums only — no raw
  bitrate/IP/location).
- [ ] T003 [P] Add `sendHealth(chatId, peerUserId, callId, qos, roomId?)` to
  `src/services/call/signalling.ts`, carrying the `qos` payload over the existing sealed `call-ice`
  frame (mirrors `sendHoldResume`).
- [ ] T004 [P] Add the e2e throttling + introspection helpers to `e2e/helpers.ts`: `throttle(client,
  profile|null)` (CDP emulateNetworkConditions on/off/levels), `legTiers(client)` and
  `inboundVideoBitrate(client, peerId)` readers built on the existing diag/test hooks.
- [ ] T005 [P] Extend `src/services/call/diag.ts` to carry per-leg `tier`, `limitationReason`, the
  peer's reported `requestedTier`/`downlinkClass`, and the manual pin (data plumbing; surfaced in US5).
- [ ] T006 Extend the pure controller surface in `src/services/call/quality.ts`: a `requestedTier`
  input to the per-leg decision and helpers `downlinkClassFrom(stats)` + `tileTarget(sizePx)` +
  `requestedTierOf(downlinkClass, manualPin, tileTarget)` — signatures + types only (behavior + tests
  land per story). Keep it pure/unit-testable.

**Checkpoint**: signal kind, sender, diag fields, e2e helpers, and controller surface exist; no
behavior changed yet.

---

## Phase 3: User Story 1 — Quality is as good as conditions allow (regression fixed) (Priority: P1) 🎯 MVP

**Goal**: On a healthy network, video reaches a clearly-good tier quickly (HD on 1:1, high on group)
and isn't stuck low/blocky — the reported regression is gone.

**Independent test**: On an unthrottled harness, a 1:1 reaches HD and a 3–4-person group reaches high
within ~5s; iOS low tier is a clean downscaled image (on-device).

- [ ] T007 [US1] Write FAILING unit tests in `src/services/call/quality.test.ts` reproducing the
  regression: (a) healthy 1:1 with no `availableOutgoingBitrate` should reach `hd` but currently caps
  at `high`; (b) `tierEncoding('low', true)` keeps full resolution (should downscale); (c) a single
  high-`fractionLost` sample drops a tier (should require sustained); (d) climb from `low` to target
  takes too many steps.
- [ ] T008 [US1] Fix the iOS encoder downscale in `src/services/call/quality.ts`: downscale via the
  sender encoding (`scaleResolutionDownBy`) for low/medium on all platforms; narrow the bitrate-only
  fallback (`avoidEncoderScaling`) to only the genuinely-broken old-WebKit builds (feature/version
  gate), per research Decision 4.
- [ ] T009 [US1] Fix the climb/ceiling/back-off in `nextTier` (`quality.ts`): converge to target fast
  (start sensible / multi-step or shorter streak), allow `hd` on a healthy 1:1/2-person leg without a
  candidate-pair estimate, require SUSTAINED congestion to back off (no single-sample drop), and set
  the AUTO default ceiling = HD (1:1) / high (group), bounded by `clampForPeers` and the tile target.
- [ ] T010 [US1] Apply the corrected controller in `src/services/call/mesh.ts` (`adaptLeg`/
  `effectiveCeiling`/`applyLegEncoding`) and `src/composables/useCall.ts` (`adaptOneToOne`/
  `applyOutgoingQuality`) so every leg + the 1:1 PC use it; record `limitationReason` for diag.
- [ ] T011 [US1] Run T007 to GREEN. Add the e2e in `e2e/call-quality.spec.ts`: on an unthrottled
  network a 1:1 reaches the HD-class tier and a 3-person group reaches `high` within ~5s (SC-001).
- [ ] T012 [US1] Run `e2e/call-adaptive.spec.ts` + `e2e/calls.spec.ts` to confirm no regression to
  the existing adaptive/connect behavior.

**Checkpoint**: healthy-network quality is visibly good and reached quickly; iOS low tier is clean.

---

## Phase 4: User Story 2 — Senders adapt to each receiver's real connection (Priority: P1)

**Goal**: Each receiver reports a `requestedTier` (from its downlink); senders cap per-receiver at it,
so only the weak-link receiver's streams drop.

**Independent test**: Throttle one receiver's downlink in the 4-instance harness; only streams to it
step down (~3–5s) and recover (~10s); others stay high; no freezes.

- [ ] T013 [US2] Write FAILING unit tests (`quality.test.ts`): effective tier = `min(own-tier,
  peerRequestedTier)`; a stale report (older than the staleness window) is ignored (fallback to
  send-side); `downlinkClassFrom(stats)` buckets throughput/loss with hysteresis; `requestedTierOf`
  = min(downlink, pin, tile).
- [ ] T014 [US2] Implement the receiver self-assessment in `quality.ts` (`downlinkClassFrom` from
  inbound throughput/loss/framesDropped, with hysteresis) and the `requestedTier` derivation; wire the
  inbound sampling in `src/services/call/mesh.ts` + `src/composables/useCall.ts`.
- [ ] T015 [US2] Wire the health report end-to-end: send `qos` per peer ~every 2s AND on significant
  change (via `sendHealth`, T003) from `mesh.ts` (per leg) + `useCall.ts` (1:1); receive in the
  `call-ice`/mesh signal handlers, store latest-per-peer (newest `seq`), apply `peerRequestedTier` as
  a hard ceiling in `adaptLeg`/`adaptOneToOne`, with staleness fallback.
- [ ] T016 [US2] Extend `e2e/call-quality.spec.ts` (3–4 instances): throttle one receiver's downlink
  on the fly → only streams TO it drop within ~3–5s (measured inbound + leg tier), others stay high,
  no frozen video; lift throttle → climbs back within ~10s without flapping (SC-002/SC-005).

**Checkpoint**: per-receiver adaptation is driven by each receiver's real, reported downlink.

---

## Phase 5: User Story 3 — Manual quality reduces what others send to you (Priority: P2)

**Goal**: A manual low/medium pin is a hard cap in BOTH directions; self-preview stays full.

**Independent test**: Pin A to low → others' inbound to A drops + A's outgoing caps; every sender's
self-preview unchanged.

- [ ] T017 [US3] Write FAILING unit tests (`quality.test.ts`): the manual pin folds into
  `requestedTier` as a hard cap (so peers cap inbound to the picker) AND clamps the picker's own
  outgoing; `requestedTier` never raises a sender above its sustainable tier.
- [ ] T018 [US3] Wire the manual pin in `src/composables/useCall.ts`: a pin change recomputes our
  `requestedTier` and sends an immediate `qos` to all peers; apply the pin to our own outgoing clamp;
  confirm the self-preview binds the full local stream (encoding caps are per-sender, FR-008) — add
  no track-level constraint.
- [ ] T019 [US3] Extend `e2e/call-quality.spec.ts`: pin one participant to low → measured inbound to
  it drops to the low tier and its outgoing caps, while each sender's self-preview remains full
  quality (SC-003); returning to auto climbs inbound back.

**Checkpoint**: manual low/medium controls incoming as well as outgoing; previews unaffected.

---

## Phase 6: User Story 4 — Quality matches the screen/tile size (Priority: P2)

**Goal**: A small grid tile requests less than a fullscreen view; updates on layout change.

**Independent test**: Same peer in a small tile vs fullscreen → different requestedTier/target.

- [ ] T020 [US4] Write FAILING unit tests (`quality.test.ts`): `tileTarget(sizePx)` maps rendered
  size → tier (small→lower, fullscreen→hd) and folds into `requestedTier` via `min`.
- [ ] T021 [US4] In `src/views/detail/CallActivePage.vue`, measure each remote tile's rendered size
  (ResizeObserver) and thread it into that peer's `requestedTier` (rate-limited so layout churn
  doesn't thrash the encoder); recompute on fullscreen/grid changes.
- [ ] T022 [US4] Extend `e2e/call-quality.spec.ts`: the requestedTier/target for a peer shown in a
  small grid tile is lower than when the same peer is brought fullscreen (SC-004).

**Checkpoint**: quality is right-sized to the display.

---

## Phase 7: User Story 5 — See the decisions in the ⓘ panel (Priority: P3)

**Goal**: The ⓘ panel shows, per leg, the tier + the signals behind it.

**Independent test**: Open ⓘ during a throttled call → per-leg tier + reported downlink + limitation
reason shown and tracking the throttle.

- [ ] T023 [US5] Surface the richer per-leg diagnostics in `src/services/call/diag.ts` snapshot +
  `src/views/detail/CallActivePage.vue` ⓘ panel: current tier, limitation reason, peer's reported
  requestedTier/downlinkClass, manual pin (alongside the existing codec/bitrate/frames).
- [ ] T024 [US5] Extend `e2e/call-quality.spec.ts`: with the ⓘ data exposed via a test hook, assert
  per-leg tier + reported downlink + limitation reason are present and change as a leg is throttled
  (SC-006).

**Checkpoint**: the controller's decisions are observable.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T025 [P] Assert audio is protected over video under severe congestion (video drops to `off`
  before audio is affected) in `e2e/call-quality.spec.ts` (spec Edge Cases).
- [ ] T026 Zero-knowledge confirmation (Principle I): the `qos` report is sealed per-pair over the
  existing `call-ice` relay, coarse enums only, no new server frame/metadata/state; instrumentation
  is dev-only. Satisfies the required `/speckit-checklist` zero-knowledge pass.
- [ ] T027 Full gate: `npm run build`; `npm run test:unit`; `cd server && go build ./... && go vet
  ./... && go test ./...`; `RING_E2E_PORT=8085 npm run test:e2e` (call-quality + no regression to
  call-adaptive / calls / call-waiting / call-connect-speed).
- [ ] T028 Walk `specs/0007-adaptive-call-quality/quickstart.md`, incl. the on-device iOS/Safari image
  check via `make deploy-dev`: low tier is a clean small image (not blocky), HD-class on a good link,
  and the self-preview stays full quality regardless of what's sent (FR-002/FR-008).
- [ ] T029 Flip spec `Status:` in `specs/0007-adaptive-call-quality/spec.md` to `in-progress` (then
  `in-review` at PR) and run `make roadmap`.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T006)** before any story.
- **US1 (T007–T012)** is the MVP and should land first (the regression fix); it touches `quality.ts`
  which later stories build on.
- **US2 (T013–T016)** depends on Foundational + US1's corrected controller; it establishes the
  health report that **US3** (T017–T019) and **US4** (T020–T022) extend (both fold into the single
  `requestedTier`). US3 and US4 are largely independent of each other once US2 lands.
- **US5 (T023–T024)** depends on the diag fields (T005) + the controller state from US1/US2.
- **Polish (T025–T029)** last.
- **TDD**: each story's FAILING unit task precedes its implementation (T007→T008/T009; T013→T014/T015;
  T017→T018; T020→T021).

## Parallel Execution Examples

- Foundational: **T003**, **T004**, **T005** are different files → parallel; **T002** (message.ts)
  should land first (T003 references the kind), and **T006** (quality.ts surface) is independent.
- Within US2: the unit test (T013) and the e2e scaffolding for T016 can be drafted in parallel, but
  `quality.ts` (T014) and the mesh/useCall wiring (T015) are sequential on shared files.

## Implementation Strategy

- **MVP = US1** (regression fixed) — independently shippable and the user's primary complaint. **US1
  + US2** together deliver the real model improvement (per-receiver, real-downlink-driven). US3/US4
  ride US2's `requestedTier` ceiling; US5 is observability.
- Keep the decision logic in the **pure `quality.ts`** (deterministic unit gate); `mesh.ts`/
  `useCall.ts` are I/O; the throttled e2e proves the system behavior.
- Zero-knowledge: the `qos` report stays sealed + coarse; no server change. Verify with the checklist.
