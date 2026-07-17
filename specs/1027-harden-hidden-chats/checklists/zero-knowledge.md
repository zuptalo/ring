# Zero-Knowledge & Crypto Discipline Checklist: Harden Hidden Chats

**Purpose**: Constitution Principle I/IV gate — validate that the 1027 requirements
themselves are complete, unambiguous, and internally consistent on every
zero-knowledge and crypto-discipline dimension before `/speckit-implement`.
This checks the WRITING, not the implementation.
**Created**: 2026-07-02
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [data-model.md](../data-model.md)
**Depth**: formal gate (required for Principle I/IV specs) · **Audience**: pre-implement reviewer

## Wire Silence (nothing new crosses to the server)

- [x] CHK001 - Does the ZK Impact section explicitly enumerate every user action added/changed by this feature (hide, unhide, reveal, relock, blocked-hide, fresh-visible-chat, reset) and state its wire effect? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK002 - Is the pair-conversation creation path (the one flow that DOES emit wire traffic — a group create card) identified as pre-existing traffic with no new fields, and is its observer (the peer, not the server) named? [Clarity, Spec §ZK "Coexisting conversations"; research R3]
- [x] CHK003 - Are requirements explicit that hiding itself is wire-silent (no message, no card, no sync write) so the moment of hiding is unobservable to both server and peer? [Completeness, research R3 "Hide stays a move"]
- [x] CHK004 - Is the spurious-rekey elimination (B1) framed as a requirement — hiding must not change observable wire behavior (no rekey bursts correlated with the hide action)? [Coverage, research R2-B1 / plan D2]
- [x] CHK005 - Does the spec state what the server can still see (unchanged relay metadata) so "no new signal" is falsifiable rather than aspirational? [Measurability, Spec §ZK "What crosses the wire"]

## Device-Local State Never Syncs

