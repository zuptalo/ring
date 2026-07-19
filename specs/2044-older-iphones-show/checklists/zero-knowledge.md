# Checklist: Zero-Knowledge Requirements Quality

**Feature**: Legacy-iOS lite push path (`2044`)
**Created**: 2026-07-19
**Purpose**: Unit-test the REQUIREMENTS for zero-knowledge quality (Constitution
Principle I). Checked = the requirement is well-specified; evidence cited.

## Requirement Completeness

- [X] CHK001 Does the spec include a Zero-Knowledge Impact section stating what crosses the wire and what is visible? [Completeness, Spec §Zero-Knowledge Impact]
- [X] CHK002 Is it specified that the lite path adds NO new endpoints, payloads, fields, logs, or metrics — on either side? [Completeness, Spec §Zero-Knowledge Impact, §FR-008]
- [X] CHK003 Is the generic notification's content specified as content-free by construction (no sender, no body)? [Completeness, Spec §Zero-Knowledge Impact]

## Requirement Clarity

- [X] CHK004 Is "transmits strictly less" concrete — the lite path reuses the existing content-free tickle and existing authenticated fetch, and never attempts decryption? [Clarity, Spec §FR-008, §Zero-Knowledge Impact]
- [X] CHK005 Is the single at-risk IDB read (the session token) named, bounded, and sequenced strictly after the show? [Clarity, Spec §FR-003, §Key Entities]

## Requirement Consistency

- [X] CHK006 Do the lite-path requirements stay consistent with the existing preview contract (fetch emits delivered, never acks/dequeues — the page drains durably)? [Consistency, Spec §FR-003, plan §Design decisions]
- [X] CHK007 Is the modern-path isolation requirement consistent across spec (FR-007), plan (Constitution Check), and tests (isolation pin)? [Consistency]

## Acceptance Criteria Quality

- [X] CHK008 Is there a measurable criterion that no plaintext-bearing surface is added (nothing new crosses the wire at all)? [Measurability, Spec §FR-008, §SC-003]
- [X] CHK009 Can "visible before any IndexedDB/decrypt work" be objectively verified (ordering requirement + unit/device tests)? [Measurability, Spec §FR-002, §SC-001/004]

## Scenario & Edge-Case Coverage

- [X] CHK010 Is the hung-token-read case specified (no receipts this wake, notification already shown, idempotent recovery)? [Edge Case, Spec §Edge Cases]
- [X] CHK011 Is the failure direction of the detector specified (unparseable → modern, never a silent downgrade)? [Coverage, Spec §FR-001, §US2]

## Ambiguities & Conflicts

- [X] CHK012 Could any requirement be read as adding content to the push or to the generic on legacy devices? (Resolved: content-free by construction, same tickle.) [Ambiguity, Spec §Zero-Knowledge Impact]

## Result

All 12 items satisfied — the lite path narrows the boundary (less computed, nothing new
transmitted). No CRITICAL ZK gaps. Cleared against Constitution Principle I.
