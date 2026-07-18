# Checklist: Zero-Knowledge Requirements Quality

**Feature**: Push zombie subscriptions & silent-wake strikes (`2043`)
**Created**: 2026-07-18
**Purpose**: Unit-test the REQUIREMENTS for zero-knowledge quality (Constitution Principle I).
Each item validates whether the spec *specifies* the boundary clearly, completely, and
measurably — not whether the code works. Checked = the requirement is well-specified; the
evidence section is cited.

## Requirement Completeness

- [X] CHK001 Does the spec include a dedicated Zero-Knowledge Impact section stating what crosses the wire, what is encrypted, and what metadata is unavoidably visible? [Completeness, Spec §Zero-Knowledge Impact]
- [X] CHK002 Is every NEW server surface this feature adds enumerated with its exact returned fields for ZK review (status endpoint, fleet log)? [Completeness, Spec §Zero-Knowledge Impact, §FR-003/§FR-006]
- [X] CHK003 Are the on-device wake ledger's stored fields fully enumerated so it's clear no plaintext is retained? [Completeness, Spec §FR-007, §Zero-Knowledge Impact]
- [X] CHK004 Is the default state of the production diagnostic (off) specified, and the exact class of content it may surface? [Completeness, Spec §FR-008, §Zero-Knowledge Impact]
- [X] CHK005 Does the spec state that no new plaintext enters any log, metric, error payload, or migration? [Completeness, Spec §Zero-Knowledge Impact, §FR-009]

## Requirement Clarity

- [X] CHK006 Is "content-free" defined concretely (enum kind, enum outcome, count, timestamp — no sender/body/tag) rather than left as an adjective? [Clarity, Spec §FR-007, §Key Entities]
- [X] CHK007 Is the `/relay/status` payload specified precisely enough (timestamp + count, null-when-empty) to confirm it carries no capability id or ciphertext? [Clarity, Spec §FR-003, contracts/relay-status.md]
- [X] CHK008 Is the diagnostic's "reason code" characterized as an internal token set (e.g. timeout, clean-resolve-no-show), distinguishing it from sender/message text? [Clarity, Spec §Zero-Knowledge Impact]

## Requirement Consistency

- [X] CHK009 Is the new status endpoint's metadata exposure justified as ≤ what the existing `/relay/pending` already exposes, so the boundary is not widened? [Consistency, Spec §Zero-Knowledge Impact]
- [X] CHK010 Do the force-rotation requirements stay consistent with the existing single-subscription-per-user design without introducing a new server-visible identifier? [Consistency, Spec §FR-005, §Assumptions]
- [X] CHK011 Are the ZK claims in the spec, the plan's Constitution Check, and the contract mutually consistent (no surface described as content-free in one and content-bearing in another)? [Consistency, Spec/Plan/contracts]

## Acceptance Criteria Quality

- [X] CHK012 Is there a measurable success criterion asserting no new surface transmits/stores plaintext, and is it tied to this checklist as its verification? [Measurability, Spec §SC-004]
- [X] CHK013 Can "side-effect-free" for the status endpoint be objectively verified (no dequeue, no delivery receipt) as written? [Measurability, Spec §FR-003, contracts/relay-status.md]

## Scenario & Edge-Case Coverage

- [X] CHK014 Do the requirements cover the empty-queue case for the status endpoint (null, not an epoch-0 timestamp) so no misleading metadata is emitted? [Edge Case, Spec §Edge Cases, contracts/relay-status.md]
- [X] CHK015 Is the ledger's bounded size specified so it cannot grow into a large local plaintext-adjacent store? [Coverage, Spec §FR-007]
- [X] CHK016 Are auth/authorization requirements for the status endpoint specified (authenticated caller IS the recipient) so one device can't read another's queue metadata? [Coverage, contracts/relay-status.md]

## Dependencies & Assumptions

- [X] CHK017 Is the assumption that `relay_queue.created_at` / row count are already server-held (relay-necessary) metadata stated, so the endpoint adds no new collection? [Assumption, Spec §Zero-Knowledge Impact, §Assumptions]
- [X] CHK018 Is it documented that the feature touches neither crypto primitives nor `SECRETS_KEY`, bounding its ZK/secret-material blast radius? [Assumption, Plan §Constitution Check IV/VI]

## Ambiguities & Conflicts

- [X] CHK019 Is there any requirement whose wording could be read as sending message content to the server for the self-heal? (Resolved: heal reads only queue age/count.) [Ambiguity, Spec §FR-004, §Zero-Knowledge Impact]
- [X] CHK020 Is the diagnostic toggle unambiguously scoped to reason codes only, with no path to enabling sender/body exposure? [Ambiguity, Spec §FR-008, §Zero-Knowledge Impact]

## Result

All 20 items satisfied — the requirements specify a boundary that stays content-free on every
new surface. No CRITICAL ZK gaps. Cleared against Constitution Principle I.
