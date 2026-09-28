# Crypto / Zero-Knowledge Checklist: Tech Stack Uplift

**Purpose**: Validate the *requirements quality* (completeness, clarity, consistency,
measurability, coverage) of the spec's crypto-core clauses before implementing the
`libsodium-wrappers-sumo` bump — required because this spec touches Constitution
Principle IV (Crypto Discipline) and Principle I (Zero-Knowledge Boundary).
**Created**: 2026-09-28
**Feature**: [spec.md](../spec.md) — FR-005, SC-003, Edge Cases, Zero-Knowledge Impact

**Note**: These items test whether the *requirements are written well enough to
implement against and to security-review against* — not whether the bump itself
works. Findings here should be resolved by editing `spec.md` (or explicitly
accepted as an intentional deferral), not by writing code.

## Requirement Completeness

- [x] CHK001 Are regression requirements specified separately for 1:1 (X3DH/Double Ratchet) sessions and group sender-key sessions, or does "the crypto regression suite" in FR-005 implicitly assume only one session pattern? [Completeness, Spec §FR-005] — **Resolved**: FR-005 now names both suites explicitly and notes the group suite lacks a replay case the 1:1 suite has; tasks.md T027a adds it.
- [x] CHK002 Does FR-005 explicitly cover PIN-wrapped secrets-at-rest (device keys, per Constitution Principle IV's Argon2id-AEAD requirement) in addition to message/session ciphertext, or is "existing sessions/devices" ambiguous between the two? [Completeness, Ambiguity, Spec §FR-005] — **Resolved**: FR-005 now explicitly names secrets-at-rest alongside message/session ciphertext.
- [x] CHK003 Is the underlying native libsodium library version bundled by `libsodium-wrappers-sumo` 0.7.16 vs. 0.8.4 documented anywhere, with its implication for FR-005's no-change guarantee stated? [Completeness, Assumption, Spec §FR-005; research.md] — **Resolved**: new Assumptions bullet requires T026/T027 to check and note this delta.
- [x] CHK004 Are the specific test file(s)/module(s) that constitute "the crypto regression suite" referenced by FR-005/SC-003 named anywhere, or left implicit? [Traceability, Gap, Spec §FR-005] — **Resolved**: FR-005 now names `ratchet.test.ts`, `ratchet.staged.test.ts`, `senderkeys.test.ts`.

## Requirement Clarity

- [x] CHK005 Is "wire format" in FR-005 clarified as byte-identical ciphertext output, or merely decrypt-compatible output under a possibly-different internal encoding? [Clarity, Ambiguity, Spec §FR-005] — **Resolved**: FR-005 now states decrypt-compatibility under the existing schema is the bar, not byte-identical output.
- [x] CHK006 Is the scope of the required "security review" (FR-005) — who performs it and what it must check — defined, or left entirely to reviewer discretion? [Clarity, Gap, Spec §FR-005] — **Resolved**: new FR-005a defines reviewer + explicit pass criteria against this checklist.
- [x] CHK007 Is "existing local data" in the device-verification step bounded to a specific set of message/media/profile types, or left open to interpretation? [Clarity, Measurability, Spec Edge Cases] — **Resolved**: new FR-005c enumerates the minimum data set.

## Acceptance Criteria Quality

- [x] CHK008 Can SC-003's "zero loss of access to previously-encrypted local data or active sessions" be objectively verified without a defined reference dataset (e.g., a fixed pre-bump device snapshot)? [Measurability, Spec §SC-003] — **Resolved**: SC-003 now points to FR-005c's dataset and requires checking against that device's pre-bump state.
- [x] CHK009 Does SC-003 define what constitutes a passing security review, or only that one must "pass" without stating the criteria? [Measurability, Gap, Spec §SC-003] — **Resolved**: SC-003 now references FR-005a's criteria.

## Scenario & Edge Case Coverage

- [x] CHK010 Are recovery requirements defined for the scenario where a ciphertext-compatibility break is discovered only *after* the `libsodium-wrappers-sumo` PR has already merged and released, given that every merge into `main` ships a release? [Coverage, Gap, Recovery Flow, Spec Edge Cases] — **Resolved**: new FR-005b + Edge Case require a same-day revert.
- [x] CHK011 Is it stated whether a device upgrades `libsodium-wrappers-sumo` strictly as part of a full, atomic app update (no partial/mixed-version state across a user's devices), or is a mixed-version window in scope and unaddressed? [Coverage, Assumption, Gap] — **Resolved**: new Assumptions bullet states the update is atomic per device.
- [x] CHK012 Are requirements defined for what happens if the automated crypto regression suite passes but the manual real-device check fails, or vice versa — is one alone ever sufficient to merge? [Coverage, Consistency, Spec §FR-005; tasks.md T028-T030] — **Resolved**: FR-005 now states both are required; neither alone is sufficient.

## Consistency & Constitution Alignment

- [x] CHK013 Does the spec state that this bump's verification bar (forgery/replay/out-of-order/skipped-key) is the *same* minimum Constitution Principle IV names for any crypto change — confirming no reduced bar was applied just because this is "a version bump," not new code? [Consistency, Traceability, constitution.md Principle IV; Spec §FR-005] — **Resolved**: FR-005 states this explicitly.
- [x] CHK014 Is the Zero-Knowledge Impact section's claim that "no other item…touches…plaintext" cross-checked against every Phase A/B/C item individually, or asserted only by exclusion around the one flagged exception? [Consistency, Spec §Zero-Knowledge Impact] — **Resolved**: section rewritten to name each phase's items individually, including the Pion/TURN item's own narrower exception.

## Dependencies & Assumptions

- [x] CHK015 Is the assumption that `@types/libsodium-wrappers-sumo`'s type definitions remain accurate for 0.8.x (i.e., no silent API-shape change the type-check wouldn't catch) stated anywhere? [Assumption, Gap] — **Resolved**: new Assumptions bullet states this and why `npm run build` is a sufficient backstop.
- [x] CHK016 Does "key derivation" in FR-005 clearly exclude — or explicitly also block — an intentional, backward-compatible parameter change (e.g., an Argon2id cost-parameter default) the library might introduce as a security hardening? [Ambiguity, Spec §FR-005] — **Resolved**: new FR-005a states hardening changes are permitted only if applied prospectively without breaking existing decryption.

## Notes

- Check items off once the underlying spec clause has been reviewed and judged
  adequate (or explicitly amended in `spec.md`) — not once the code is written.
- This checklist is scoped to the crypto/zero-knowledge track only, per the
  clarify-before-generate decision. The Calls/TLS (Pion/TURN) track already has
  concrete verification steps in `tasks.md` (T035/T036) and was intentionally
  left out of this file's scope.
- If any item here surfaces a real gap, resolve it in `spec.md` before the
  `libsodium-wrappers-sumo` task track (T026-T031) reaches its security-review
  step (T030) — this checklist gates *readiness to review*, not the review itself.
