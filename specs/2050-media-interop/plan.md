# Implementation Plan: Make pasted and sent media interoperable across browsers

**Branch**: `fix/2050-media-interop` | **Date**: 2026-07-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/2050-media-interop/spec.md`

## Summary

Everything the composer accepts must arrive viewable on any browser — or fail with a visible message, never a silent broken tile. The composer already accepts every format; the gaps are all in the **client-side encode/convert step** before encryption. Fixes, by priority: (P1) force any non-portable video container (WebM, etc.) to transcode to MP4 regardless of quality, and fail honestly if it can't; (P2) decode HEIC→JPEG when the browser can't natively; (P3) preserve PNG transparency instead of flattening to JPEG; (P4) rasterize an SVG thumbnail. No server change, no new wire contract — the server keeps storing opaque ciphertext.

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 + Ionic PWA), client only. No Go changes.

**Primary Dependencies**: existing `@ffmpeg/ffmpeg` (wasm, already used for the video fallback), WebCodecs/mp4box (MP4 fast path), canvas; **one new lazy-loaded wasm HEIC decoder** (see research D2). Encode entry points: `src/services/media-video.ts` (`compressVideoAdaptive`), `src/services/media-video-ffmpeg.ts` (`ffmpegTranscode`), `src/services/media-encode.ts` (`compressImage`, `PRESERVED_IMAGE_MIME`), `src/db/queries.ts` (`runMediaJob`), `src/utils/media-meta.ts` (poster/meta).

**Storage**: none new. Media blobs are opaque ciphertext server-side (`media-transfer.ts` keeps `blob.type`); no IndexedDB store/index added → no `DB_VERSION` bump.

**Testing**: vitest for the new pure `media-portability` decisions (regression-first, Constitution III for 2001+); `drive/` scenarios for visual confirmation of each format; targeted e2e where a send flow changes.

**Target Platform**: installable PWA; the interop target is notably **Safari/iOS** (can't decode VP8/VP9 WebM or raw HEIC) as the worst-case recipient.

**Project Type**: web app, single client project.

**Performance Goals**: transcode/decode run in wasm off the main thread as today; the HEIC decoder is dynamically imported only when a HEIC is actually encountered (no main-bundle bloat).

**Constraints**: client-only; no server validation/transcoding (would break zero-knowledge); paste + picker stay permissive; animated formats (GIF, animated WebP) keep animation; **every accepted format either sends interoperably or fails with a visible message** (no silent broken send).

**Scale/Scope**: four format fixes; bug-fix hotfix (2050).

## Constitution Check

- **I — Zero-Knowledge (NON-NEGOTIABLE)**: PASS. All conversion is client-side, before encryption; the server still stores opaque `application/octet-stream` blobs and gains no endpoint, validation, or metadata. The new HEIC decoder is a local wasm module (no network). Spec carries a Zero-Knowledge Impact section. **`/speckit-checklist` REQUIRED** before implement (tracked).
- **II — Spec-Driven**: PASS — specify → plan (this) → tasks → analyze → checklist → implement.
- **III — TDD (bug fix)**: PASS (planned). Begins with a **failing regression test** on the pure portability decision (`needsMandatoryTranscode('video/webm', 'original')` → true; MP4 → false), before touching the routing. Each format fix adds pure-helper tests + a drive/e2e check.
- **V — Offline-First**: PASS. No store/schema change.
- **VII — Quality Gates**: PASS (planned). `npm run build` + vitest + drive/e2e; commit subjects as plain-language release notes.
- **IX — Privacy/Minimization**: PASS. Less broken data leaves the device, nothing new collected.
- **X/XI — a11y / Ionic-first**: PASS. The "couldn't send" state reuses the existing `failReason` message/card (no bespoke widget); no new iconography.

**Complexity Tracking**: one justified new dependency (HEIC decoder) — see below.

## Project Structure

### Documentation (this feature)

```text
specs/2050-media-interop/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/README.md
├── checklists/requirements.md (done) + zero-knowledge.md (at /speckit-checklist)
└── tasks.md (Phase 2 — /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── media-portability.ts   # NEW pure: isPortableVideo / needsMandatoryTranscode /
│   │                          #   isHeic / imageNeedsAlphaPreserve — the tested decisions
│   ├── media-video.ts         # route non-portable containers to a MANDATORY transcode
│   │                          #   (bypass the mp4-only as-is/WebCodecs gates), honest fail
│   ├── media-video-ffmpeg.ts  # transcode entry; keep the honest too-large/unavailable throw
│   ├── media-encode.ts        # HEIC→JPEG decode (lazy wasm); preserve PNG alpha
│   ├── heic-decode.ts         # NEW thin lazy wrapper around the wasm HEIC decoder
│   └── ...
├── db/queries.ts              # runMediaJob: don't skip encode for non-portable video even
│                              #   at quality 'original'; surface honest failure card
├── utils/media-meta.ts        # SVG thumbnail/poster; webm poster moot post-transcode
└── views/detail/ChatDetailPage.vue  # (only if the failure surface needs a message tweak)
```

**Structure Decision**: single client project. The load-bearing new piece is a small pure `media-portability.ts` (the decisions, unit-tested) plus a lazy `heic-decode.ts` wrapper; everything else edits existing encode entry points.

## Phase 0 — Research

See [research.md](./research.md). Decisions:
1. **Mandatory-transcode rule** — a pure `needsMandatoryTranscode(mime, quality)` returning true for any non-MP4/MOV video container regardless of quality; wire it so `compressVideoAdaptive`/`runMediaJob` cannot skip it. Failure is honest (existing `failReason` card / a new `'cant-convert'` reason), never raw bytes.
2. **HEIC decoder choice** — lazy-loaded wasm (`heic2any`/libheif-wasm), dynamically imported only on encountering HEIC; client-side, no network (ZK-safe). Evaluated vs. relying on native decode (fails off-Safari) — rejected.
3. **PNG alpha** — detect alpha (PNG IHDR colour-type sniff, cheap) and route alpha PNGs through the preserved/alpha-capable path instead of the JPEG flatten; opaque PNG keeps downscaling.
4. **SVG thumbnail** — rasterize via `<img>`→canvas at thumbnail size for the poster; keep original SVG for the viewer.
5. **Honest failure** — reuse the `failReason` surface; keep the ffmpeg input cap but on exceed/unavailable, fail visibly rather than shipping raw.

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — the portability decision inputs/outputs; no persisted entity.
- [contracts/README.md](./contracts/README.md) — internal contracts (`media-portability` helpers, `heic-decode`), and the unchanged media blob wire (opaque, `blob.type` preserved).
- [quickstart.md](./quickstart.md) — build/test + per-format drive/e2e verification (incl. the Safari-recipient check).

### Zero-Knowledge Impact
Bytes change (MP4 instead of WebM, JPEG instead of HEIC) but not what the server sees — still opaque ciphertext, no endpoint/validation/metadata added. All conversion is on the client before encryption; the HEIC decoder is local wasm. Nothing new persisted or synced.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|-----------|-----------|--------------------------------------|
| New dependency: wasm HEIC decoder | HEIC/HEIF can't be decoded off-Safari without one; leaving it out is the current silent-break bug | Native `createImageBitmap` fails for HEIC on non-Safari browsers — there is no zero-dependency client-side path. Mitigated: lazy dynamic import (no main-bundle cost), client-side only (ZK-safe). |
