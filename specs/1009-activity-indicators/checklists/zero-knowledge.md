# Zero-Knowledge & Crypto Checklist: Ephemeral Activity Indicators

**Purpose**: Validate that the *requirements* (spec + plan + contract) keep Ring's
zero-knowledge boundary (Constitution Principle I) and crypto discipline
(Principle IV) — i.e. that the design, as written, cannot leak plaintext/metadata
or improvise crypto. This is a requirements-quality gate, not an implementation test.
**Created**: 2026-06-17
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [contracts/activity-frame.md](../contracts/activity-frame.md) · [research.md](../research.md)

## Metadata Minimization (Principle I)

- [ ] CHK001 Are the exact fields the server can observe for an activity frame explicitly enumerated and limited to `t`/`to`/`from`? [Completeness, Spec §Zero-Knowledge Impact; contracts/activity-frame.md]
- [ ] CHK002 Is it explicitly required that the activity *kind* (typing / recording-audio / recording-video) and *state* never reach the server in plaintext? [Clarity, Spec §Zero-Knowledge Impact; research.md D3]
- [ ] CHK003 Is the "no NEW server-visible metadata vs. the existing message/receipt relay" claim written as a verifiable requirement rather than an unbacked assertion? [Measurability, Spec §SC-007]
- [ ] CHK004 Are timing/frequency side-channels (keepalive cadence revealing composing duration; per-recipient group frames revealing fan-out size) acknowledged and bounded in the requirements? [Coverage, Gap; research.md D4/D7]

## Sealing & Crypto Discipline (Principle IV)

- [x] CHK005 Is the sealing of the activity payload specified as reusing existing primitives (AEAD + HKDF), with no new/hand-rolled primitive? [Clarity, research.md D3; Principle IV] — RESOLVED: per-peer activity key via `hkdf`, sealed with `envelope.seal` (XChaCha20-Poly1305); no `crypto_box`/new primitive added.
- [x] CHK006 Do the requirements explicitly forbid advancing the Double Ratchet for activity frames (no ratchet churn / desync with real messages)? [Completeness, research.md D3] — RESOLVED: D3 mandates a read-only derived key; does NOT call `sealForChat`/`ratchetEncrypt`.
- [x] CHK007 Is the D3 decision (exact sealing primitive/key) pinned with the ZK invariant stated and the residual flagged for security-review sign-off? [Traceability, research.md D3] — RESOLVED (recommendation pinned 2026-06-17); **human security sign-off still required** on the 3 listed open items (stable key anchor, no-FS acceptance, nonce).
- [x] CHK008 Do the requirements define behavior when the kind cannot yet be sealed (no established session/keys with the peer)? [Edge Case] — RESOLVED: fail-closed (suppress, never send unsealed); reuses the existing `sealForChat`/`fetchPeerBundle` null-path.

## Ephemerality & No Persistence

- [ ] CHK009 Is "never persisted" specified across all stores — no IndexedDB object store, no `DB_VERSION` bump, no Postgres table/column/migration? [Completeness, Spec §Zero-Knowledge Impact / FR-006 / SC-007]
- [ ] CHK010 Is it required that the frame is never durably queued (no `EnqueueRelay`) and is dropped when the peer has no live socket? [Clarity, Spec §FR-012; contracts/activity-frame.md]
- [ ] CHK011 Is "never pushed" (no Web Push / notification) stated as a requirement? [Completeness, Spec §FR-012; contracts/activity-frame.md]
- [ ] CHK012 Is non-survival across reconnect / reload / app-restart specified and objectively verifiable? [Measurability, Spec §FR-006 / SC-003]
- [ ] CHK013 Is the auto-expiry (no stuck indicator on peer disconnect) defined with a measurable window? [Clarity, Spec §FR-007 / SC-005; §Clarifications]

## Anti-Forgery & Authenticity