- [x] CHK006 - Are ALL new device-local artifacts (`hiddenPeer:` tombstones, `badge.lastCount`) explicitly required to be excluded from own-data sync, with a test obligation named for each? [Completeness, Spec FR-019; tasks T027/T030]
- [x] CHK007 - Is the existing exclusion of `privacy.hiddenChats` / `privacy.hiddenPin` restated as a preserved invariant (not silently assumed) in the 1027 requirements? [Consistency, Spec FR-019; data-model §Hidden set]
- [x] CHK008 - Are the `localOnly` tombstone semantics (honored by ingest, never uploaded, never propagated to the user's other devices) specified for the new `hiddenPeer:` rows, matching the 1019 chat-id rows? [Consistency, data-model §Peer block; research R4]
- [x] CHK009 - Is the requirement that reveal state is memory-only (never persisted, cold start always locked) stated with its observable consequence (SW must treat `revealed` as never-revealed)? [Clarity, Spec FR-009; data-model §Badge preference]

## No PIN Oracle

- [x] CHK010 - Is "no oracle" defined across ALL observable channels (visual, audible, timing, state change) rather than just "no error message"? [Clarity, Spec FR-008, SC-007]
- [x] CHK011 - Is the timing-parity claim grounded in a stated mechanism (Argon2id runs identically on both outcomes) rather than left as an untestable assertion? [Measurability, tasks T011; SC-007]
- [x] CHK012 - Are PIN storage requirements explicit that no recoverable form and no fast-compare path exist (verification = decrypt success only)? [Completeness, Spec FR-010]
- [x] CHK013 - Is the auto-verify-at-length behavior's dependency on a stored PIN length acknowledged, with the cleartext-length trade-off addressed (sealed per T044) or explicitly accepted in writing? [Gap→resolved, tasks T044; analyze H1]
- [x] CHK014 - Are repeated-wrong-PIN requirements defined (no lockout signal, no state change) so brute-force behavior is specified rather than incidental? [Edge Case, Spec §Edge Cases "Wrong PIN entered repeatedly"]

## Fail-Closed Surfaces (without collateral suppression)

- [x] CHK015 - Is every surface that consults hidden state enumerated (chat list, search, pickers, call history, missed-call badge, unread badge, notifications, route access) so "everywhere" in FR-017 is a checkable list? [Completeness, Spec FR-002/FR-017; research R1 choke points]
- [x] CHK016 - Is "fail closed" paired with an explicit non-collateral requirement (visible chats and their counts stay correct during the unknown-set window) and a defined fallback source (`badge.lastCount`)? [Clarity, Spec FR-015/FR-017; plan D4]
- [x] CHK017 - Is the inbound-frame fail-closed behavior specified (re-queue when the hidden set is unknown, never resolve against an unknown set) including why the window cannot normally occur? [Coverage, plan D2; data-model §Inbound routing]
- [x] CHK018 - Are the SW's constraints stated as requirements (cannot know reveal state, may be unable to decrypt the hidden set → fail closed for the hidden contribution only, unclassifiable frames uncounted)? [Completeness, data-model §Badge computation; contracts sw-inbox]
- [x] CHK019 - Is the cold-open no-flash requirement measurable (poll from first paint, N restarts, zero occurrences) rather than "never flashes"? [Measurability, Spec SC-006; tasks T036]

## Crypto Discipline (Principle IV — reuse only)

- [x] CHK020 - Do the requirements state that NO new primitive, key-exchange, ratchet, or ciphertext shape is introduced — channel *selection* only between the two existing channels? [Completeness, plan §Technical Context / Constitution Check IV]
- [x] CHK021 - Is the one-plain-1:1-per-peer constraint (INV-3) documented with its crypto rationale (the ratchet session is keyed by chat id, so a second plain 1:1 would fork/steal the session)? [Clarity, data-model §INV-3; research R1/R3]
- [x] CHK022 - Is the two-stage routing rule unambiguous about what is knowable pre-decrypt (peer only) vs post-decrypt (groupId), so no requirement implicitly depends on reading sealed data early? [Consistency, data-model §Inbound routing stages; plan D2]
- [x] CHK023 - Is `messaging.ts` untouchability stated as a requirement with the dependency direction (`queries.ts → messaging.ts`, no cycle) preserved? [Consistency, plan §Constitution Check IV; constitution §IV]
- [x] CHK024 - Are the reset-ordering requirements (block first, delete second, clear set/PIN last) carried over from 1019 FR-024 and extended to the new peer blocks, so no interruption window can flip a hidden chat visible? [Coverage, data-model §state machine "Reset"; tasks T030/T033]
- [x] CHK025 - Are adversarial test obligations named for the changed inbound path (forged/replayed frames from blocked peers, group frames riding the 1:1 session, unsolicited-content trace removal vs hidden chats)? [Coverage, tasks T005/T008/T031; constitution §IV]

## Notification & Call Surface Consistency

- [x] CHK026 - Is the platform constraint that forces the push-path banner documented as a requirement premise (silent pushes → subscription revocation), so the carve-out is justified rather than a soft exception? [Traceability, Spec §Clarifications Q1 / FR-012]
- [x] CHK027 - Is "byte-identical to the previews-off generic" specified precisely (title, body, url, coalescing tag) so indistinguishability is testable? [Measurability, Spec FR-012; contracts sw-inbox]
- [x] CHK028 - Do the knock-knock requirements (FR-013 full identity) and the call-history requirements (FR-014 no relocked entry) avoid contradiction by separating live-ring from at-rest history, and is the 1019 FR-019 supersession explicit? [Conflict→resolved, Spec FR-013/FR-014/FR-016]
- [x] CHK029 - Are all three delivery paths (foreground, backgrounded-connected, push-woken) covered by exactly one specified outcome each, with no path left to inference? [Coverage, data-model §Notification decision]

## Ambiguities & Assumptions Surfaced

- [x] CHK030 - Is the peer-visible side effect of coexistence (a new conversation appears on the peer's device when the fresh visible chat is created) stated as accepted, so it cannot later be read as a leak/regression? [Assumption, research R3; Spec §ZK]
- [x] CHK031 - Is the legacy broken state (hidden + visible plain 1:1 from pre-1027 B1) addressed with defined behavior (tolerated read-only, convergence path) rather than undefined? [Edge Case, data-model §Legacy tolerance]
- [x] CHK032 - Is the group-frame session-carrier case specified (a group message from a peer whose only 1:1 is hidden must not resurrect a visible 1:1 row)? [Edge Case, research R2-B1 corollary; tasks T005]

## Notes

- Check each item against the written artifacts only; an item fails if the cited
  text is missing, vague, or contradicted elsewhere — not if the code differs.
- Items CHK013 and CHK028 encode analyze findings H1 and FR-016's reconciliation;
  if either regresses during implementation, re-run `/speckit-analyze`.
