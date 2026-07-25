# Checklist: Zero-Knowledge & Privacy (spec 2050)

**Purpose**: Validate the zero-knowledge/privacy requirements (Constitution Principle I) are met by the media-interop fixes. Tests the design, not pixels.
**Created**: 2026-07-25
**Feature**: [spec.md](../spec.md)

## Boundary — what crosses the wire

- [x] CHK001 No new server API, endpoint, or request is added — media stays sealed client-encrypted ciphertext. [Spec §ZK-Impact, §FR-013]
- [x] CHK002 The server continues to store media as opaque `application/octet-stream`; no media-aware server logic is introduced. [Spec §ZK-Impact]
- [x] CHK003 Conversion changes the BYTES (MP4/JPEG/alpha-PNG) but adds no new server-visible metadata (size aside, which the server already sees). [Spec §SC-007]

## Where processing happens

- [x] CHK004 All conversion (ffmpeg-wasm transcode, HEIC-wasm decode, canvas re-encode, SVG rasterize) runs on the CLIENT, before encryption. [Spec §ZK-Impact, §FR-013]
- [x] CHK005 The new HEIC decoder is a local wasm module loaded from the app bundle — no network fetch of media or of a remote decode service. [research D2]
- [x] CHK006 No media is uploaded to the server for processing under any path (incl. failure). [Spec §FR-013]

## Honest failure (no silent leak of broken data)

- [x] CHK007 A non-portable media that can't be converted fails visibly (`failReason: 'cant-convert'`) and is NOT uploaded raw. [Spec §FR-003, §FR-007, §FR-014, §SC-005]
- [x] CHK008 No accepted format results in a silent unplayable/unviewable send. [Spec §FR-014]

## No persistence / minimization

- [x] CHK009 Nothing new is persisted to IndexedDB or synced; the portability decision is derived per-send and discarded. [data-model]
- [x] CHK010 Paste and picker stay equally permissive — the fix is conversion, not new data collection or new gating. [Spec §FR-011]

## Notes
- Principle I checklist for spec 2050. All items are satisfied by the design (client-side conversion, opaque server blobs, honest failure). The one new dependency (wasm HEIC decoder) is client-side and lazy — no ZK impact.
