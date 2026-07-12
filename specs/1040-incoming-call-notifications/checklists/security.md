# Zero-Knowledge & Crypto-Discipline Checklist: sealed callEvent frame + push/notification surfaces (spec 1040)

**Purpose**: Validate the requirements themselves (spec/plan/contracts) for the
constitution's Principle I/IV surfaces before implementation — mandated by the
plan's Constitution Check (new E2EE frame kind).
**Created**: 2026-07-12
**Feature**: [spec.md](../spec.md) · [contracts/call-event.md](../contracts/call-event.md) · [contracts/connections-api.md](../contracts/connections-api.md)

## Zero-Knowledge Boundary

- [x] CHK001 - Does the spec enumerate what crosses the wire for every new flow (ring marker, ended marker, accepted-row echo), what is encrypted, and what metadata stays visible? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK002 - Is the push-payload constraint stated measurably (no names, user ids, group ids in plaintext; type-only tickles) with a success criterion? [Measurability, Spec §FR-003, §SC-005]
- [x] CHK003 - Is it explicit that the server-side friend-request change echoes only state the server already stores, to its own requester? [Clarity, contracts/connections-api.md]
- [x] CHK004 - Are requirements explicit that identity is resolved exclusively on-device or from E2EE material the device can decrypt? [Completeness, Spec §FR-003, §FR-023]
- [x] CHK005 - Is the fallback on unresolvable identity specified as degrade-to-generic, never delay/suppress the alert? [Clarity, Spec §FR-004]

## Identity Exposure Surfaces

- [x] CHK006 - Is hidden-chat precedence defined for every notification surface the feature touches — ring AND missed replacement AND badge/trace exclusions? [Coverage, Spec §FR-005, §FR-017] *(FR-005 tightened during this checklist run to name both ring and missed surfaces explicitly)*
- [x] CHK007 - Is the raw-internal-identifier prohibition scoped to all notification surfaces, not only the ring? [Coverage, Spec §FR-006] *(FR-006 broadened during this run: "in any notification")*
- [x] CHK008 - Are lock-screen exposure requirements consistent between the named ring, the missed replacement, and friend-request outcome notes (named only when the relationship already knows the identity)? [Consistency, Spec §FR-001/§FR-012a/§FR-019, §Assumptions]

## Sealed Frame Discipline (Principle IV)

- [x] CHK009 - Do the requirements confine the new frame to an optional field inside the EXISTING sealed payload, sealed/opened by unchanged code (no new primitive, key exchange, or channel)? [Completeness, contracts/call-event.md §Envelope, plan.md §Constitution IV]
- [x] CHK010 - Are duplication/replay semantics defined and testable (idempotent by callId; existing row always wins; markers never overwrite)? [Measurability, Spec §FR-018, contracts/call-event.md §Receiver]
- [x] CHK011 - Are out-of-order arrivals specified (ended before ring; ring after ended; stale ring reconciliation) without contradictory outcomes? [Edge Case, data-model.md §Pending call events]
- [x] CHK012 - Is the sender trust model documented (markers ride the authenticated pairwise ratchet, so a peer can only assert calls under their own identity; a fabricated marker is nuisance-equivalent to a real cancelled call)? [Assumption, Spec §Assumptions] *(assumption added during this run)*
- [x] CHK013 - Is the SW's read-only constraint (never persist, never ack from preview — spec 1032 single-writer invariant) carried into the requirements artifacts? [Consistency, contracts/call-event.md §Receiver, plan.md §Constraints]

## Degradation & Platform Constraints

- [x] CHK014 - Are locked-device behaviors specified for each surface (generic ring, generic missed copy, badge undercount-never-overcount)? [Coverage, Spec §FR-004, §FR-008]
- [x] CHK015 - Is the iOS visible-wake constraint accounted for on every new wake outcome, including the nothing-to-show `answered` path? [Coverage, plan.md §Constraints, quickstart.md §Gotchas]
- [x] CHK016 - Are retention/cleanup rules defined for the new client-side state (pending call events, badge units) so nothing accumulates unbounded? [Completeness, data-model.md §SW call-badge units]

## Friend-Request Outcome Surface

- [x] CHK017 - Is at-most-once announcement measurable, with the server visibility window explicitly inside the client dedup-ledger TTL (24h < 48h)? [Measurability, Spec §FR-022, contracts/connections-api.md]
- [x] CHK018 - Is the fallback copy requirement stated as event-neutral (never claims a new incoming request) rather than as a specific string? [Clarity, Spec §FR-021]
- [x] CHK019 - Are the consumers of the widened outgoing set enumerated with their expected non-impact (UI filters pending; badge counts incoming only)? [Coverage, contracts/connections-api.md §Consumers]

## Notes

- All 19 items PASS after three tightening edits made during this run:
  FR-005 now names both the ring and missed-call notifications, FR-006 covers
  every notification surface, and the Assumptions section documents the
  marker sender trust model. No open findings; implement may proceed.