- [ ] CHK014 Is it required that the server stamps `from` = authenticated sender and ignores any client-supplied `from`? [Completeness, contracts/activity-frame.md; research.md D2]
- [ ] CHK015 Is the anti-forgery rule traceable to (consistent with) the existing read-receipt rule it reuses? [Consistency, research.md D2]
- [ ] CHK016 Are the consequences of a spoofed activity frame considered (can a client make "X is typing" appear as another user)? [Coverage, Gap]

## Consent & Reciprocity

- [ ] CHK017 Is the privacy control specified as a single combined toggle with a defined default? [Clarity, Spec §FR-008 / §Clarifications]
- [ ] CHK018 Is "off ⇒ emits nothing" specified for all conversations and all three activity kinds? [Completeness, Spec §FR-008]
- [ ] CHK019 Is reciprocity ("off ⇒ renders nothing from others") specified, including the required user-facing explanation? [Completeness, Spec §FR-009]
- [ ] CHK020 Is it stated that gating is client-side only, with no server-side consent enforcement (which would require the server to act on the signal)? [Consistency, research.md D9; Principle I]

## Blocking & Group-Membership Privacy

- [ ] CHK021 Are requirements defined to suppress activity to and from blocked parties? [Coverage, Spec §FR-010; contracts/activity-frame.md]
- [ ] CHK022 Is group fan-out specified as client-driven so the server learns no group membership? [Clarity, research.md D7; Principle I]
- [ ] CHK023 Is the group fan-out bound/rate-limit stated with a concrete cap (amplification limit)? [Measurability, Gap; research.md D7]

## Architectural Boundary

- [ ] CHK024 Is it required that the activity signal does NOT pass through the messages store / `queries.ts`, and that `messaging.ts` stays crypto-only? [Consistency, Spec §Assumptions; Principle IV]
- [ ] CHK025 Is the dispatch path (live fast-path, not the serialized inbound message chain) specified so activity is decoupled from message-persistence semantics? [Clarity, research.md D6]

## Acceptance Criteria Quality (ZK-specific)

- [ ] CHK026 Is there a measurable success criterion asserting the server stores nothing and adds no migration for activity (inspectable)? [Measurability, Spec §SC-007]
- [ ] CHK027 Is there a verifiable criterion that toggle-off reciprocity holds in both directions across accounts? [Measurability, Spec §SC-004]

## Ambiguities & Conflicts

- [x] CHK028 Is D3 (exact sealing primitive/key) the ONLY remaining ZK/crypto ambiguity, and is it explicitly tracked to this checklist / security-review gate? [Ambiguity, research.md D3] — RESOLVED: D3 recommendation pinned (derived-key AEAD); the only residual is human security sign-off on the 3 listed open items.
- [ ] CHK029 Is the "relay, not server-computed presence" decision stated consistently across the ZK Impact section, the contract, and research (no conflicting framing)? [Conflict, Spec §Zero-Knowledge Impact / research.md D1 / contracts/activity-frame.md]

## Notes

- Check items off as resolved: `[x]`. Per Constitution II/§Governance, this checklist
  must be clean — or each open finding explicitly waived in writing — before
  `/speckit-implement`.
- **D3 sealing primitive — RESOLVED 2026-06-17** (research.md D3): seal `{kind,state}`
  with the existing AEAD (`envelope.seal`) under a per-peer activity key derived via
  `hkdf` from the session secret — no new primitive, no Double-Ratchet advance,
  fail-closed, mutually authenticated; `crypto_box_seal` kept as the documented
  fallback. **Residual = human security sign-off** on three points: the stable key
  anchor (derive from a session-stable secret, not the rotating root), acceptance of
  no per-message forward secrecy for this ephemeral signal, and per-send random nonce.
  This sign-off must land before T007/T029 (implementation/merge).
- **D3 maintainer sign-off received 2026-06-17** — all three residual points accepted
  (session-stable key anchor; no per-message forward secrecy for this ephemeral
  signal; per-send random nonce). T007 sealing is unblocked.
