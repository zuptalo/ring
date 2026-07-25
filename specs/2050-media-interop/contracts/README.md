# Contracts — Cross-browser media interop (spec 2050)

**No server API and no new wire contract.** Media stays sealed client-encrypted ciphertext,
stored server-side as opaque `application/octet-stream`; `media-transfer.ts` preserves
`blob.type` end-to-end for the recipient's player. The server never inspects, validates, or
transcodes media (it can't — zero-knowledge). The contracts below are the internal client
interfaces the fixes share.

## Unchanged
- Media upload/download blob endpoints — used exactly as today; opaque bytes.
- Composer acceptance — paste (`onComposerPaste`) and the file picker stay permissive
  (no `accept=` narrowing); the fix is in conversion, not acceptance (FR-011).

## New internal contracts

### `media-portability.ts` (pure, unit-tested)
- `isPortableVideo(mime): boolean` — mp4/quicktime/m4v.
- `needsMandatoryTranscode(mime, quality): boolean` — true for any non-portable video
  container, **independent of quality** (the regression-test target; `('video/webm','original')`→true, `('video/mp4','original')`→false).
- `isHeic(mime): boolean` — image/heic|heif.
- `imageNeedsAlphaPreserve(mime, hasAlpha): boolean` — PNG (or other) with transparency.

### `heic-decode.ts` (lazy)
- `decodeHeicToJpeg(blob): Promise<Blob>` — dynamically imports the wasm decoder on first
  use; returns a portable JPEG (or throws → honest `'cant-convert'` failure). Client-side
  only; no network.

### Encode-path integration (existing files)
- `compressVideoAdaptive` / `runMediaJob` — consult `needsMandatoryTranscode`; a
  non-portable container is always routed to the ffmpeg transcode (never the mp4-only
  fast paths, never skipped at `original`), else fails honestly.
- `media-encode.ts` `compressImage` — HEIC → `decodeHeicToJpeg` first; alpha PNG →
  preserve (like `PRESERVED_IMAGE_MIME`) instead of JPEG flatten.
- `media-meta.ts` — SVG → rasterized thumbnail/poster.

### Failure surface
- `Message.failReason` gains `'cant-convert'`; rendered by the existing failed-send card
  (Ionic-first, no new widget).

## Consumption map

| Flow | Uses |
|---|---|
| Send video (paste/pick/video-note) | `needsMandatoryTranscode` → ffmpeg transcode or honest fail |
| Send image | `isHeic` → `decodeHeicToJpeg`; `imageNeedsAlphaPreserve` → keep alpha |
| Send SVG | `media-meta` rasterized thumbnail |
| Any un-convertible media | `failReason: 'cant-convert'` → failed-send card |
