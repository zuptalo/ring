# Zero-Knowledge & Crypto Discipline Checklist: Robust Calls + Add-to-Call

**Purpose**: Constitution Principle I/IV gate — validate that the 1028 requirements
themselves are complete, unambiguous, and internally consistent on every
zero-knowledge, crypto-discipline, and mesh-only dimension before
`/speckit-implement`. This tests the WRITING, not the implementation.
**Created**: 2026-07-02
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [data-model.md](../data-model.md)
**Depth**: formal gate (required for Principle I/IV specs) · **Audience**: pre-implement reviewer

## Wire Silence — no new server capability

- [x] CHK001 - Does the ZK Impact section state that growing a call adds NO new client→server request, frame type, or field, enumerating which existing frames are reused (call-join / call-ring / call-roster / call-offer-answer-ice)? [Completeness, Spec §Zero-Knowledge Impact / FR-017]
- [x] CHK002 - Is the `joinroom` signal specified as carried INSIDE the existing `call-ice` frame (the hold/resume pattern), so no new transport frame is introduced? [Clarity, data-model §New sealed signal; contracts §transport.ts]
- [x] CHK003 - Is the `joinroom` payload's content bound explicitly to `{roomId, kind}` only, with a stated requirement that it carries no name, contact id (beyond an opaque room id), or other plaintext? [Completeness, tasks T005; FR-017]
- [x] CHK004 - Does the spec state what the server DOES see (room membership + numeric cap) and assert it is identical to today's group calls — i.e. "no new signal", falsifiably? [Measurability, Spec §ZK "What metadata is unavoidably visible"]
- [x] CHK005 - Is promoting a 1:1 to a room described as adding only a room identifier the server already handles for group calls (no new server-visible content)? [Clarity, Spec §ZK]

## Crypto Discipline — reuse only (Principle IV)

- [x] CHK006 - Do the requirements state that NO new primitive, key exchange, or ratchet scheme is introduced — `joinroom` reuses `sealForChat`/`openPacket` over the existing per-pair Double Ratchet? [Completeness, plan §Crypto Discipline / FR-017]
- [x] CHK007 - Is it specified that `messaging.ts` and the crypto core are untouched, and that per-pair SDP/ICE stays sealed over each pair's session (no plaintext signalling)? [Consistency, plan §Constitution Check IV; contracts §UNCHANGED]
- [x] CHK008 - Is the mesh-only invariant (no SFU / no server media) stated as a hard constraint, with the SFU-comment cleanup (FR-016) explicitly a no-behaviour-change tidy rather than a code path being reintroduced? [Clarity, Spec §Overview / FR-016]
- [x] CHK009 - Are adversarial considerations named for the new signal — a forged/replayed `joinroom` can only come from an authenticated pair session, and a bogus roomId can't pull a device into a room it can't decrypt legs for? [Coverage, Gap — confirm the spec/plan addresses joinroom trust]

## Key fetch & membership

- [x] CHK010 - Is the requirement that added/unconnected participants fetch keys ONLY via the existing same-room key gate (SharesCallRoom), for the call's duration, stated — with no new key-fetch permission? [Completeness, Spec §ZK "Key fetch"; research R1]
- [x] CHK011 - Is it clear that a person becomes reachable for pairwise key fetch only once they are a room member (not merely invited/ringing), matching today's group-call gate? [Clarity, research R1; data-model §joinroom]

## Caps stay authoritative server-side

- [x] CHK012 - Do the requirements keep the numeric caps (4 video / 8 audio) enforced AUTHORITATIVELY on the server (`JoinIfRoom`), with the new client gate described as pre-emptive UX only — not the security boundary? [Consistency, Spec §FR-009/FR-010; research R1]
- [x] CHK013 - Is "invited counts against capacity" specified so two concurrent adds cannot both pass the client gate and overshoot the cap (with the server as the final backstop)? [Edge Case, data-model §Capacity]
- [x] CHK014 - For the group-invite merge (US6), is the cap evaluated over the COMBINED distinct headcount, and is the blocked-when-over-cap outcome specified? [Completeness, Spec §FR-003a / SC-009]

## No server changes (verifiable)

- [x] CHK015 - Is "no `server/` diff" an explicit, checkable obligation (a task confirms `go build/vet/test` green AND an empty server diff), with an escalation rule if a server change turns out necessary? [Measurability, tasks T030; plan §ZK notes]

## Consent & privacy of participants

- [x] CHK016 - Is consent-to-be-added specified for every add path (merge + add-people + group-invite merge all RING the added party; no silent pull-in)? [Completeness, Spec §FR-015]
- [x] CHK017 - Is the existing peer's auto-follow on 1:1→group promotion specified as NOT weakening their security posture (they were already in an authenticated call with the promoter; the new member is authenticated via their own ring)? [Consistency, Spec §Clarifications / FR-002]
- [x] CHK018 - Is it stated that no new user data is collected or persisted (calls remain ephemeral; call-history logging unchanged)? [Completeness, plan §Storage; Constitution IX]

## Reuse-not-fork consistency

- [x] CHK019 - Are hold/swap/drop + the single-held-slot rule stated as untouched by merge/add (merge acts only on the active call), so the crypto/state invariants of specs 0005/2009 are preserved? [Consistency, Spec §FR-005 / US4]
- [x] CHK020 - Is kind reconciliation specified to reuse the EXISTING consent-gated video-upgrade flow (no new upgrade mechanism, so no new crypto surface)? [Clarity, Spec §FR-005a; research R5]

## Notes

- Every item tests the written artifacts; an item fails if the cited requirement is
  missing, vague, or contradicted — not if code differs.
- CHK009 is the one genuine gap to confirm during planning-to-implement: the spec
  should state (in ZK Impact or an edge case) that a `joinroom` is only trusted from an
  authenticated pair session and that a spurious roomId is inert (a device can only
  participate in legs it can decrypt). If not already covered, add a one-line ZK note
  before implementing.
