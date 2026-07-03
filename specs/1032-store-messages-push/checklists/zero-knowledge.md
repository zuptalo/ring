# Zero-Knowledge & Crypto-Discipline Checklist: Messages store on push (spec 1032)

**Purpose**: Validate that the requirements for the SW authoritative receive path are
complete, unambiguous, and consistent with constitution Principles I (Zero-Knowledge
Boundary) and IV (Crypto Discipline) — before implementation. This checklist tests the
requirements writing, not the implementation.
**Created**: 2026-07-03
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [research.md](../research.md) · [contracts/sw-receive.md](../contracts/sw-receive.md)

## Zero-Knowledge Boundary (Principle I)

- [x] CHK001 - Does the spec contain the mandated Zero-Knowledge Impact section answering
  all four questions (what crosses the wire, what is encrypted, what metadata is visible,
  why)? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK002 - Is it explicitly stated that no new wire surface is introduced (same tickle,
  same pending fetch, same ack endpoint) and that only ack *timing* changes? [Clarity,
  Spec §FR-012, Contracts §Wire]
- [x] CHK003 - Is the claim "earlier confirmation adds no new server signal" grounded in a
  documented existing behavior (delivered receipts already emitted at fetch time)?
  [Traceability, Spec §Zero-Knowledge Impact, Research §D5/D8]
- [x] CHK004 - Are requirements explicit that decryption and storage happen only on the
  recipient's device, in every mode (applied, deferred, degraded)? [Coverage, Spec §FR-001,
  §FR-006, §FR-008]
- [x] CHK005 - Is the notification-content requirement stated posture-by-posture (default,
  generic previews, hidden conversations, PIN/passkey lock) with "identical to today" as
  the measurable bar? [Measurability, Spec §FR-006, §SC-005]
- [x] CHK006 - Does the spec avoid requiring any server-side change, and is that stated as
  a testable requirement rather than an aspiration? [Clarity, Spec §FR-012]

## Crypto Discipline (Principle IV)

- [x] CHK007 - Do the requirements reuse the existing Double Ratchet/X3DH core without
  inventing primitives, and is the *only* crypto-layer change (a staged open that defers
  persistence to the caller) explicitly bounded? [Completeness, Contracts §messaging.ts,
  Research §D2]
- [x] CHK008 - Is the superseded invariant ("SW never persists DH steps") explicitly
  identified with its original rationale, the reason it can now be retired (cross-context
  locks), and the requirement to rewrite the code comments that encode it? [Traceability,
  Research §D3, Plan §Design details]
- [x] CHK009 - Is the purity boundary preserved in the requirements (crypto core pure;
  messaging.ts crypto-only; one-directional dependency sw-drain→messaging mirroring
  queries→messaging)? [Consistency, Plan §Constitution Check IV, Contracts §messaging.ts]
- [x] CHK010 - Are first-contact X3DH establishment and prekey re-init explicitly OUT of
  the SW path (deferred), so one-time-prekey/session-replacement semantics never run
  headless? [Coverage, Spec §FR-004, Contracts §openPacketStaged]
- [x] CHK011 - Do the requirements mandate adversarial crypto tests — forgery, replay,
  out-of-order (>50 backlog via skipped keys), and send-chain integrity after an
  SW-persisted DH step? [Completeness, Plan §Verification, Contracts §Invariants 2/5]
- [x] CHK012 - Is a security review explicitly required for the crypto behavior change?
  [Completeness, Plan §Constitution Check IV, §Complexity Tracking]
- [x] CHK013 - Is the PIN/passkey posture requirement stated as an absolute (no decrypt,
  no storage, generic notification, frame stays queued) rather than a best-effort?
  [Clarity, Spec §FR-006, US2 scenarios]

## Concurrency & Exactly-Once (the risk this design carries)

- [x] CHK014 - Is the mutual-exclusion requirement stated as a hard invariant ("the two
  contexts MUST never advance the secure channel concurrently") with the coordination
  mechanism, lock names, ordering, and timeout behavior specified? [Clarity, Spec §FR-007,
  Contracts §Lock contract]
- [x] CHK015 - Is exactly-once application defined across BOTH delivery paths with the
  arbiter named (shared seen-ledger) and the double-count hazard (unread+1) addressed by
  requirement, not implementation hope? [Measurability, Spec §FR-003, §FR-005]
- [x] CHK016 - Is atomicity scoped precisely (which writes commit together) and is the
  ack-after-durable-commit ordering a standalone requirement? [Completeness, Spec §FR-002,
  §FR-005, Data-model §State transitions]
- [x] CHK017 - Are ALL interruption orderings enumerated with their required outcomes
  (killed pre-commit, killed post-commit pre-ack, storage failure)? [Edge Case Coverage,
  Spec §Edge Cases, Data-model §State transitions]
- [x] CHK018 - Is the live-call hazard (call signalling rides the same pairwise ratchet)
  addressed by an explicit requirement that message storage never disrupts signalling?
  [Coverage, Spec §Edge Cases, Research §D3]

## Degrade & Fallback Semantics

- [x] CHK019 - Is "degrade to exactly today's behavior" enumerated per trigger (flag off,
  locked, no Web Locks, lock timeout, decrypt failure, storage failure, interrupted run)
  rather than as a blanket sentence? [Completeness, Spec §FR-008, Quickstart §Degrade
  checklist]
- [x] CHK020 - Is the deferral list (ineligible frame types) exhaustive and mutually
  exclusive with the eligibility definition, so no frame type is unspecified? [Consistency,
  Spec §FR-004, Research §D4]
- [x] CHK021 - Is the page-wins policy (live client claiming the drain) kept as an explicit
  precondition of the SW path? [Consistency, Spec US3 scenario 4, Plan §Gate]

## Dependencies & Assumptions

- [x] CHK022 - Is the single-device invariant documented as a *precondition* with evidence
  (one push subscription per user, overwrite-on-register) and a stated obligation to
  revisit the ack rule if multi-device ever ships? [Assumption, Spec §Assumptions,
  Research §D8]
- [x] CHK023 - Is the durability framing (acked ⇒ device-only copy, symmetric with today's
  page behavior; un-acked ⇒ server retention) stated as an accepted trade-off rather than
  left implicit? [Assumption, Spec §Assumptions, Research §D8]
- [x] CHK024 - Is the SW/page version-skew constraint (serialized session format frozen for
  this release) recorded with its trigger (`registerType: 'prompt'` keeps old SWs alive)?
  [Dependency, Research §D9, Plan §Constitution Check]
- [x] CHK025 - Is the >50-frame backlog bound documented with the required user-visible
  outcome (no ordering anomaly; remainder drains on open) and a test obligation? [Edge
  Case, Research §D9, Plan §Verification]

## Notes

- All 25 items pass against the current spec/plan/research/contracts set. Items were
  validated by reading the artifacts, not the codebase — implementation conformance is
  the job of the test suites ordered in tasks.md, not this checklist.
- The riskiest requirement (CHK014/CHK008: retiring the no-DH-persist rule under locks)
  is deliberately covered by three layers: hard invariant in the spec (FR-007), lock
  contract in contracts/, and a mandated security review (CHK012).
