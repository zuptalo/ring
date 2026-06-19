# Zero-Knowledge Checklist: Expanding Jump Pill + Visibility-Driven Seen Receipts (spec 1013)

**Purpose**: Constitution gate-sequencing requirement — `/speckit-checklist` is REQUIRED for any
spec touching Principle I (Zero-Knowledge Boundary) or IV (Crypto Discipline). This checklist is
"unit tests for the requirements": it validates that the spec's zero-knowledge and privacy
requirements are complete, clear, consistent, and measurable — NOT that the implementation works.
It mirrors the precedent set by client-only specs 1009, 1010, and 1011.
**Created**: 2026-06-19
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [data-model.md](../data-model.md) · [contracts/seen-and-pill.md](../contracts/seen-and-pill.md)

**Outcome**: PASS — every item below is satisfied by the spec/plan/data-model/contracts. The
feature changes only the client-side *timing* of an existing receipt; the wire envelope and server
role are unchanged, and the one new persisted field is client-local.

## Zero-Knowledge Boundary (Principle I)

- [x] CHK001 Does the spec explicitly state what crosses the wire for this feature? [Completeness, Spec §Zero-Knowledge Impact] — Yes: the same sealed `receipt` envelope `{messageId, status:'seen', at, to}`; "No new fields, frames, or endpoints."
- [x] CHK002 Is it specified that the wire receipt envelope and the server's relay role are UNCHANGED from spec 1010, and that only the *timing* changes? [Clarity, Spec §Overview + §Zero-Knowledge Impact; FR-013; contracts §1] — Yes, stated in three places consistently.
- [x] CHK003 Is the new per-message `seenReportedAt` state documented as client-local — never sent to the server and not part of own-data sync? [Completeness, Spec §Zero-Knowledge Impact; FR-018; data-model] — Yes: "lives only in the device's IndexedDB… never sent… not own-data-synced."
- [x] CHK004 Is the absence of any new server capability/endpoint/metadata stated? [Coverage, Spec §Zero-Knowledge Impact + §Out of Scope; plan Constitution Check VI] — Yes: no server/SQL/wire change.
- [x] CHK005 Is it specified that on-screen visibility data never leaves the device (it only gates local sending)? [Clarity, Spec §Zero-Knowledge Impact] — Yes: "which messages are on screen never leaves the device."
- [x] CHK006 Is the absence of any new crypto/key use documented (receipts already encrypted/relayed by spec 1010; `messaging.ts` untouched)? [Completeness, plan Constitution Check IV] — Yes: N/A, no crypto change.

## Receipt-timing metadata change

- [x] CHK007 Does the spec characterize the metadata change as sending strictly LESS (only viewed messages) rather than more? [Clarity, Spec §Zero-Knowledge Impact] — Yes: "strictly less and more truthful information to the peer, and nothing more to the server."
- [x] CHK008 Is it stated that the server cannot infer *why* / *relative-to-viewing-when* a receipt was sent (only that one was relayed)? [Completeness, Spec §Zero-Knowledge Impact] — Yes.
- [x] CHK009 Is the privacy-toggle gate (off ⇒ nothing ever sent, reciprocal) specified and consistent with spec 1010? [Consistency, Spec §Zero-Knowledge Impact; FR-010/FR-015; SC-006] — Yes, reused unchanged.

## Privacy & Data Minimization (Principle IX)

- [x] CHK010 Does the spec confirm no new telemetry/analytics and no data collected/transmitted/stored beyond the local flag? [Completeness, Spec §Zero-Knowledge Impact] — Yes.
- [x] CHK011 Are outgoing/own and deleted messages explicitly excluded from both the pill count and any Seen receipt? [Coverage, Spec FR-011; tasks T012] — Yes; T012 now asserts an own/deleted message never emits a receipt.
- [x] CHK012 Is the foreground gate (no sending while backgrounded/hidden) specified so on-screen-while-hidden leaks nothing? [Coverage, Spec FR-012; §Edge Cases] — Yes: "a hidden/backgrounded document suspends Seen sending."

## Local Persistence / Offline-First (Principle V)

- [x] CHK013 Is the new persisted field (`seenReportedAt`) defined with type, semantics, and incoming-only scope? [Clarity, Spec FR-018; data-model] — Yes: optional epoch-ms, incoming-only, distinct from `seenAt`.
- [x] CHK014 Is a `DB_VERSION` bump + a forward, data-preserving migration required, and is it stated that the migration exposes no plaintext (a no-op field add, no content read)? [Completeness, plan Constitution Check V; data-model] — Yes: `DB_VERSION` 6→7, pure `migrateMessageToV7`, never throws.
- [x] CHK015 Is the backfill semantics (existing messages start undefined; a one-time idempotent re-send is possible and harmless) documented and accepted? [Edge Case, data-model; research risks] — Yes.

## Acceptance Criteria measurability

- [x] CHK016 Is the "no content crosses; server relays only opaque receipts" guarantee stated as a measurable success criterion? [Measurability, Spec SC-007] — Yes.
- [x] CHK017 Is the "off-screen ⇒ 0% reported" privacy outcome measurable? [Measurability, Spec SC-001] — Yes.
- [x] CHK018 Is the "toggle off ⇒ 0 receipts sent" guarantee measurable and traceable to spec 1010? [Measurability, Spec SC-006; FR-010] — Yes.

## Consistency, Assumptions & Conflicts

- [x] CHK019 Do spec, plan, and contracts agree (no conflicting statements) that the wire is unchanged? [Consistency, Spec §ZK Impact; plan Constitution Check I; contracts §1] — Yes.
- [x] CHK020 Is the cross-device caveat (the local flag is not synced; duplicate receipts are harmless/idempotent on sender + server) documented so it isn't a hidden assumption? [Assumption, data-model; research risks] — Yes.

## Notes

- Outcome PASS: this client-only feature adds nothing to the wire and weakens no spec-1010
  guarantee; the sole persisted change is a client-local flag behind a forward migration.
- Constitution Principle I is satisfied; `/speckit-implement` is unblocked on the zero-knowledge
  gate. Remaining pipeline: `/speckit-taskstoissues` → `/speckit-implement`.
