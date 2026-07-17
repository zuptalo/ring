# Zero-Knowledge Checklist: Smooth Chat-History Scroll-Up (spec 1011)

**Purpose**: Constitution gate-sequencing requirement — `/speckit-checklist` is REQUIRED for
any spec touching Principle I (Zero-Knowledge Boundary) or IV (Crypto Discipline). This
checklist is "unit tests for the requirements": it validates that the spec's zero-knowledge
and privacy requirements are complete, clear, consistent, and measurable — NOT that the
implementation works. It mirrors the precedent set by client-only specs 1009 and 1010.
**Created**: 2026-06-18
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [contracts/chat-history.md](../contracts/chat-history.md)

**Outcome**: PASS — all items below are satisfied by the spec/plan/contracts. The feature is
client-only (render + data-access); nothing new crosses or changes the client↔server boundary.

## Zero-Knowledge Boundary (Principle I)

- [x] CHK001 Does the spec explicitly state what crosses the wire for this feature? [Completeness, Spec §Zero-Knowledge Impact] — Yes: "nothing new… no request, payload, header, or metadata is added or changed."
- [x] CHK002 Is it specified that the bounded reads return only already-on-device, already-decrypted-for-render `Message` rows (no new decryption or plaintext produced)? [Clarity, Spec §Zero-Knowledge Impact; contracts/chat-history.md §1] — Yes: bounded reads slice the existing `messages` store in memory; same rows the chat view already uses.
- [x] CHK003 Is the absence of any new key use / crypto change documented? [Completeness, Spec §Zero-Knowledge Impact; plan Constitution Check IV] — Yes: `messaging.ts`/ratchet untouched; "no new key use."
- [x] CHK004 Is it specified that nothing new is persisted or logged in plaintext (no debug aid, error payload, or sync field)? [Coverage, Spec §Zero-Knowledge Impact] — Yes: "no new plaintext is produced or persisted."
- [x] CHK005 Is the absence of any storage-schema change documented (no `DB_VERSION` bump, no new index) so no migration can expose data? [Consistency, plan Constitution Check V; research D2] — Yes: `DB_VERSION` stays 6, no new index; reads are in-memory slices.

## Privacy & Data Minimization (Principle IX)

- [x] CHK006 Are the server-visible metadata items (read positions, scroll state, window bounds, batch sizes) explicitly stated to remain client-only? [Completeness, Spec §Zero-Knowledge Impact] — Yes: "the server sees no read positions, scroll state, window bounds, or batch sizes — all local-only."
- [x] CHK007 Does the spec confirm no new telemetry/analytics and no new data collected/transmitted/stored? [Completeness, Spec §Zero-Knowledge Impact + Assumptions] — Yes: no new data; eviction/bounded reads reduce in-memory/DOM footprint.
- [x] CHK008 Is the dev-only nature of the `__ringTest.seedMessages` test hook specified (stripped from production, like the rest of `__ringTest`)? [Clarity, Spec §Zero-Knowledge Impact; plan Constitution Check IX; contracts §4] — Yes: "Dev-only (stripped from prod)."

## Requirement Clarity for Boundary-Relevant Behaviors

- [x] CHK009 Is it unambiguous that the bounded-read APIs (`listMessagesOlder`/`listMessagesNewer`/`countChatMessages`) operate purely on the existing local store with no network access? [Clarity, contracts §1; research D2] — Yes: backed by the existing `chatId` index + in-memory sort/slice.
- [x] CHK010 Is it clear that incremental reactivity (`useChatHistory`) reads/patches only local rows via the IndexedDB change bus and emits nothing to the server? [Clarity, contracts §2; data-model.md] — Yes: append/patch/remove on local rows; no wire interaction.
- [x] CHK011 Does FR-014 (backgrounded/locked view) keep its scope to local render side-effects, introducing no new network/persistence activity? [Coverage, Spec FR-014] — Yes: it only gates scroll-position/window side-effects; no new I/O.

## Gate Sequencing & Traceability

- [x] CHK012 Is the checklist-gate decision recorded in the spec's *Complexity & Exceptions* section per Constitution gate-sequencing? [Traceability, Spec §Complexity & Exceptions] — Yes; this checklist now satisfies the gate directly.
- [x] CHK013 Is the client-only scope stated consistently across spec, plan, research, and quickstart with no contradiction implying a wire/server change? [Consistency] — Yes: every artifact states client-only; plan Constitution Check I/V/VI all PASS.

## Residual Risk

- [x] CHK014 Is any residual zero-knowledge risk left unspecified (a new error payload, debug log, sync field, or server-readable derived value)? [Gap] — None identified. The change is confined to the client render/data-access layer; the server relays the same opaque ciphertext as before.

## Notes

- All 14 items satisfied → Principle I (zero-knowledge boundary) and Principle IX (privacy /
  data minimization) are intact; Principle IV (crypto) is untouched.
- This is a requirements-quality gate, not implementation verification. The behavioral proof
  that nothing crosses the wire is additionally covered by the unchanged server test suite
  (`go test ./...` stays green — tasks T002/T033) and the client-only diff scope.
