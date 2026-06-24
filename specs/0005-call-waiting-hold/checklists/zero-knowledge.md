# Zero-Knowledge & Privacy Checklist: Call waiting — hold, swap & drop

**Purpose**: Constitution-required review (Principle I — Zero-Knowledge Boundary) of the
*requirements quality* for spec 0005's privacy surface — that the ZK requirements are
complete, clear, consistent, measurable, and cover the leak-risk edges — BEFORE implement.
This validates the spec/plan/tasks wording, not the code.
**Created**: 2026-06-24
**Feature**: [spec.md](../spec.md) · [data-model.md](../data-model.md) · [contracts/hold-signals.md](../contracts/hold-signals.md)

## Sealed signals — no plaintext, no new server metadata (focus 1)

- [x] CHK001 Is it explicitly required that the new `hold`/`resume` signals carry NO plaintext (only opaque ciphertext crosses the wire), to the same standard as offer/answer/ICE? [Completeness, Spec §FR-012]
- [x] CHK002 Is the carrier requirement unambiguous that hold/resume ride an EXISTING sealed frame with NO new transport frame type? [Clarity, Contracts §1 / Tasks T001]
- [x] CHK003 Is the "no server change" claim made testable — i.e. does a requirement/task assert the server relay allowlist and the client `sync.ts` allowlist need no edit? [Measurability, Tasks T001/T032]
- [x] CHK004 Are the fields a hold/resume signal may expose for routing (callId, optional roomId) enumerated, and confirmed to be only ids the relay already handles? [Completeness, Data-model §ZK Impact]

## Indistinguishability — which call is active vs held is not leaked (focus 2, FR-012)

- [x] CHK005 Is there an explicit requirement that the server CANNOT tell which of a user's two calls is active vs held beyond what room membership already reveals? [Completeness, Spec §FR-012]
- [x] CHK006 Is "a hold is indistinguishable from any other sealed signal" stated as a requirement (not just an implementation note), so it is testable? [Clarity/Measurability, Spec §FR-012]
- [x] CHK007 Does the spec address whether the TIMING/RATE of relayed sealed signals during hold/swap could itself be a side channel, and state the acceptable posture? [Gap, Edge Case]
- [x] CHK008 Is it specified that pausing media (no RTP to the held peer) must not create a server-observable signal distinct from a normal quiet/low-bitrate call? [Gap] (media is peer-to-peer/relayed via TURN, not the app server — is that boundary stated?)

## Client-local media pause + two-slot state (focus 3)

- [x] CHK009 Is it required that the media pause/resume mechanism (`replaceTrack(null|live)`) and the two-slot active/held state are entirely client-local and emit NO new server-visible metadata? [Completeness, Plan §Technical Context / Data-model §ZK Impact]
- [x] CHK010 Is the requirement consistent that a `call-leave`/`call-join` is NOT emitted on hold/resume (so the server's room membership is unchanged by holding)? [Consistency, Gap] — holding must not look like leaving/rejoining to the relay.
- [x] CHK011 For a held GROUP call, is it required that pausing the holder's legs does not alter the server-tracked roster (the holder stays a member while paused)? [Completeness, Spec §FR-006]

## Client-local "on hold" indication & cues (focus 4)

- [x] CHK012 Is it required that the "on hold" indication shown to the other party/members is derived client-side from the sealed signal (not from any server-pushed state)? [Completeness, Spec §FR-007]
- [x] CHK013 Is it required that call-waiting cues are entirely client-local and add no server-visible metadata? [Completeness, Spec §FR-011]

## No new server/IndexedDB persistence (focus 5)

- [x] CHK014 Is the "no new server state, table, or migration" boundary stated as a requirement, not just an assumption? [Clarity, Plan §Storage / Data-model §ZK Impact]
- [x] CHK015 Is it required that call state is ephemeral (no IndexedDB store, no `DB_VERSION` bump) so hold/swap leaves no at-rest trace? [Completeness, Plan §Storage]
- [x] CHK016 Is the `SECRETS_KEY` / Principle VI impact addressed (confirmed unchanged, since no new persistence touches it)? [Coverage, Constitution §VI]

## Call-history logging does not leak hold/swap timing (focus 6)

- [x] CHK017 Is it required that a held-then-resumed call logs as ONE history entry, with hold/swap/resume NOT recorded as events? [Completeness, Spec §FR-010]
- [x] CHK018 Is it specified that no hold/swap/resume TIMESTAMP is written anywhere that reaches the server (history is client-local and own-data-sync is already encrypted)? [Gap, Edge Case]

## Requirements completeness, clarity & traceability (cross-cutting)

- [x] CHK019 Does the spec contain a dedicated **Zero-Knowledge Impact** section (what crosses the wire / what's encrypted / what metadata is unavoidable / why), as Principle I requires of EVERY spec? [Gap, Constitution §I] — currently this lives in data-model.md, not spec.md.
- [x] CHK020 Is there a requirement-level (not just task-level) statement that a zero-knowledge review gates merge, and is it traceable to a task? [Traceability, Tasks T032]
- [x] CHK021 Are the ZK requirements phrased measurably enough that an e2e/manual check can pass/fail them (e.g. "server logs show only relayed sealed signals; no hold marker")? [Measurability, Quickstart §ZK spot check]
- [x] CHK022 Is each ZK-relevant requirement (FR-012, and the no-persistence/indistinguishability claims) covered by at least one task? [Coverage, Tasks T001/T032/T030]

## Edge cases & implementation leak-risks (implementation-risk angle)

- [x] CHK023 Is the leak risk of routing hold/resume as a NEW outer frame type (which would need a server relay-allowlist change → new metadata) explicitly closed off by requiring inner-`type` dispatch over an existing frame? [Edge Case, Contracts §1 / Tasks T007]
- [x] CHK024 Are requirements defined to prevent a debug/log line, metric, or error payload from recording hold/resume events or which call is active (no DIAG regression)? [Gap, Constitution §I]
- [x] CHK025 Is the held-call recovery path (network blip while held) required to reuse the existing grace/recovery without emitting new server-visible state? [Coverage, Spec §Edge Cases / Data-model]
- [x] CHK026 For an ad-hoc group held call between non-contacts, is it required that the ephemeral call-scoped sealed session is used for hold/resume too (no new key material or server exposure)? [Coverage, Gap]
- [x] CHK027 Is it required that a third caller's busy reply at the two-call cap reveals nothing more than the existing busy signal already does (no "two calls" count leaked)? [Edge Case, Spec §FR-008]
- [x] CHK028 Does the spec confirm AGPL/license + data-minimization posture is unchanged (no new telemetry from hold/swap)? [Coverage, Constitution §IX]
