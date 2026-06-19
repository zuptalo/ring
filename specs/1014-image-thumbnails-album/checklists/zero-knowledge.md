# Zero-Knowledge Checklist: Multi-Size Image Thumbnails + Album-View Overhaul (spec 1014)

**Purpose**: Constitution gate-sequencing requirement — `/speckit-checklist` is REQUIRED for any spec
touching Principle I (Zero-Knowledge Boundary) or IV (Crypto Discipline). This is "unit tests for the
requirements": it validates that the spec's zero-knowledge / privacy requirements are complete,
clear, consistent, and measurable — NOT that the implementation works. Mirrors the precedent of specs
1009/1010/1011/1013. **This feature actually transmits new data (encrypted thumbnails), so it gets
extra scrutiny vs. 1013 (which only changed receipt timing).**
**Created**: 2026-06-19
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [data-model.md](../data-model.md) · [contracts/thumbnails-and-viewer.md](../contracts/thumbnails-and-viewer.md)

**Outcome**: PASS — the spec's Zero-Knowledge Impact section + FR-002/FR-013-equivalent + SC-009 + the
data-model/contracts specify the boundary completely. Thumbnails are encrypted client-side and ride
the existing sealed `MediaRef.poster` path; the server relays only opaque ciphertext. One advisory
(CHK010) is accepted-by-design (waived in Notes), non-blocking.

## Zero-Knowledge Boundary (Principle I)

- [x] CHK001 Does the spec state exactly what crosses the wire for thumbnails? [Completeness, Spec §Zero-Knowledge Impact; FR-002] — Yes: the bubble tier inside the existing E2EE `MediaRef.poster` data-URL (the path the video poster already uses); no new endpoint/frame.
- [x] CHK002 Is it specified that thumbnails are encrypted **client-side** with the existing media path (no new key material, no server-side plaintext)? [Clarity, Spec §Zero-Knowledge Impact; plan Constitution Check IV] — Yes.
- [x] CHK003 Is it specified that the server's role is unchanged — relay/store **opaque ciphertext** only, never the image or thumbnails? [Completeness, Spec §Zero-Knowledge Impact; SC-009] — Yes.
- [x] CHK004 Is the absence of any new server capability / endpoint / SQL / metadata documented? [Coverage, Spec §Zero-Knowledge Impact + §Out of Scope; plan Constitution Check VI] — Yes: client-only; "Server-side thumbnailing … forbidden" in Out of Scope.
- [x] CHK005 Is the derive-locally design (grid/strip downscaled on-device from the sent tier) specified so the two smaller tiers never cross the wire? [Clarity, research D1; data-model] — Yes: only the bubble tier is transmitted; grid/strip are derived locally.
- [x] CHK006 Is the **backfill** specified as a purely local operation (tiers generated on-device, nothing sent)? [Coverage, Spec FR-006b; research D6] — Yes: backfill derives from on-device media; no wire traffic.

## Metadata & Data Minimization (Principle IX)

- [x] CHK007 Does the spec acknowledge the only metadata change is a modestly larger encrypted payload (and the unavoidable approximate-size signal, as for any media)? [Completeness, Spec §Zero-Knowledge Impact] — Yes, explicitly.
- [x] CHK008 Is the per-recipient payload minimized (send one tier, not three) so groups don't multiply thumbnail bytes? [Clarity, research D1 + risks] — Yes: D1 sends only the bubble tier; grid/strip derived.
- [x] CHK009 Is all thumbnail/storage state confirmed **local-only** (Media store + storage-usage breakdown; cleanup is local)? [Completeness, Spec §Zero-Knowledge Impact; data-model] — Yes.
- [ ] CHK010 Does the spec state that thumbnails are **sender-authored content** (the recipient renders the sender's thumbnail as-is; a sender-chosen thumbnail that differs from the full image is sender content, not an integrity break)? [Assumption, Gap] — Implicit (thumbnails are sealed + authenticated like the poster/caption), but not stated. **Advisory, accepted-by-design (see Notes); non-blocking.**

## Re-download / lifecycle

- [x] CHK011 Is the "keep thumbnails → re-download original" path specified to reuse the existing sealed-ciphertext fetch (no new exposure), with a graceful fallback when the blob is gone? [Coverage, Spec §Clarifications + Edge Cases] — Yes.
- [x] CHK012 Is thumbnail purge tied to media/message deletion so no thumbnail outlives its media (incl. disappearing-message expiry)? [Coverage, Spec FR-017; Edge Cases (expiry)] — Yes: deletion removes all tiers; expiry routes through deletion.

## Offline-First / migration (Principle V)

- [x] CHK013 Is the storage change specified as additive (`posterGrid`/`posterStrip`) behind a forward, data-preserving migration (`DB_VERSION` 7→8) that exposes no plaintext? [Completeness, Spec FR-020; data-model; plan Constitution Check V] — Yes; covered by `idb.migration.test.ts`.

## Acceptance-criteria measurability

- [x] CHK014 Is "no image plaintext crosses the boundary; server relays only opaque ciphertext" stated as a measurable success criterion? [Measurability, Spec SC-009] — Yes.
- [x] CHK015 Are the privacy-positive behaviors (preview before download via the sealed tier; cleanup frees originals locally) measurable? [Measurability, Spec SC-001/SC-007] — Yes.

## Consistency & Assumptions

- [x] CHK016 Do spec, plan, data-model, and contracts agree that the wire reuses `MediaRef.poster` with no new frame/field and no server change? [Consistency, Spec §ZK Impact; plan Constitution Check I; data-model §Wire; contracts §1] — Yes.
- [x] CHK017 Is the video path consistent with the boundary (grid/strip derived from the existing poster; no new video data on the wire)? [Consistency, Spec FR-006a; research D5] — Yes.
- [x] CHK018 Is the cross-device caveat noted (the local tier blobs aren't synced; each device derives/persists its own)? [Assumption, data-model; research] — Yes (local-only; derive on receive/backfill).

## Notes

- **CHK010 waiver (accepted-by-design)**: thumbnails travel in the **authenticated** sealed envelope,
  so they are guaranteed to come from the claimed sender, unmodified in transit. A sender choosing a
  thumbnail that doesn't match their own full image is *sender-authored content* (no different from a
  misleading caption); the recipient can download the real image to view it. This is not a
  zero-knowledge or transport-integrity weakness. Optional future polish: add one sentence to the spec
  §Zero-Knowledge Impact making this explicit. **Does not block `/speckit-implement`.**
- Constitution Principle I & IX are satisfied; the zero-knowledge gate is cleared. Remaining pipeline:
  `/speckit-taskstoissues` → `/speckit-implement`.
