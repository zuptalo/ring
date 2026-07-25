# Research — Cross-browser media interop (spec 2050)

## D1. Force non-portable video containers to transcode (WebM)

**Decision**: Introduce a pure `needsMandatoryTranscode(mime, quality)` — true for any video whose container is not MP4/H.264 or MOV, **regardless of quality** (including `original`). Wire it into `compressVideoAdaptive` and `runMediaJob` so the mp4-only "as-is"/WebCodecs fast paths and the `original`-quality encode-skip cannot let a non-portable container through. The transcode target is MP4/H.264 via the existing ffmpeg path.

**Rationale**: MP4/H.264 plays natively on every target browser incl. Safari/iOS; WebM (VP8/VP9) does not. Today `original` quality and the >64 MiB cap and ffmpeg-load-failure all fall back to shipping raw WebM → unplayable. Making portability a *mandatory* condition (not a quality choice) closes all three escape hatches with one rule. Also covers app-recorded WebM video-notes.

**Failure**: when a non-portable video genuinely can't be transcoded (over the input cap, or ffmpeg unavailable), fail honestly via the existing `failReason` card (add a `'cant-convert'` reason distinct from `'too-large'`), never upload raw bytes (SC-005/FR-003).

**Alternatives**: reject WebM at paste (reintroduces the acceptance asymmetry — rejected); server transcode (breaks zero-knowledge — rejected).

## D2. HEIC/HEIF decoder (the one new dependency)

**Decision**: Add a **lazy-loaded, client-side wasm HEIC decoder**, dynamically imported only when a HEIC/HEIF blob is actually encountered, wrapped in a thin `heic-decode.ts` that returns a JPEG/PNG blob. Convert HEIC→JPEG before the normal encode path on **all** senders (not just non-Safari), so the delivered image is portable for every recipient.

**Rationale**: `createImageBitmap` throws for HEIC on non-Safari browsers, so today off-Safari senders ship raw HEIC that only Safari recipients can render. There is **no zero-dependency client-side way** to decode HEIC off-Safari. A wasm decoder (e.g. `heic2any` / libheif-wasm) runs entirely on-device (zero-knowledge intact) and, lazily imported, adds nothing to the main bundle for the common case. Converting on all senders (even Safari, which *can* decode) keeps the delivered format uniform and the code path single.

**Alternatives**: native-only decode (the current bug — rejected); server-side conversion (breaks ZK — rejected); refuse HEIC (hurts the most common iPhone photo format — rejected). Exact package + size to be pinned in implementation; must be MIT/compatible and wasm/client-side.

**Open**: confirm the chosen package's licence + gzip size in the implementing task; if unexpectedly large, gate behind the lazy import (already planned) and note it.

## D3. Preserve PNG transparency

**Decision**: Detect whether a PNG carries an alpha channel (cheap PNG IHDR colour-type byte sniff, or a canvas alpha sample) and route alpha-bearing PNGs through an alpha-preserving path (keep PNG, or re-encode to WebP which the app already preserves) instead of the JPEG flatten. Opaque PNGs keep the existing quality-tier JPEG downscaling.

**Rationale**: `compressImage` currently re-encodes PNG→JPEG, turning transparency into a black/white fill — visible corruption for logos/stickers/alpha screenshots. `media-encode.ts` already has `PRESERVED_IMAGE_MIME` (webp/gif kept as-is); extending the "preserve" decision to alpha PNGs is a small, consistent change.

**Alternatives**: always preserve PNG (loses downscaling on big opaque PNGs — rejected); always WebP (fine but changes format unnecessarily for opaque — only use for the alpha case).

## D4. SVG thumbnail

**Decision**: Rasterize a small poster/thumbnail from the SVG via an `<img>`→`<canvas>` draw at thumbnail dimensions; keep the original SVG blob for the full viewer.

**Rationale**: SVGs already display in `<img>` but produce no preview thumbnail. Rasterizing on the client is trivial and gives the bubble a preview like other images. Lowest priority (polish, not a break).

**Alternatives**: ship no thumbnail (status quo — acceptable but the spec asks for one); server rasterize (breaks ZK — rejected).

## D5. Honest-failure surface

**Decision**: Reuse the existing `Message.failReason` → failure card/toast. Add a `'cant-convert'` reason for a non-portable media that couldn't be made interoperable, distinct from `'too-large'`. No new bespoke UI (Ionic-first).

**Rationale**: FR-014/SC-005 require a *visible* failure instead of a silent broken send; the app already has the failed-send surface — extend its reason set rather than invent UI.
