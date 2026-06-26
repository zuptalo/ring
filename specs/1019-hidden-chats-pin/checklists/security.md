# Security & Zero-Knowledge Checklist: Hidden Chats Locked Behind a PIN

**Purpose**: Validate that the crypto / zero-knowledge **requirements** for this
feature are complete, clear, consistent, and measurable — *before* implementation.
This is a requirements-quality gate (per Constitution Principles I & IV, which
mandate a checklist for crypto / zero-knowledge specs), not a test plan.
**Created**: 2026-06-26
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [research.md](../research.md)

**How to use**: Each item asks whether the requirements are *written well enough*
to implement and security-review safely. A failing item means a spec/plan edit is
needed, not a code fix.

## Zero-Knowledge Boundary (nothing new on the wire)

- [ ] CHK001 Is "nothing new crosses the wire" stated as a verifiable requirement rather than an aspiration (i.e., a concrete equivalence a reviewer can check)? [Measurability, Spec §Zero-Knowledge Impact, §SC-004]
- [ ] CHK002 Are the requirements explicit that the synced `chats` row is byte-identical whether or not a conversation is hidden? [Clarity, Spec §FR-014, §SC-004]
- [ ] CHK003 Is it specified that the hidden set, PIN material, grace/biometric prefs, and do-not-resync block are NEVER included in any sync payload? [Completeness, Spec §FR-009; Research §R1]
- [ ] CHK004 Are the metadata items the server *unavoidably* still sees enumerated, and confirmed unchanged from today (no new signal that a chat is hidden / the feature is enabled / a PIN exists)? [Completeness, Spec §Zero-Knowledge Impact]
- [ ] CHK005 Do the requirements address whether creating the distinct 2-person hidden group leaks a *correlatable* signal to the server (e.g., a new group sharing participants with an existing 1:1), and assert why it does not? [Coverage, Spec §Zero-Knowledge Impact; Research §R2]
- [ ] CHK006 Is it required that no log line, metric, error payload, or debug aid emit the hidden state or hidden-set contents (client or server)? [Gap, Constitution §I]
- [ ] CHK007 Are call signalling / SFU paths for a hidden chat's calls required to be indistinguishable from non-hidden calls on the wire? [Coverage, Spec §FR-019; Research §R7]

## At-Rest Protection — Hidden Set

- [ ] CHK008 Is "protected at rest so it cannot be read off the device without the PIN (or biometric)" quantified to a specific protection (which key wraps the set)? [Clarity, Spec §FR-010; Research §R1]
- [ ] CHK009 Is the distinction between *knowing membership* (to hide by default) and *authorizing reveal* (the PIN) stated unambiguously, so the wrapping-key choice is justified? [Clarity, Spec §FR-002 vs §FR-004; Research §R1/§R3]
- [ ] CHK010 Is the residual at-rest exposure of hidden *message bodies* (plaintext in the on-device `messages` store) explicitly acknowledged and scoped, with the threat model it is/ isn't meant to defend? [Ambiguity, Spec §FR-010, §Assumptions; Research §R1]
- [ ] CHK011 Is the threat model the at-rest protection targets ("briefly handed the unlocked phone") documented and distinguished from forensic disk extraction? [Assumption, Spec §Overview; Research §R1]
- [x] CHK012 Are requirements defined for what happens to the wrapped set if it fails to decrypt / is corrupt (fail-closed vs fail-open)? [Edge Case, Gap]

## At-Rest Protection — Separate Dedicated PIN

- [ ] CHK013 Is it required that the hidden-chats PIN is fully independent of the app-unlock PIN (separate salt/key), and that app unlock does not reveal hidden chats? [Consistency, Spec §FR-015; Research §R3]
- [ ] CHK014 Is "the PIN is never stored in recoverable plaintext" stated as a requirement, with verification defined as decryption success (AEAD), not a stored comparison? [Clarity, Spec §FR-010; Research §R3]
- [ ] CHK015 Are requirements for PIN format (numeric, length, min/max) specified or explicitly deferred with a named default, so auto-verify-at-length is unambiguous? [Completeness, Spec §Assumptions (PIN format); Research §R5]
- [ ] CHK016 Are wrong-PIN requirements explicit that no oracle is leaked — no error or UI state that differs from the all-visible case, and no app-wide lockout? [Clarity, Spec §FR-004, §SC-006, §Edge Cases]
- [x] CHK017 Are rate-limiting / brute-force-resistance expectations for the reveal PIN specified or explicitly out of scope (and is Argon2id cost the stated mitigation)? [Gap, Non-Functional]
- [ ] CHK018 Are change-PIN requirements defined (old-PIN proof required, set re-wrapped, no window where the set is unprotected)? [Completeness, Research §R3; Spec §FR-012]
- [ ] CHK019 Is the relationship/precedence between the master-key-wrapped set and the PIN-wrapped capability specified clearly enough to avoid a second plaintext copy of the set? [Ambiguity, Research §R3]

