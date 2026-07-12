# Zero-Knowledge & Privacy Requirements Checklist: Direct Peer-to-Peer Call Media

**Purpose**: Validate that the requirements fully and unambiguously cover the zero-knowledge boundary, the peer IP-exposure trade-off and its opt-out, relay fallback reliability, and cross-version wire compatibility — before implementation (constitution: checklist REQUIRED for Principle I specs)
**Created**: 2026-07-12
**Feature**: [spec.md](../spec.md)

## Zero-Knowledge Boundary

- [x] CHK001 - Does the spec enumerate exactly what crosses the wire on every new path (direct media, relayed media, address discovery, advertised endpoint), and what is encrypted on each? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK002 - Is the "server learns nothing new" claim bounded and verifiable — i.e. does the spec state what the server already sees today (client IPs on HTTP/WS, who-calls-whom) so the delta is objectively checkable? [Measurability, Spec §Zero-Knowledge Impact]
- [x] CHK003 - Is "no cryptographic change" an explicit, testable requirement rather than an implementation hope? [Clarity, Spec §FR-003, §Zero-Knowledge Impact]
- [x] CHK004 - Does the spec address the inverse-metadata question — what the server can infer from the *absence* of relay traffic when a leg goes direct? [Coverage, Spec §Zero-Knowledge Impact]
- [x] CHK005 - Are requirements phrased so that no log line, metric, or error payload could newly expose user content (constitution I) — i.e. does the feature introduce any new server-side data sink at all? [Coverage, Spec §FR-005, data-model.md]

## Peer IP-Exposure Trade-off & Opt-Out

- [x] CHK006 - Is the exposure precisely scoped: which address (public vs local) becomes visible, to whom (accepted call peer only), and under which conditions (direct paths, LAN masking)? [Clarity, Spec §Zero-Knowledge Impact]
- [x] CHK007 - Does the opt-out requirement avoid overpromising — is it explicit that a relay-forced user still *receives* the peer's candidates and only their *own* address is protected? [Clarity, Spec §Edge Cases, §Zero-Knowledge Impact]
- [x] CHK008 - Are the opt-out's default value, cross-device sync behavior, and when-it-takes-effect all specified? [Completeness, Spec §FR-007, §FR-008]
- [x] CHK009 - Is the asymmetric case (one participant forced-relay, the other direct-capable) defined with a required outcome? [Coverage, Spec §FR-009, US3 AS2]
- [x] CHK010 - Does the opt-out cover group calls (every leg of that user), not just 1:1? [Coverage, Spec §FR-007, US3 AS1]
- [x] CHK011 - Is the rationale for the default (off) documented against Ring's privacy-first posture so reviewers can evaluate the trade-off rather than infer it? [Traceability, Spec §Assumptions, research.md D4]

## Relay Fallback Reliability

- [x] CHK012 - Is "calls never get less reliable" stated as a measurable acceptance criterion (every scenario that connected before still connects)? [Measurability, Spec §FR-002, §SC-003]
- [x] CHK013 - Is the allowed call-setup-time regression quantified with a specific budget rather than a vague adjective? [Clarity, Spec §SC-004]
- [x] CHK014 - Are mid-call path-loss requirements defined (direct path dies → existing reconnection ends on relay)? [Completeness, Spec §FR-010, §Edge Cases]
- [x] CHK015 - Is the misconfigured-deployment case (UDP endpoint enabled but firewalled) given a required non-hanging outcome? [Edge Case, Spec §Edge Cases]
- [x] CHK016 - Are credential-expiry and connection-restart behaviors required to match today's on both path types? [Coverage, Spec §Edge Cases]
- [x] CHK017 - Do the requirements keep the TLS-on-443 relay as the universal baseline (constitution Domain Constraints) with the UDP endpoint strictly additive and opt-in? [Consistency, Spec §FR-005, §Assumptions, plan.md Constitution Check]

## Cross-Version Wire Compatibility

- [x] CHK018 - Are all four client/server version pairings given required outcomes (old↔new in both directions, with and without the new config)? [Coverage, Spec §US2 AS4, contracts/turn-credentials.md compatibility matrix]
- [x] CHK019 - Is the response-shape stability requirement objectively testable (shape unchanged; additive entry only when configured)? [Measurability, Spec §FR-006, contracts/turn-credentials.md]
- [x] CHK020 - Is the deployment ordering assumption (server ships before or with client) documented where implementers will see it? [Dependency, Spec §Assumptions, plan.md]
- [x] CHK021 - Is terminology consistent across spec/plan/contract ("direct" vs "relayed" paths, "relay" for the server component) with no drifting synonyms? [Consistency]

## Notes

- CHK004: initially a [Gap] — the Zero-Knowledge Impact section claimed the server sees *less* but did not state the inference flip-side (absence of relay media reveals that a leg went direct, e.g. same-LAN co-location). Resolved 2026-07-12: sentence added to §Zero-Knowledge Impact.
- CHK013: initially an [Ambiguity] — SC-004 said "a few hundred milliseconds". Resolved 2026-07-12: SC-004 now pins the budget at 300 ms, matching tasks.md T022.
- All other items passed on first evaluation against spec.md + plan.md + research.md + contracts/turn-credentials.md.
