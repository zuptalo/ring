# Zero-Knowledge & Privacy Checklist: HD/SD video sends are transcoded for real on device

**Purpose**: Validate that the spec's requirements keep the zero-knowledge boundary
(Constitution Principle I) and data-minimization (Principle IX) intact — i.e. that
the requirements are *written* clearly enough to guarantee the server stays blind and
the change only ever reduces transmitted data. (Unit-tests-for-requirements, not
implementation verification.)
**Created**: 2026-06-22
**Feature**: [spec.md](../spec.md)

## Zero-Knowledge Boundary

- [ ] CHK001 - Do the requirements state that all video transcoding happens on the sender's device *before* encryption, leaving no point where the server sees plaintext media? [Completeness, Spec §FR-004]
- [ ] CHK002 - Is it explicit that the server's role is unchanged (relays opaque ciphertext + capability-style blob ids only) and that this feature adds no server capability? [Clarity, Spec §"Zero-Knowledge Impact"]
- [ ] CHK003 - Do the requirements confirm that no *new* field or metadata crosses the wire as a result of honest labeling (the achieved-quality tier reuses the already-sealed `MediaRef.quality`)? [Completeness, Spec §"Zero-Knowledge Impact", data-model.md]
- [ ] CHK004 - Is the achieved-vs-requested quality distinction specified as a value carried *inside the sealed payload*, not as server-visible metadata? [Clarity, Conflict-check, data-model.md]
- [ ] CHK005 - Do the requirements preclude any server-side transcode or server inspection of dimensions/duration/size as a means of "verifying" the tier? [Coverage, Gap]

## No Plaintext Leakage (logs / metrics / errors)

- [ ] CHK006 - Is there a requirement that diagnostic/console output added for engine-path debugging logs only non-content facts (codec, byte sizes, which engine ran) and never media bytes, frames, or identifying content? [Gap, Completeness]
- [ ] CHK007 - Do the requirements ensure failure/too-large/retry paths surface reasons without exposing media plaintext or content-derived data to the server? [Edge Case, Spec §FR-006]
- [ ] CHK008 - Is it specified that no telemetry/analytics are introduced by the labeling or diagnostics work? [Consistency, Principle IX]

## Data Minimization

- [ ] CHK009 - Do the requirements make clear the change can only *reduce* (never increase) transmitted bytes for HD/SD, and that the original is sent only when reduction is impossible? [Clarity, Spec §FR-002, §FR-007]
- [ ] CHK010 - Is the "send original on failure" fallback bounded so it never silently transmits *more* than the user's Original choice would (i.e. it equals the source, never a re-expanded blob)? [Edge Case, Spec §FR-006]

## Measurability of the ZK-relevant claims

- [ ] CHK011 - Are the honesty guarantees (FR-007/FR-008/SC-004) phrased so they can be objectively verified without inspecting server state (purely from the delivered, sealed payload)? [Measurability]
- [ ] CHK012 - Is "byte-identical for Original" (SC-003) specified in a way verifiable on the recipient device, not via any server-held plaintext? [Measurability, Spec §SC-003]

## Notes

- All twelve items are expected to pass on review: this feature is confirmatory for
  Principle I — it neither adds plaintext to the wire nor a server capability;
  transcoding is pre-encryption and `MediaRef.quality` is already part of the sealed
  payload. CHK006 is the one item that drives an implementation note: keep the new
  engine diagnostics content-free.
- Check items off as completed: `[x]`.
