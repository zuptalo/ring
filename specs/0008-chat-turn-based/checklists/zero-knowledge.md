# Zero-Knowledge & Wire-Payload Checklist: In-Chat Turn-Based Games

**Purpose**: Requirements-quality gate (constitution Principle I) for the sealed-payload
additions: server blindness, additive envelope compatibility, zero server changes, and
the friendly-opponent threat model. Validates what the spec/plan/tasks SAY, before
implementation.
**Created**: 2026-07-05
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md) | [contracts/game-payload.md](../contracts/game-payload.md)

## Server Blindness (Principle I)

- [x] CHK001 - Does the spec enumerate exactly what game data crosses the wire and state that all of it rides inside already-sealed envelopes? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK002 - Is "zero server changes" expressed as an objectively verifiable requirement with a stated proof procedure (empty `server/` diff)? [Measurability, Spec §FR-010, §SC-004]
- [x] CHK003 - Is the metadata the server unavoidably observes (envelope size/timing bursts) documented and bounded to what ordinary messaging already exposes? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK004 - Do the requirements forbid any new server endpoint, field, routing behavior, or push payload shape for games — including the notification path? [Coverage, Spec §FR-010, §FR-012]
- [x] CHK005 - Are notification-content leakage bounds specified per privacy mode (muted → nothing; generic/hidden → no more than an ordinary message)? [Coverage, Spec §FR-011, §SC-007]
- [x] CHK006 - Are all preview/notification strings required to be derived on-device from decrypted content (no server-derived game text anywhere)? [Consistency, Spec §FR-012, §FR-013 + §Zero-Knowledge Impact]
- [x] CHK007 - Are the requirements free of any server-side arbitration, matchmaking, or refereeing expectation, consistent with the documented threat model? [Consistency, Spec §Assumptions]

## Wire Contract: Additive & Compatible

- [x] CHK008 - Is the payload change specified as strictly additive optional fields, with defined old-client behavior for the new kind (fallback render, no crash, no chat corruption)? [Completeness, Contract §3, Spec §Edge Cases]
- [x] CHK009 - Are wire identifiers (`gameType`, each game's move shape) declared immutable once shipped, with an explicit evolution rule (new id, never a silent rule change)? [Clarity, Contract §3]
- [x] CHK010 - Is current-client behavior for an unknown `gameType` (future game) specified without an out-of-sync or error state? [Edge Case, Contract §1]
- [x] CHK011 - Is the rule for unknown future `action` values specified as "ignore the signal, do NOT mark out-of-sync"? [Edge Case, Contract §3]
- [x] CHK012 - Is move-to-session correlation unambiguous across devices (bubble message id, receiver resolution via the sender-id mapping)? [Clarity, data-model §Wire signals, research D4]

## Threat Model: Friendly Opponent, Tamper → Out-of-Sync, Never Corruption

- [x] CHK013 - Is the threat model itself documented (both clients validate; no referee; no repair protocol; proportionality argument)? [Completeness, Spec §Assumptions]
- [x] CHK014 - Do the requirements state that a peer's claimed board state is never trusted — the wire carries moves only, boards are always local replays? [Clarity, Spec §FR-004, research D2]
- [x] CHK015 - Are all invalid-input classes enumerated with a required outcome each (duplicate → exactly-once no-op; conflict/gap/out-of-turn/illegal → out-of-sync)? [Coverage, Spec §FR-006, §FR-007, data-model §Validation rules 1–7]
- [x] CHK016 - Is "out of sync" defined as a terminal, clearly-labeled state with a specified recovery affordance, and is silent divergence explicitly ruled out? [Clarity, Spec §FR-007, §SC-005]
- [x] CHK017 - Is the validation order specified deterministically so both devices classify the same signal identically? [Consistency, data-model §Validation rules]
- [x] CHK018 - Are idempotency requirements for relay redelivery objectively testable (seq-based, exact expected outcomes)? [Measurability, Spec §FR-006, tasks T003]
- [x] CHK019 - Are the concurrent-race cases (same-turn move race, game-start race) addressed with deterministic required outcomes? [Edge Case, Spec §Edge Cases, §FR-001a]
- [x] CHK020 - Is the one-game-per-chat gate explicitly scoped as a local UX constraint rather than a wire/protocol invariant, so no enforcement signal ever reaches the server? [Clarity, Spec §FR-001a, research D6]

## Lifecycle, Code Provenance & Process Consistency

- [x] CHK021 - Are the message-lifecycle behaviors (disappearing timer, deletion/erase, hidden-chat concealment) explicitly extended to game data, with no separate persistence that could outlive or leak past the bubble? [Consistency, Spec §FR-015, research D3]
- [x] CHK022 - Is the no-downloaded/no-third-party-code rule stated as a requirement (games ship only inside the reviewed build), closing the key-exfiltration vector? [Completeness, Spec §FR-016, §FR-017]
- [x] CHK023 - Do plan and constitution agree that no cryptographic surface changes (no new primitives, seal/open untouched, `messaging.ts` untouched, dependency direction preserved)? [Consistency, plan §Constitution Check IV]
- [x] CHK024 - Are the validation-critical paths traceably covered by test tasks ordered before their implementation tasks (rules engine, session engine, gates, offline convergence, forwarding exclusion)? [Traceability, tasks T002/T003/T008/T016/T019/T020]

## Notes

- Validation run 2026-07-05 (pre-implementation): all 24 items PASS against spec.md,
  plan.md, research.md, data-model.md, contracts/game-payload.md, and tasks.md as of
  this commit. No requirement edits were needed.
- Re-run this checklist at PR time; CHK002's proof procedure (`git diff --stat develop
  -- server/` empty) is also encoded as task T027.
