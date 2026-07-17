# Zero-Knowledge & Data-Integrity Checklist: Group "Seen" Receipts

**Purpose**: Validate that the *requirements* (spec + plan + contracts) keep Ring's
zero-knowledge boundary (Principle I), offline-first data integrity (Principle V),
and forward-only/stateless-server rules (Principle VI). Requirements-quality gate,
not an implementation test.
**Created**: 2026-06-17
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [contracts/seen-receipts.md](../contracts/seen-receipts.md) · [data-model.md](../data-model.md)

## Metadata Parity / Minimization (Principle I)

- [x] CHK001 Are the exact fields the server persists for a seen record enumerated and limited to `(sender, recipient, msg_id, seen_at)`? [Completeness, Spec §Zero-Knowledge Impact; data-model.md]
- [x] CHK002 Does the spec state the seen store introduces **no new class** of server-visible metadata vs. the existing delivered store? [Clarity, Spec §Zero-Knowledge Impact; research.md D1]
- [x] CHK003 Is it explicit that **no message body/content/media** is persisted or exposed by the seen store or the receipt frame? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK004 Is the "minimized to what relaying/reconciling requires" justification stated for the seen metadata? [Clarity, Principle I]

## Client-Side Privacy & Consent

- [x] CHK005 Is the seen preference required to be enforced **entirely client-side** (server never told, no preference column)? [Completeness, Spec §FR-010; research.md D6]
- [x] CHK006 Is the **emit gate** specified (off ⇒ never send ⇒ store never holds it)? [Clarity, Spec §FR-008]
- [x] CHK007 Is the **reciprocity display gate** specified (off ⇒ don't render others' seen on own messages)? [Completeness, Spec §FR-009]
- [x] CHK008 Does the spec **preclude server-side gating/withholding** based on the preference? [Consistency, research.md D6; Principle I]
- [x] CHK009 Is the toggle default (**on**) and its uniform application to 1:1 + groups specified? [Clarity, Spec §FR-007]

## Forward Migration & Data Integrity (Principle V)

- [x] CHK010 Is the client migration specified as **forward-only**, `DB_VERSION 5→6`? [Completeness, Spec §FR-002; plan.md]
- [x] CHK011 Does the requirement state that **all** existing message data is preserved (status, `readAt→seenAt`, `receipts[].readAt→seenAt`) with no loss? [Completeness, Spec §FR-002; data-model.md]
- [x] CHK012 Is **no status regression** (monotonicity) explicitly required across the migration? [Clarity, Spec §FR-002]
- [x] CHK013 Are migration-failure / aborted-upgrade requirements addressed (what happens if the v6 transform fails mid-way)? [Edge Case] — RESOLVED: new edge case requires the migration to abort atomically inside the upgrade transaction (data intact, retried next open).

## Server Migration & Statelessness (Principle VI)

- [x] CHK014 Is the seen table specified as a **new numbered, forward-only** migration (no editing shipped migrations)? [Completeness, plan.md; Principle VI]
- [x] CHK015 Is the claim that the rename needs **no server data migration** (read was never persisted) stated? [Clarity, research.md D5; Spec §Zero-Knowledge Impact]
- [x] CHK016 Is the seen-store **retention/cleanup** specified (mirror deliveries)? [Completeness, Spec §Clarifications; research.md D2]

## Wire Cutover & Compatibility

- [x] CHK017 Is the **hard-cutover** behavior specified, including the accepted transient cross-version skew? [Completeness, Spec §Edge Cases; research.md D3]
- [x] CHK018 Is the skew's **blast radius bounded** (degrades only the seen tier; delivered + messaging unaffected; self-heals)? [Clarity, Spec §Edge Cases]

## Anti-Forgery & Authenticity

- [x] CHK019 Is it required that the server accepts only client-originated `seen`/`downloaded` (rejecting client `sent`/`delivered`)? [Completeness, contracts/seen-receipts.md]
- [x] CHK020 Is **from-stamping** (server stamps the authenticated sender) required for seen receipts? [Clarity, contracts/seen-receipts.md]

## Durability & Reconciliation

- [x] CHK021 Is durability **testable** — a seen reported while the sender is offline is reconciled on reconnect, not lost? [Measurability, Spec §FR-003 / SC-002]
- [x] CHK022 Is the reconcile scope specified (group msgs missing `seenAt`; window/cap mirror delivered)? [Completeness, contracts/seen-receipts.md]
- [x] CHK023 Are downloaded receipts explicitly **excluded** from the durable seen store (relay-only, unchanged)? [Consistency, contracts/seen-receipts.md]

## Acceptance Criteria Quality

- [x] CHK024 Is "no new class of server-visible metadata" stated as a **verifiable** success criterion? [Measurability, Spec §SC-007]
- [x] CHK025 Is migration preservation (old read → Seen, timestamps intact, no regression) a **verifiable** success criterion? [Measurability, Spec §SC-005]
- [x] CHK026 Is toggle-off reciprocity verifiable **in both directions**? [Measurability, Spec §SC-003]

## Consistency & Ambiguities

- [x] CHK027 Is the counter denominator **N = recipients only** consistent across spec, plan, and data-model? [Consistency, Spec §FR-004 / data-model.md]
- [x] CHK028 Does the spec consistently use "Seen" for the status (no lingering "Read" status references)? [Consistency, Spec §FR-001]

## Notes

- Check items off as resolved. Per Constitution II/§Governance this checklist must
  be clean — or each open finding waived in writing — before `/speckit-implement`.
- **CHK013** (the one gap surfaced, migration-failure behavior) is now resolved
  via a new spec edge case; the checklist is clean.
