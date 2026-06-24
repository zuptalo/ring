# Zero-Knowledge & Privacy Checklist: Adaptive call quality (spec 0007)

**Purpose**: Validate that the spec's zero-knowledge / privacy requirements are complete, clear,
consistent, and testable BEFORE implementation — the constitution-required checklist for a spec
touching Principle I (Zero-Knowledge Boundary) and Principle IX (Privacy & Data Minimization).
**Created**: 2026-06-24
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [contracts/health-signal.md](../contracts/health-signal.md)

> Unit tests for the *requirements*, not the implementation — each asks whether the ZK/privacy
> expectation is written down well enough that a careless implementation would be caught.

## Boundary Invariant — Completeness

- [x] CHK001 - Is it an explicit requirement that the `qos` report is sealed per-pair (Double Ratchet
  for contacts, call-scoped key for non-contact co-members) and relayed as opaque ciphertext?
  [Completeness, Spec §FR-011, contracts]
- [x] CHK002 - Is it stated that `qos` adds NO new server message type, route, field, metadata, or
  stored state, and rides the EXISTING relayed call frame? [Completeness, Spec §FR-011, §SC-007]
- [x] CHK003 - Is the "indistinguishable to the server from other sealed call signalling" property
  stated as a requirement (not just an aside)? [Clarity, contracts]
- [x] CHK004 - Is the absence of any new IndexedDB store / `DB_VERSION` bump / migration captured as
  a requirement? [Coverage, Plan §Constitution V]
- [x] CHK005 - Is the absence of any server code change captured (the relay forwards the sealed frame
  unchanged)? [Coverage, Plan §Constitution VI]

## Payload Data Minimization (Principle IX)

- [x] CHK006 - Is the `qos` payload constrained to COARSE enums + a counter only (`requestedTier`,
  `downlinkClass`, `seq`)? [Completeness, Spec §FR-011, data-model]
- [x] CHK007 - Is it explicitly forbidden to carry raw bandwidth/Mbps, IP, geolocation, or any
  precise network identifier? [Clarity, Spec §FR-011]
- [x] CHK008 - Are the enum value sets bounded/defined (the tier vocabulary), so "coarse" is concrete
  and not an open numeric field? [Measurability, contracts, data-model]
- [x] CHK009 - Is the cadence/volume bounded (≈2s + on-change) so the report can't become a
  high-frequency side-channel? [Clarity, Spec §FR-004]

## Peer-Visible Disclosure

- [x] CHK010 - Does the spec state what a PEER learns from the report (a requested tier + coarse
  downlink class) and that it's limited to what the call needs — not precise link metrics?
  [Completeness, Spec §FR-011, research]
- [x] CHK011 - Is `downlinkClass` justified as diagnostics/info only (the sender acts on
  `requestedTier`), so no extra actionable signal is shared than necessary? [Consistency, data-model]
- [x] CHK012 - Does the design avoid revealing who-sees-whom / the social graph to the server beyond
  what room membership already exposes? [Gap, Spec §FR-011]

## Robustness — Replay / Reorder / Staleness / Forgery

- [x] CHK013 - Are requirements defined for out-of-order / duplicate reports (newest `seq` wins) so a
  replayed report can't take effect? [Coverage, contracts, data-model]
- [x] CHK014 - Is a staleness window defined, after which a sender ignores the report and falls back
  to send-side adaptation (no hang waiting on a peer)? [Completeness, Spec §FR-004, contracts]
- [x] CHK015 - Is it clear that a forged/injected report cannot take effect because the frame is
  sealed+authenticated (a MITM/server can't push a fake cap to degrade a call)? [Gap, Spec §FR-011]
- [x] CHK016 - Is the absent-report (older build / peer never sends) path specified as a safe
  fallback, with no degradation worse than today? [Edge Case, Spec §FR-004]

## Instrumentation & Diagnostics — Client-Local

- [x] CHK017 - Is it required that the ⓘ diagnostics and any connect/quality instrumentation are
  client-local and NEVER transmitted off-device? [Completeness, Spec §FR-009]
- [x] CHK018 - Is it clear the diagnostics expose only locally-derived/already-known signals (no new
  data leaves the device to power the panel)? [Clarity, Spec §FR-009]

## Self-Preview / Capture Privacy

- [x] CHK019 - Is it required that per-receiver quality is achieved via per-sender ENCODING (not by
  altering the shared capture track), so no quality choice leaks across receivers or degrades the
  local preview? [Consistency, Spec §FR-008, research Decision 4]

## Consistency & Measurability

- [x] CHK020 - Are the ZK requirements consistent across spec (FR-011/SC-007), plan (Constitution I),
  and the contract (no drift in what's sealed / what's coarse)? [Consistency]
- [x] CHK021 - Is the zero-knowledge claim independently verifiable (a stated success criterion that
  no new server frame/metadata/state exists)? [Measurability, Spec §SC-007]
- [x] CHK022 - Is the ZK confirmation captured as a gated task/review rather than an assumption?
  [Traceability, Tasks §T026]

## Notes

- Highest implementation-risk items to watch: **CHK007** (don't let a "downlink" field smuggle raw
  Mbps), **CHK015** (a sealed+authenticated cap so the server/MITM can't degrade a call), **CHK017**
  (diagnostics never transmitted), and **CHK019** (per-sender encoding, never a capture-track change
  that would cross receivers or hit the self-preview).
