# Zero-Knowledge & Hidden-State Checklist: Battleship (spec 0011)

**Purpose**: requirements-quality gate (constitution Principle I/IV) for the
first hidden-information game — the secrets, the commitments, and the trust
model. Validates what spec/plan/contract SAY, before implementation.
**Created**: 2026-07-06
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md) | [contract](../contracts/battleship-protocol.md)

## Secrecy of the hidden state

- [x] CHK001 - Does the spec state precisely what never leaves the device (layout + salt) and until when (the end-of-game reveal)? [Completeness, Spec §FR-003]
- [x] CHK002 - Is the device-local storage location and its lifecycle (created at shuffle, cleared at game end / with the bubble) specified? [Completeness, plan §Storage, Spec §Edge/TTL]
- [x] CHK003 - Is what observers/opponents CAN learn during play enumerated exhaustively (commitments, shots, answers — nothing about un-shot cells)? [Clarity, Spec §ZK, contract §What each party learns]
- [x] CHK004 - Is SC-002 (a device provably never RECEIVED the opponent layout pre-reveal) stated as a testable assertion on stored state? [Measurability, Spec §SC-002]

## Commitment scheme quality

- [x] CHK005 - Is the hash primitive the app's existing libsodium SHA-256 (no bespoke crypto), with salt size and encoding pinned? [Consistency, Spec §FR-007, contract §Layout]
- [x] CHK006 - Is the serialization CANONICAL (ship ordering defined) so the same layout can't produce two commitments? [Clarity, contract §Layout]
- [x] CHK007 - Is the commitment binding stated (verification recomputes the hash from the reveal) and hiding adequate for the threat (32-byte random salt against a 8×8 layout-space brute force)? [Coverage, contract §Status & verification]

## Trust model & cheat handling

- [x] CHK008 - Is the friendly-opponent stance explicit: in-play answers trusted, end-of-game verification mandatory, cheating costs the game? [Clarity, Spec §Clarifications, §ZK Trust model]
- [x] CHK009 - Are ALL cheat classes enumerated with their outcome (bad salt, illegal/moved layout, lied answer → deterministic flip; both sides invalid → out-of-sync)? [Coverage, contract §Status, Spec §SC-003]
- [x] CHK010 - Is the forced-reveal mechanism specified so a game cannot END unverified (final answer must carry the loser's reveal; winner's reveal is the only legal next move)? [Completeness, contract §Moves, Spec §Edge]
- [x] CHK011 - Is the never-revealing-winner case handled honestly (game stays "finishing", like any stalled game — no timeout protocol invented)? [Edge Case, Spec §Edge]
- [x] CHK012 - Does resign bypass reveals cleanly (a concession needs no verification)? [Consistency, Spec §US1-7, contract §Status]

## Platform containment

- [x] CHK013 - Zero platform/server changes restated as verifiable-by-diff criteria (engine, challenge layer, crypto payloads, notifications, server)? [Measurability, Spec §FR-001/SC-005]
- [x] CHK014 - Are the auto-sent moves (answers, reveals) placed in the BOARD component, not the platform, with the rationale recorded? [Consistency, plan §Complexity]
- [x] CHK015 - Version skew: pre-0011 clients get the shipped unknown-game fallback? [Coverage, Spec §Edge]
- [x] CHK016 - Are the protocol-critical paths mapped to tests-first tasks (red protocol suite incl. every cheat class; e2e for secrecy + convergence + observers)? [Traceability, plan §Testing → tasks]

## Notes

- Validation run 2026-07-06 (pre-implementation): all 16 items PASS against the
  spec, plan, and contract as committed.