## Reveal-Session Lifecycle (cold-start re-lock)

- [ ] CHK020 Is "full app close always re-locks" stated as an invariant with a measurable check (next launch begins locked, indistinguishable from never-revealed)? [Measurability, Spec §FR-005, §SC-009, §US3 AC6]
- [ ] CHK021 Is it explicitly required that NO state which would auto-reveal survives a cold start (nothing persisted that resumes a reveal session)? [Clarity, Spec §FR-005; Research §R4]
- [ ] CHK022 Are the exact reveal-ending triggers enumerated and consistent across spec and plan (grace elapse while backgrounded, explicit re-hide, full close)? [Consistency, Spec §FR-005/§FR-020 vs Research §R4]
- [ ] CHK023 Is the grace-window default and option set specified unambiguously, and is the "immediately" option's behavior defined? [Clarity, Spec §FR-020; Research §R4; Data-Model §6]
- [ ] CHK024 Is the boundary between "brief backgrounding" (kept) and "grace elapsed" (re-locked) defined by a precise elapsed-time rule rather than a vague notion of focus? [Ambiguity, Spec §US3; Research §R4]
- [x] CHK025 Are requirements defined for an in-progress reveal interacting with a separate app-lock (auto-lock) event — which takes precedence? [Coverage, Gap; Research §R10]
- [ ] CHK026 Is behavior specified for a hidden chat that is open/visible at the moment the grace window expires (does the open view also re-hide)? [Edge Case, Spec §Edge Cases]
- [x] CHK027 Are device-clock-change / suspended-timer cases for the grace window addressed (so a manipulated clock can't extend reveal)? [Edge Case, Gap]

## Notification Leak Prevention

- [ ] CHK028 Is "no sender name, avatar, or content" specified as an exhaustive list of fields that MUST be absent for hidden-chat notifications? [Completeness, Spec §FR-007]
- [x] CHK029 Is the fail-safe requirement explicit — if the service worker cannot determine hidden status (e.g., cannot unlock), it MUST default to a content-free notification? [Clarity, Spec §FR-007; Research §R6]
- [ ] CHK030 Is the tap-routing requirement unambiguous (a hidden-chat notification lands on the Chats tab and never deep-links into / reveals the hidden chat)? [Clarity, Spec §FR-008; Research §R6]
- [ ] CHK031 Are requirements consistent that existing burst-coalescing / dedup behavior must not cause a hidden chat's identity to surface in an aggregated notification? [Consistency, Spec §US3 AC3/AC4; Research §R6]
- [ ] CHK032 Is the offline-queued / reconnect case required to honor the no-preview rule (no preview leaks when a backlog is delivered)? [Coverage, Spec §US3 AC4]
- [ ] CHK033 Is the interaction with the existing per-chat `notifyContent` (full/generic/none) and global preview toggle specified, so hidden status overrides them deterministically? [Conflict, Research §R6]

## Call-History Leak Prevention

- [ ] CHK034 Is it required that placed, received, AND missed calls for a hidden chat are absent from the Calls tab / call history (all three explicitly)? [Completeness, Spec §FR-019, §US5]
- [ ] CHK035 Is the missed-call badge/count requirement explicit that a hidden chat contributes no attributable badge? [Clarity, Spec §FR-019, §US5 AC2]
- [ ] CHK036 Is the pre-answer caller-identity suppression requirement defined for both first incoming and call-waiting/second-incoming surfaces? [Coverage, Research §R7; Spec §US5 AC3]
- [ ] CHK037 Is it specified that a previously hidden call remains absent after the chat is unhidden (was never logged) — i.e., the rule is "not logged," not "filtered on display"? [Clarity, Spec §US5 AC4]
- [ ] CHK038 Is the in-conversation call-log line (inside the hidden chat) confirmed to carry no identity beyond what the conversation already shows? [Coverage, Research §R7]

## Reset Wipe + Local-Only Do-Not-Resync Block

- [ ] CHK039 Is the reset scope specified exhaustively (which local data is deleted: messages, sessions, sender keys, chat row, hidden set, PIN material)? [Completeness, Spec §FR-016; Research §R8; Data-Model §State transitions]
- [ ] CHK040 Is "block re-sync on this device" required to be LOCAL-ONLY — explicitly NOT uploaded and NOT propagated to the user's other devices or the server? [Clarity, Spec §FR-016; Research §R8]
- [ ] CHK041 Is the distinction between the existing (uploaded) tombstone and the new local-only block stated clearly enough to prevent accidental propagation? [Ambiguity, Research §R8]
- [ ] CHK042 Is the destructive warning's required content specified (states permanent deletion of hidden conversations before confirmation)? [Completeness, Spec §FR-012, §US7 AC1]
- [x] CHK043 Are requirements defined for the wipe being atomic / resilient to interruption (no partial state that re-exposes a half-wiped hidden chat)? [Edge Case, Gap; Recovery]
- [ ] CHK044 Is the post-reset state specified (old PIN invalid, a fresh PIN can be created, no orphaned wrapped set referencing wiped ids)? [Completeness, Spec §US7 AC2; Data-Model]
- [ ] CHK045 Is it defined whether the counterpart's copy / the server ciphertext is intentionally untouched by reset, and that this is acceptable? [Assumption, Spec §FR-018; Research §R8]

## Crypto Discipline & Review Readiness

- [ ] CHK046 Do the requirements mandate reuse of the existing libsodium primitives and the wrapSecret/verifyPin pattern, with "no new key-exchange/ratchet/primitive" stated? [Consistency, Constitution §IV; Plan §Constitution Check; Research §R2/§R3]
- [ ] CHK047 Is the 2-person-group reuse (sender keys) identified as the mechanism, with no minimum-size assumption relied upon that the code doesn't guarantee? [Assumption, Research §R2]
- [ ] CHK048 Is a security review explicitly required as a gate before implement, with its scope (at-rest wrapping, separate-PIN handling, reveal lifecycle, local-only block) named? [Traceability, Plan §Constitution Check; Research §Summary]
- [ ] CHK049 Are the open composition details flagged in research (exact PIN↔set binding; local-only-tombstone representation) marked as review/implementation items that do NOT block tasks? [Clarity, Research §Summary]
- [ ] CHK050 Is each security-relevant requirement traceable to an FR/SC and an acceptance scenario, so the reviewer can map requirement → oracle? [Traceability, Spec §Requirements/§Success Criteria; Contracts §Behavioral contracts]

## Consistency, Ambiguities & Assumptions (cross-cutting)

- [ ] CHK051 Are "hidden," "revealed," "locked," and "wiped+blocked" used consistently across spec, plan, data-model, and contracts (no overloaded terms with the existing "Locked chats" feature)? [Consistency, Research §R10; Data-Model]
- [ ] CHK052 Is the per-device-divergence assumption (same conversation hidden on one device, visible on another) documented and reconciled with sync requirements (no sync error)? [Assumption, Spec §Edge Cases, §FR-018]
- [ ] CHK053 Are the success criteria (SC-001…SC-009) each objectively measurable and individually traceable to a requirement? [Measurability, Spec §Success Criteria]
- [ ] CHK054 Is the boundary with explicitly out-of-scope hardening (encrypting hidden message bodies at rest; cross-device hidden-state sync) stated so reviewers don't assume coverage? [Coverage, Spec §Out of Scope; Research §R1]

## Notes

- Items are requirement-quality questions. A `[ ]` that can't be answered "yes"
  signals a spec/plan/research edit — resolve before `/speckit-implement`.
- `[Gap]` items most likely need a new line in spec or plan. Highest-risk gaps to
  watch: CHK012/CHK017 (fail-closed + brute-force), CHK027 (clock/timer), CHK043
  (atomic wipe).
- This checklist is itself a Constitution §I/§IV gate artifact; the named security
  review (CHK048) is a separate, required human step.
