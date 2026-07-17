# Zero-Knowledge & Privacy Checklist: Group call reliability, caps, adaptive quality, cues & busy

**Purpose**: Constitution-required (Principle I) validation that the spec's zero-knowledge
requirements are complete, clear, consistent, and measurable — and that no new path could leak
plaintext, media, keys, or new metadata to the server. Tests the *requirements*, not the code.
**Created**: 2026-06-23
**Feature**: [spec.md](../spec.md) · [research.md](../research.md) · [contracts/ws-call-frames.md](../contracts/ws-call-frames.md)

## No plaintext / media / keys on any new path

- [ ] CHK001 Is the data carried by the new `call-full` frame explicitly bounded to non-sensitive routing fields (roomId, kind) in the requirements? [Completeness, Contract §Added frames]
- [ ] CHK002 Is the payload of the group-scoped `call-busy` frame explicitly specified as carrying only `to` + `roomId` (no call content, profile, or membership beyond the addressed pair)? [Clarity, Spec §FR-006, Contract §Changed frames]
- [ ] CHK003 Does the spec require that server-side cap enforcement use ONLY the call `kind` and the roster the server already tracks, with no new field added to `call-join`? [Completeness, Spec §FR-012, §FR-041]
- [ ] CHK004 Are the SDP/ICE payloads in the (unchanged) offer/answer/ice frames still required to remain end-to-end-encrypted ciphertext the server cannot read? [Consistency, Spec §FR-041]
- [ ] CHK005 Is there a requirement that NO call-history outcome value (busy/unavailable/missed/declined) is transmitted to or stored by the server (history is device-local)? [Gap, Spec §FR-031]

## Signalling stays sealed over the existing ratchet

- [ ] CHK006 Does the spec require that any new/changed frame conveying pairwise state is sealed over the pair's existing Double Ratchet rather than introducing a new transport? [Clarity, Spec §FR-041]
- [ ] CHK007 Is it specified whether the group `call-busy` reply needs to be sealed, or is justified as carrying no secret (only the already-visible fact "this user is unavailable for this room")? [Ambiguity, Spec §FR-006]
- [ ] CHK008 Are the requirements consistent that removing the SFU does not change how 1:1/mesh signalling is sealed (X3DH + Double Ratchet path unchanged)? [Consistency, Spec §FR-027, §FR-041]
- [ ] CHK009 Is the ephemeral call-scoped session for non-contact co-members (and its same-room key-bundle gate) preserved as a requirement after cleanup? [Coverage, Spec §US6, research §6]

## SFU teardown leaves no plaintext-exposing residue

- [ ] CHK010 Does the spec require that, after SFU removal, NO server component touches or routes media (mesh media never transits the server)? [Completeness, Spec §FR-027]
- [ ] CHK011 Is there an explicit requirement that the removed `call-diag` / DIAG instrumentation logged room ids, participant ids, or stream↔member bindings, and MUST be gone? [Clarity, Spec §FR-030]
- [ ] CHK012 Does the spec require that no replacement diagnostic (including the retained on-screen ⓘ panel) emits room/participant identity to the server, logs, or metrics? [Gap, Spec §FR-030]
- [ ] CHK013 Is the server boot log / advertisement requirement (no "SFU ready", no SFU advertised) specified in a way that is objectively verifiable? [Measurability, Spec §FR-028, §SC-012]
- [ ] CHK014 Are the requirements clear that deleting the per-frame media-E2EE modules (insertable streams) removes only the unused SFU-era layer and does NOT weaken the mesh's native DTLS-SRTP E2EE? [Consistency, Spec §FR-027, research §6]

## Adaptive quality & cues are client-local

- [ ] CHK015 Does the spec require that adaptive quality decisions are derived entirely from local `getStats()` and emit NO new frames or server-visible signal? [Completeness, Spec §FR-016, §FR-022]
- [ ] CHK016 Is it specified that per-receiver quality differentiation reveals nothing new to the server (no per-peer quality report crosses the wire)? [Clarity, Spec §FR-018, §FR-019]
- [ ] CHK017 Does the spec require that audio cues are purely client-side and produce no telemetry or server interaction? [Coverage, Spec §FR-023..026]
- [ ] CHK018 Is the in-call message cue specified so that it does not cause any additional server round-trip or reveal call state to the server (it reacts to an already-received message)? [Gap, Spec §FR-025]

## No new server metadata beyond room membership + call kind

- [ ] CHK019 Does the spec state the complete set of metadata the server may learn for this feature, and confirm it is a subset of {room membership, call kind} already known? [Completeness, Spec §FR-041, Assumptions]
- [ ] CHK020 Is there a requirement that server-side cap refusal (`call-full`) does not record or expose who attempted to join beyond the transient routing needed to reply? [Ambiguity, Spec §FR-012]
- [ ] CHK021 Are the requirements consistent that the group-ring reminder cancellation triggered by a busy reply uses only existing room/member routing (no new stored state)? [Consistency, Spec §FR-006, research §2]
- [ ] CHK022 Does the spec require data minimization for the call buffer changes (clearing, not expanding, what the server holds about an invitee)? [Coverage, Spec §FR-002]

## Requirement quality of the zero-knowledge guarantees themselves

- [x] CHK023 Does the spec contain (or reference) a dedicated Zero-Knowledge Impact statement answering what crosses the wire, what is encrypted, and what metadata is unavoidably visible — as the constitution mandates for every spec? [Gap, Constitution Principle I] — RESOLVED: added `## Zero-Knowledge Impact` section to spec.md.
- [ ] CHK024 Is each zero-knowledge requirement (FR-041 and the per-frame constraints) phrased so it can be objectively verified by inspection of the wire/logs (testable, not aspirational)? [Measurability, Spec §FR-041, §SC-012]
- [ ] CHK025 Are "no new metadata" and "no plaintext" claims defined with enough precision that a reviewer could detect a violation (e.g., an enumerated allow-list of fields per frame)? [Clarity, Contract]
- [ ] CHK026 Is there an acceptance criterion that ties the zero-knowledge guarantee to a concrete verification step (the ZK spot-check in quickstart / a review task)? [Traceability, quickstart §ZK spot check, tasks T052]
- [ ] CHK027 Are the requirements free of conflict between "server enforces caps" (needs to act on roster+kind) and "server stays zero-knowledge" (must not learn content)? [Conflict, Spec §FR-012 vs §FR-041]

## Edge cases where a careless implementation could leak

- [ ] CHK028 Does the spec address whether an error/refusal payload (e.g., `call-full`, a failed seal) could inadvertently carry diagnostic plaintext, and require it not to? [Edge Case, Gap]
- [ ] CHK029 Is the behavior specified when a busy/cap reply must be sent to a non-contact co-participant — confirming it uses only already-permitted same-room routing and leaks no contact relationship? [Coverage, Spec §FR-006]
- [ ] CHK030 Does the spec require that retained call diagnostics (ⓘ panel, any kept stats) are local-only even under error/verbose conditions (no "debug mode" that logs identities server-side)? [Edge Case, Spec §FR-030]

## Notes

- Check items off as resolved: `[x]`; record the spec/contract line that satisfies each.
- This checklist gates `/speckit-implement` (constitution Principle I + gate sequencing).
- CHK023 is the highest-value gap to confirm: the spec embeds zero-knowledge constraints in
  FR-041/Assumptions/research rather than a single titled "Zero-Knowledge Impact" section —
  decide whether to add that explicit section to fully satisfy the constitution's wording.
