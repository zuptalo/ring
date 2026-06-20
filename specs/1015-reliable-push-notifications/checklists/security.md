# Security & Zero-Knowledge Checklist: Reliable Push & Redesigned In-App Notifications

**Purpose**: Validate the *quality* (completeness, clarity, consistency,
measurability, coverage) of the zero-knowledge, crypto, privacy, and
notification-delivery requirements before implementation. Required by
Constitution Principle I (Zero-Knowledge) & IV (Crypto Discipline). This is a
release-gate checklist intended for maintainer sign-off.

**Created**: 2026-06-20
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md)

**Note**: These items test whether the *requirements are written correctly*, not
whether the implementation works.

## Zero-Knowledge Boundary — Requirement Completeness

- [ ] CHK001 - Is the requirement that the push payload stays content-free stated unambiguously and applied to the new event type as well as messages? [Completeness, Spec §FR-007, §Zero-Knowledge Impact]
- [ ] CHK002 - Are the exact fields permitted in the new connection tickle specified, and is it explicit that no identity/state is included? [Clarity, Spec §Zero-Knowledge Impact, Contracts §1]
- [ ] CHK003 - Is the requirement that per-chat notification preferences are never transmitted to or stored by the server stated for every preference (web push, in-app, content visibility)? [Completeness, Spec §FR-026, §FR-012]
- [ ] CHK004 - Does the spec define which metadata is unavoidably visible to the server for connection events and justify why it is no greater than today? [Completeness, Spec §Zero-Knowledge Impact]
- [ ] CHK005 - Is it specified that enforcement of "web push off for a chat" happens on the client (server still emits the content-free tickle)? [Clarity, Spec §FR-022, §Zero-Knowledge Impact]
- [x] CHK006 - Are requirements present forbidding plaintext exposure via logs, metrics, or error payloads introduced by this feature? [Coverage, Gap, Constitution §I] → resolved: added FR-007a.

## Crypto / Decryption — Requirement Clarity & Coverage

- [ ] CHK007 - Is "decrypted correctly and completely" defined with verifiable criteria (full text, correct sender, no truncation/corruption beyond explicit length limits)? [Measurability, Spec §FR-002, §FR-003, §SC-002]
- [ ] CHK008 - Is the requirement that notification-preview decryption is read-only and must not advance/persist ratchet state stated unambiguously? [Clarity, Spec §FR-003]
- [ ] CHK009 - Are requirements defined for the locked-device case (no key) covering both the immediate fallback and the later reveal-on-unlock behavior? [Coverage, Spec §FR-004, §SC edge cases]
- [ ] CHK010 - Is it explicit that no new crypto primitive, key exchange, or ratchet scheme is introduced (reuse-only)? [Consistency, Spec §Out of Scope, Constitution §IV]
- [x] CHK011 - Does the spec specify behavior when decryption partially succeeds or yields malformed content (vs. a clean success/failure binary)? [Edge Case, Gap, Spec §FR-002] → resolved: added FR-004a.

## Notification Delivery Semantics — Measurability & Clarity

- [ ] CHK012 - Is "reported as delivered" defined precisely as the internal relay-ack ordering guarantee, with explicit statement that no sender-visible receipt changes? [Clarity, Spec §FR-005, §Clarifications]
- [ ] CHK013 - Are the preconditions for acknowledging/draining an incoming item (durable persist AND notification surfaced/intentionally suppressed) enumerated unambiguously? [Completeness, Spec §FR-005, US1 scenario 3]
- [ ] CHK014 - Is the "never silently dropped" guarantee paired with a defined terminal behavior when display perpetually fails (surfaces on next open, not lost)? [Coverage, Spec §Edge Cases, §SC-003]
- [ ] CHK015 - Is the duplicate-suppression requirement (exactly one notification across page + service worker, preferring content-bearing) measurable and unambiguous? [Measurability, Spec §FR-006, §SC-009]
- [ ] CHK016 - Are reliability targets stated in objectively verifiable terms (trial counts, percentages, platforms) rather than vague adjectives like "reliable"/"a few seconds"? [Measurability, Spec §SC-001, §FR-001]

## Friend-Request Lifecycle — Coverage & Consistency

