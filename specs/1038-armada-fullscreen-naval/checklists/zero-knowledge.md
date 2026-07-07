# Zero-Knowledge & Hidden-State Checklist: Armada (spec 1038)

**Purpose**: requirements-quality gate (constitution Principle I/IV) for the
hidden-fleet game's second generation — the secrets, the commitments, the
trust model, and the new fullscreen surfaces around them. Validates what the
spec (and, at plan time, the plan + protocol contract) SAY, before
implementation. Battleship's spec-0011 checklist is the precedent; items that
can only be judged against plan.md / contracts/armada-protocol.md stay open
and gate `/speckit-plan`.
**Created**: 2026-07-07
**Feature**: [spec.md](../spec.md) | plan.md (pending) | contracts/armada-protocol.md (pending)

## Secrecy of the hidden state

- [x] CHK001 - Does the spec state precisely what never leaves the device (layout + salt) and until when (the end-of-game reveal)? [Completeness, Spec §FR-002]
- [x] CHK002 - Is the secret's whole lifecycle specified — created at deployment, never synced to other own-devices or the server, cleared at terminal state, cleared on message/post deletion and on logout/app-lock wipe? [Completeness, Spec §FR-002, §Edge Cases]
- [x] CHK003 - Is the second-own-device consequence of device-locality stated as documented behavior (only the committing device can judge shots), not left to be discovered? [Clarity, Spec §Edge Cases]
- [x] CHK004 - Is what opponents and spectators CAN learn during play bounded by the spec (moves/answers on the shared log; board state never stored or transmitted)? [Clarity, Spec §FR-002, §Key Entities]

## Commitment scheme quality

- [x] CHK005 - Does the commitment bind the full game geometry (board size + fleet roster + placements + salt) so an Armada commitment can never validate as another game's — including old battleship's? [Coverage, Spec §FR-002]
- [x] CHK006 - Is the serialization CANONICAL in the contract (fixed class order Carrier→Destroyer, pinned field encoding, pinned salt size/encoding) so the same layout can't produce two commitments? [Clarity, contract §Layout]
- [x] CHK007 - Does the contract reuse the app's existing hash primitive (no bespoke crypto) and state binding + hiding adequacy (random salt against the 10×10 five-ship layout space)? [Consistency, contract §Layout, research §D2]

## Trust model & cheat handling

- [x] CHK008 - Is the trust stance explicit and unchanged from battleship: in-play answers trusted, end-of-game verification mandatory, a cheated result flips to the honest player, both-cheat is a draw? [Clarity, Spec §FR-002]
- [x] CHK009 - Is the forced-reveal mechanism specified so a game cannot END unverified (loser's reveal rides the final answer; winner then reveals)? [Completeness, Spec §FR-002]
- [x] CHK010 - Are divergent/illegal logs required to land on a labeled terminal (out-of-sync), never a silent hang — including under delayed/reordered delivery? [Coverage, Spec §FR-009, §Edge Cases]
- [x] CHK011 - Is the anti-stall re-emit (a judged-but-unsent answer re-sent on next open) specified as a retransmission of the SAME judged result, introducing no new information channel? [Consistency, Spec §FR-009]
- [x] CHK012 - Does the contract enumerate ALL cheat classes with their outcome (bad salt, illegal layout, moved-ship layout, lied answer, tampered reveal), each mapped to a test? [Coverage, contract §Status & verification, research §D11]

## Wire & metadata surface

- [x] CHK013 - Is "no new wire kinds or payload fields" stated as a requirement, so the server-visible metadata surface (sealed payload size/timing, wall engagement cadence incl. spec 1036's follow/gameover) is exactly the one already accepted? [Completeness, Spec §FR-004]
- [x] CHK014 - Do the new UI surfaces (fullscreen overlay, floating return button, toasts over the game) derive entirely from on-device state, adding zero server queries or signals? [Coverage, Spec §FR-007/FR-008]
- [x] CHK015 - Is version skew bounded by existing fallbacks (unknown game type renders update prompt, signals dropped without corruption, gates exclude unknown types)? [Coverage, Spec §FR-011]
- [x] CHK016 - Does battleship's retirement leave its shipped contract untouched (old sessions replay under the old frozen rules; no behavior change behind an existing id)? [Consistency, Spec §FR-010, §Decisions]

## Traceability

- [ ] CHK017 - Are the protocol-critical paths mapped to tests-first tasks (red protocol suite incl. every cheat class and the stall/convergence scenarios; e2e for secrecy + convergence + spectators)? [Traceability, Spec §SC-002/SC-003 — gates tasks]

## Notes

- Validation run 2026-07-07 (spec stage, pre-plan): 12 of 17 items PASS
  against spec.md as written. CHK006, CHK007, CHK012 gate the plan phase;
  CHK017 gates task generation.
- Re-validated 2026-07-07 after `/speckit-plan`: CHK006/007/012 now PASS
  against `contracts/armada-protocol.md` + `research.md` (§D2, §D11). Only
  CHK017 remains open — check it after `/speckit-tasks` confirms the
  tests-first ordering.
