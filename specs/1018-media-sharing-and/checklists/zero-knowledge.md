# Zero-Knowledge / E2EE Checklist: Media Sharing & Viewer Improvements

**Purpose**: Validate that the spec's requirements are written clearly and completely enough to
guarantee the zero-knowledge boundary (Constitution Principle I) and crypto discipline (Principle IV)
are preserved — i.e. no plaintext or metadata leak, no new server-readable surface, and fail-open
behavior. This tests the *requirements*, not the implementation.
**Created**: 2026-06-26
**Feature**: [spec.md](../spec.md) · [research.md](../research.md) · [contracts/media-ref.md](../contracts/media-ref.md)

## Zero-Knowledge Boundary Completeness

- [ ] CHK001 - Is there an explicit requirement that ALL media transforms (transcode, orientation, thumbnail generation) occur client-side before sealing? [Completeness, Spec §FR-004, research.md ZK-Impact]
- [ ] CHK002 - Does the spec state what plaintext exists (original bytes, oriented video, thumbnail) and that none of it crosses the client/server boundary? [Completeness, research.md ZK-Impact]
- [ ] CHK003 - Is it specified that the server's view is unchanged (opaque ciphertext + capability-style blob ids only) after this feature? [Clarity, contracts/media-ref.md]
- [ ] CHK004 - Are requirements present that NO new server endpoint, handler, or server-readable field is introduced? [Completeness, contracts/media-ref.md]
- [ ] CHK005 - Is the absence of any SQL migration / `DB_VERSION` change / `SECRETS_KEY` impact stated as a requirement, not just an assumption? [Traceability, plan.md Constitution Check V/VI]

## Encrypted Payload & Wire-Format Consistency

- [ ] CHK006 - Is it required that the thumbnail/`poster` remains INSIDE the sealed `MessagePayload` (never a separate plaintext artifact)? [Completeness, Spec §FR-006, contracts/media-ref.md]
- [ ] CHK007 - Is the requirement that raising thumbnail quality changes ciphertext LENGTH only (not readability) stated unambiguously? [Clarity, research.md US2]
- [ ] CHK008 - Are the wire-shape invariants for `MediaRef` (field names, types, position unchanged) specified so backward/forward compatibility is testable? [Consistency, contracts/media-ref.md]
- [ ] CHK009 - Does the spec specify that `width`/`height` carried on the wire are the DISPLAY (oriented) dimensions, avoiding any orientation-metadata ambiguity that could leak intent server-side? [Clarity, data-model.md, Spec §FR-002]
- [ ] CHK010 - Is the ~40KB thumbnail budget defined as a bound on ciphertext growth (so payload-size requirements are objectively measurable)? [Measurability, Spec §FR-007/§SC-004]

## Crypto Discipline (Principle IV)

- [ ] CHK011 - Is there an explicit requirement that NO new crypto is introduced and the existing ratchet/sealing path is reused unchanged? [Completeness, plan.md Constitution Check IV, research.md cross-cutting]
- [ ] CHK012 - Is it specified that orientation correction and thumbnail changes happen strictly BEFORE the seal step (so they cannot weaken or bypass encryption)? [Consistency, research.md US1/US2]
- [ ] CHK013 - Are requirements free of any new key material, nonce, or AEAD handling that would trigger the crypto-review / forgery-replay-test obligations? [Coverage, Constitution §IV]

## Metadata Minimization & Leakage

- [x] CHK014 - Does the spec address whether orientation/EXIF or capture metadata embedded in original media could leak, and require it be dropped/normalized during client-side re-encode? [Gap, Privacy §IX] → RESOLVED: added FR-014 (metadata minimization; orientation baked as pixels).
- [x] CHK015 - Is it specified that no additional plaintext metadata (dimensions, duration, orientation) is sent to the server beyond what relaying physically requires? [Completeness, Privacy §IX, Gap] → RESOLVED: FR-015 + SC-008.
- [x] CHK016 - Are requirements clear that the higher-quality thumbnail does not become a separately fetchable/cacheable server resource (e.g., via the emoji/asset runtime cache or any new route)? [Edge Case, Gap] → RESOLVED: FR-015 (poster stays inside the sealed payload only); task T024a verifies it isn't matched by the `/v1/emoji/` cache route.

## Fail-Open / Failure Handling

- [ ] CHK017 - Is fail-open behavior a stated requirement: if orientation detection or thumbnail generation fails, the send proceeds with today's behavior and is never blocked? [Completeness, research.md cross-cutting]
- [ ] CHK018 - Does the spec define that a fail-open path must NOT fall back to sending anything unencrypted or to a less-protected route? [Consistency, Gap, Principle I]
- [ ] CHK019 - Are requirements defined for the "no rotation metadata / already upright" case so a fail-safe default cannot double-rotate or distort? [Edge Case, Spec §FR-003]

## Backward / Forward Compatibility

- [ ] CHK020 - Is it required that pre-1018 messages (old posters/encodings) still render for both parties without error? [Completeness, Spec §FR-008/§SC-007]
- [ ] CHK021 - Is the requirement that a pre-1018 client can read a 1018 message (larger poster, oriented dims) specified, so no forced-upgrade coupling is introduced? [Coverage, contracts/media-ref.md]
- [ ] CHK022 - Is "no retroactive re-processing of historical media" stated as a bounded scope requirement? [Clarity, Spec Assumptions]

## Acceptance Criteria Quality & Traceability

- [ ] CHK023 - Are the zero-knowledge guarantees expressed as verifiable criteria (e.g., "server receives only ciphertext + blob id") rather than aspirational language? [Measurability, research.md ZK-Impact]
- [ ] CHK024 - Does every media-payload requirement (FR-004, FR-006, FR-007) trace to a measurable success criterion or contract statement? [Traceability]
- [ ] CHK025 - Is there a stated verification step (checklist/review) confirming the boundary is intact before implementation sign-off? [Completeness, tasks.md T024]

## Notes

- These items test whether the SPEC is written to guarantee the zero-knowledge boundary — not whether
  code implements it. Resolve any `[Gap]` by amending spec.md / research.md before `/speckit-implement`.
- Likely gaps to confirm: CHK014–CHK016 (capture-metadata stripping and ensuring the crisper thumbnail
  never becomes a server-fetchable resource) are the items most likely to need an explicit spec line.
- Check off as `[x]` with a one-line finding when each is confirmed or amended.
