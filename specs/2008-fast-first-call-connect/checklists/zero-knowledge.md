# Zero-Knowledge & Privacy Checklist: Fast first-call connect (spec 2008)

**Purpose**: Validate that the spec's zero-knowledge / privacy requirements are complete, clear,
consistent, and testable BEFORE implementation — the constitution-required checklist for a spec
touching Principle I (Zero-Knowledge Boundary) and Principle IX (Privacy & Data Minimization).
**Created**: 2026-06-24
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [tasks.md](../tasks.md)

> These are unit tests for the *requirements*, not the implementation. Each asks whether the ZK/
> privacy expectation is written down well enough that a careless implementation would be caught.

## Boundary Invariant — Completeness

- [x] CHK001 - Is the "timing/ordering change only" claim stated as an explicit, testable
  requirement (no new server frame type, no new server-visible metadata, no new stored state, no
  migration, no IndexedDB change)? [Completeness, Spec §FR-009]
- [x] CHK002 - Is there a requirement that SDP and ICE candidates remain sealed exactly as today,
  with the server relaying only ciphertext? [Completeness, Spec §FR-009]
- [x] CHK003 - Does the spec state that this feature adds **no** new client→server message and
  reuses only existing requests, so "no new metadata" is verifiable by enumeration? [Clarity,
  Spec §FR-009]
- [x] CHK004 - Is the absence of any IndexedDB/store/`DB_VERSION` change captured as a requirement
  (not just an assumption), so a reviewer can assert it? [Completeness, Plan §Constitution V]
- [x] CHK005 - Is the absence of any server/migration change captured as a requirement? [Coverage,
  Plan §Constitution VI]

## TURN Credential Warming — Metadata & Timing Leak

- [x] CHK006 - Is it specified that warming the credential cache changes only **when** the existing
  authenticated request is made, not **what** it returns or reveals? [Clarity, Spec §FR-004,
  Research Decision 1]
- [x] CHK007 - Are requirements defined for the warm timing points (outgoing intent; incoming ring)
  such that they cannot fire for non-call events (no speculative/background warming that would
  signal intent the server didn't already have)? [Coverage, Tasks §T004/T011]
- [x] CHK008 - Does the spec address whether warming on **incoming ring** exposes any new signal to
  the server about the callee (e.g. a credential fetch correlating to "is being rung") beyond what
  the existing offer relay already implies? [Gap, Ambiguity, Spec §FR-004]
- [x] CHK009 - Is there a requirement that the warmed request carries no call/peer identifiers it
  didn't already carry (same payload, same endpoint)? [Completeness, Research Decision 1]
- [x] CHK010 - Is idempotency/rate of the warm specified so repeated warming can't become a new
  high-frequency server-visible pattern? [Clarity, Tasks §T004]

## Instrumentation Hook — Client-Local & Dev-Only

- [x] CHK011 - Is it required that the connect-milestone instrumentation is client-local and never
  transmitted to the server or any third party? [Completeness, Data-model §ConnectMilestones]
- [x] CHK012 - Is it required that the instrumentation is dev/test-only and stripped from
  production builds (no production weight, no production surface)? [Clarity, Plan §Structure,
  Data-model]
- [x] CHK013 - Is it specified that the milestones hold only ephemeral timestamps (no SDP, ICE,
  keys, media, or peer identifiers)? [Completeness, Data-model §Validation rules]
- [x] CHK014 - Are the milestone fields enumerated precisely enough that a reviewer can confirm
  none of them is sensitive content? [Measurability, Data-model §ConnectMilestones]

## Pre-Accept Media Capture — Privacy (Principle IX)

- [x] CHK015 - Is there an explicit requirement that no camera/microphone capture occurs before the
  callee accepts? [Completeness, Spec §FR-007]
- [x] CHK016 - Is the boundary between safe pre-accept work (network/SDP prep, TURN warm) and
  prohibited pre-accept work (media capture) stated unambiguously? [Clarity, Tasks §T011,
  Research Decision 2]
- [x] CHK017 - Does the spec ensure the "pre-create PC / setRemoteDescription during ring" option
  (if pursued) cannot start media or emit media to the peer before accept? [Edge Case, Research
  Decision 2]
- [x] CHK018 - Is there a requirement that media is not exchanged before the call is actually
  accepted (speed comes from removing waits, never from connecting early)? [Consistency, Spec
  §FR-007]

## Measurability — ZK-Preserving Acceptance Criteria

- [x] CHK019 - Is the deterministic ordering/overlap gate (the non-flaky primary gate) specified in
  a way that observes only local milestones, not anything that would require weakening sealing or
  adding server visibility? [Measurability, Spec §SC-005]
- [x] CHK020 - Are the parity targets quantified (median TTFM ≤ second-call + 1000 ms; media ≤
  2000 ms of answer) so success is objectively verifiable without inspecting plaintext or server
  state? [Measurability, Spec §SC-001/§SC-002]
- [x] CHK021 - Is there a requirement that the existing call/call-waiting suites and the
  zero-knowledge boundary remain green (no regression in what the relay sees)? [Coverage, Spec
  §SC-004, Tasks §T017]
- [x] CHK022 - Is the zero-knowledge confirmation itself captured as a checklist/review task, so it
  is a gated step rather than an assumption? [Traceability, Tasks §T017]

## Consistency & Edge Cases (Implementation-Risk)

- [x] CHK023 - Are the ZK requirements consistent across spec (FR-009), plan (Constitution I), and
  tasks (T017) — same invariant, no drift? [Consistency]
- [x] CHK024 - Does the spec address the failure/teardown path so a cancelled or declined call
  cannot leave a warmed credential, half-open PC, or instrumentation state that leaks intent or
  lingers? [Edge Case, Gap, Spec §Edge Cases]
- [x] CHK025 - Is iOS/Safari covered such that the platform-specific path doesn't introduce a
  different (e.g. earlier-capture) behavior that would violate the no-pre-accept-media rule?
  [Coverage, Spec §FR-008]
- [x] CHK026 - Is the group first-leg path (US3) held to the same ZK/privacy invariants as 1:1, so
  an optimization there can't add server-visible metadata or early capture? [Coverage, Spec §US3,
  Tasks §T014/§T015]

## Notes

- The spec's **Zero-Knowledge Impact** section (FR-009, FR-012-equivalent reasoning) and the plan's
  Constitution Check (Principle I) assert the timing-only invariant; this checklist exists to make
  each facet individually testable before `/speckit-implement`.
- Highest implementation-risk items to watch: **CHK008** (does ring-time TURN warm correlate to
  "being rung"? — confirm the offer relay already exposes this, so warming adds nothing), **CHK015–
  CHK017** (no camera before accept, including any pre-create-PC optimization), and **CHK024**
  (clean teardown leaves no warmed/half-open state).