- [ ] CHK017 - Are notification requirements defined for all three lifecycle events (received, accepted, rejected) with consistent open/closed-app behavior? [Coverage, Spec §FR-008, §FR-009, §FR-010]
- [ ] CHK018 - Is the "always fire, not gated by a per-category setting" rule for friend-request notices stated consistently across spec sections (no residual "respecting settings" language)? [Consistency, Spec §FR-008, §FR-010, §Clarifications]
- [ ] CHK019 - Is the privacy stance on rejection notifications explicit (the requester is intentionally informed), so it is not mistaken for an oversight? [Clarity, Spec §US2 scenario 3]
- [x] CHK020 - Are name-resolution requirements defined for inbound requests where the requester is unknown to the recipient (generic, identity-safe label)? [Gap, Spec §FR-012, Research §Decision 1] → resolved: added FR-012a.

## Per-Chat Preferences & Settings — Consistency & Conflicts

- [ ] CHK021 - Is the "most-private-wins" conflict rule between global and per-chat settings stated and applied consistently to every surface (push, in-app, content, calls)? [Consistency, Spec §FR-023, §SC, Data-model]
- [ ] CHK022 - Are the three per-chat controls defined as orthogonal with explicit defaults, and is the badge-only ("content = none") outcome unambiguously specified? [Clarity, Spec §FR-021, §FR-022, §FR-024]
- [ ] CHK023 - Is the interaction between the existing mute, web-push-off, and the new content-visibility setting fully specified without contradiction? [Conflict, Spec §FR-027, §Edge Cases]
- [ ] CHK024 - Is the requirement that existing chats retain current behavior on upgrade (no noisiness change) stated with the concrete default values? [Completeness, Spec §FR-025, Data-model]
- [ ] CHK025 - Is the global in-app master switch's scope precisely bounded (suppresses banners only; leaves system push + badge intact)? [Clarity, Spec §FR-018]

## Calls vs. Mute (FR-022a) — Edge Case Coverage

- [ ] CHK026 - Is the requirement that per-chat web-push-off/mute also silences that chat's calls stated for both 1:1 and group calls? [Coverage, Spec §FR-022a, §Clarifications]
- [x] CHK027 - Does the spec define the app-closed call-mute behavior precisely enough to distinguish a hard guarantee from a best-effort (fail-open) one? [Ambiguity, Spec §FR-022a, Research §Decision 4] → resolved: FR-022a now states hard-when-resolvable / fail-open-when-closed.

## Acceptance Criteria — Measurability & Traceability

- [ ] CHK028 - Does every P1/P2/P3 user story have at least one measurable success criterion mapped to it (no story without an objective pass/fail)? [Traceability, Spec §SC-001..§SC-009]
- [ ] CHK029 - Is the zero-knowledge non-regression criterion expressed as an objectively checkable assertion about wire payloads/storage? [Measurability, Spec §SC-008]
- [ ] CHK030 - Are group-chat scope requirements (controls + hardening apply to groups) traceable from the clarification into concrete FRs/SCs, not only the assumptions? [Traceability, Spec §FR-021, §Clarifications]

## Dependencies & Assumptions — Validation

- [ ] CHK031 - Is the assumption that iOS Web Push requires an installed PWA (and the graceful degradation when push is unavailable) documented as a validated constraint, not an aside? [Assumption, Spec §Assumptions, §Edge Cases]
- [ ] CHK032 - Is the dependency on the existing read-only preview-decrypt path and existing subscription/relay/connection storage stated, with confirmation that no new server schema/migration is required? [Dependency, Plan §Technical Context, Data-model §Server schema]

## Notes

- Items are requirement-quality gates; resolve each by amending the spec (not the
  code) where a gap/ambiguity/conflict is confirmed.
- The four drafting gaps flagged at generation — CHK006 (no-plaintext-in-logs),
  CHK011 (partial/malformed decryption), CHK020 (identity-safe label), CHK027
  (hard vs. best-effort call-mute) — have been **resolved** by spec amendments
  (FR-007a, FR-004a, FR-012a, FR-022a). The remaining unchecked items are
  quality-review confirmations to perform during `/speckit-analyze`.
- This checklist must be clean (or each open item explicitly waived with
  maintainer sign-off) before `/speckit-implement`, per Constitution §II and the
  gate-sequencing rule.
