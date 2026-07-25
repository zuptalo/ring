# Feature Specification: Make pasted and sent media interoperable across browsers

**Feature Branch**: `fix/2050-media-interop`

**Created**: 2026-07-24

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User report: "I have experienced not successful sharing of webm — check that, and gif, webp, png, jpeg and other media formats as well. What formats can be pasted into the chat and are we fully handling sending them?"

## Context: why this hotfix exists

The chat composer accepts **every** media format via both paste and the file picker (there is no acceptance filter), but some formats are not made *interoperable* before sending, so they arrive as unplayable/blank tiles on other browsers — with **no error shown**, because the server stores opaque ciphertext and cannot validate media. An audit found:

- **WebM (the reported bug)**: video interoperability depends entirely on the ffmpeg transcode to MP4. The "send as-is" and WebCodecs fast paths are hard-gated to MP4/MOV, so WebM can only reach ffmpeg — and ffmpeg is bypassed when the video quality is "Original", when the clip exceeds the ffmpeg input-size cap, or when ffmpeg fails to load. In those cases the **raw WebM is uploaded** and handed to a bare `<video>` element that **Safari/iOS cannot decode** (VP8/VP9). The sender on Safari also gets no poster/dimensions. Result: a black/broken tile, no error. Ring also records WebM itself (video-notes on Chrome/Android), so this affects recorded clips too, not only pasted ones.
- **HEIC/HEIF**: on senders whose browser can't natively decode HEIC (non-Safari), the image encode step falls back to uploading the **raw HEIC**, which only Safari recipients can render — a silent break elsewhere.
- **PNG with transparency**: the image compressor re-encodes to JPEG, **flattening the alpha channel** (transparent areas become black/white).
- **SVG**: sends and renders in an `<img>`, but produces **no thumbnail/poster**.

Working today (no change needed): JPEG, WebP (animation + alpha preserved), GIF (animation preserved), MP4 (H.264), audio, and generic files.

The unifying principle of this fix: **anything the composer accepts must either send in an interoperable form, or fail honestly with a visible message — never a silent unplayable send.**

## User Scenarios & Testing *(mandatory)*

### User Story 1 - WebM (and non-portable video) sends playably everywhere (Priority: P1)

A user pastes or picks a WebM clip (or records a video-note on Chrome/Android) and sends it. The recipient — on any browser, including Safari/iOS — sees a playable video with a poster, or, if the clip genuinely cannot be converted, the sender sees a clear "couldn't send this video" message instead of a silently-broken tile.

**Why this priority**: This is the reported defect and the most common interop break (WebM is what browser recorders and many web sources produce). It affects Safari/iOS recipients of every WebM, silently.

**Independent Test**: From a non-Safari sender, send a WebM clip at Original quality and confirm the recipient on Safari/iOS plays it with a poster; force a case that can't transcode and confirm a visible error rather than a broken tile.

**Acceptance Scenarios**:

1. **Given** a WebM clip pasted into the composer, **When** I send it (at any quality, including Original), **Then** it is delivered as a browser-portable video (MP4/H.264) that plays on Safari/iOS recipients, with a poster.
2. **Given** a WebM I record as a video-note on Chrome/Android, **When** I send it, **Then** the recipient on Safari/iOS can play it.
3. **Given** a video whose container is not natively portable and that cannot be transcoded (e.g. exceeds limits or the transcoder is unavailable), **When** I try to send it, **Then** I see a clear, honest error and no unplayable tile is delivered.
4. **Given** an MP4/H.264 clip, **When** I send it, **Then** behavior is unchanged (still plays everywhere, still tiered by quality).

---

### User Story 2 - HEIC/HEIF photos send viewably from any browser (Priority: P2)

A user pastes or picks an iPhone HEIC photo from a non-Safari browser and sends it; the recipient sees the photo regardless of their browser.

**Why this priority**: HEIC is extremely common (default iPhone photo format) and currently breaks silently for any sender not on Safari. Second only to WebM in real-world impact.

**Independent Test**: From a non-Safari sender, send a HEIC image and confirm the recipient on a non-Safari browser sees the photo (not a broken image).

**Acceptance Scenarios**:

1. **Given** a HEIC/HEIF image and a sender whose browser cannot natively decode it, **When** I send it, **Then** it is converted to a browser-portable image (e.g. JPEG) before upload and renders for all recipients.
2. **Given** a HEIC image and a sender whose browser *can* decode it natively, **When** I send it, **Then** it is converted the same way (a portable image is delivered), with no regression to quality tiers.
3. **Given** a HEIC that cannot be decoded at all, **When** I try to send it, **Then** I see an honest error rather than a silently broken image.

---

### User Story 3 - PNG transparency is preserved (Priority: P3)

A user pastes or picks a PNG with transparency (logo, sticker, screenshot with alpha) and sends it; the transparent areas stay transparent.

**Why this priority**: A correctness bug (visible corruption — transparent turns to a solid fill), but lower frequency and less severe than an entirely-broken send.

**Independent Test**: Send a PNG with an alpha channel and confirm the received image retains transparency rather than a black/white fill.

**Acceptance Scenarios**:

1. **Given** a PNG image with an alpha channel, **When** I send it, **Then** the delivered image preserves transparency (it is not flattened to an opaque JPEG).
2. **Given** a fully-opaque PNG or a JPEG, **When** I send it, **Then** behavior is unchanged (still downscaled by quality tier).

---

### User Story 4 - SVG images get a thumbnail (Priority: P4)

A user pastes or picks an SVG and sends it; it shows a proper preview thumbnail in the chat like other images.

**Why this priority**: A polish gap, not a break — SVGs already display in the viewer; they just lack a preview. Lowest priority.

**Independent Test**: Send an SVG and confirm the chat bubble shows a rasterized thumbnail preview.

**Acceptance Scenarios**:

1. **Given** an SVG image, **When** I send it, **Then** a rasterized thumbnail/poster is generated and shown, and the full SVG still opens in the viewer.

---

### Edge Cases

- **Quality = Original for a non-portable container**: interop MUST win — the media is still converted to a portable form (Original must not be an escape hatch that ships unplayable bytes). "Original" continues to mean full-fidelity for already-portable formats (MP4, JPEG, etc.).
- **Oversized non-portable video** (beyond the transcoder's input cap): fail honestly with a visible message; do not upload raw unplayable bytes.
- **Transcoder/decoder unavailable** (ffmpeg core or HEIC decoder fails to load): fail honestly with a visible message; do not silently ship raw bytes.
- **Animated formats** (GIF, animated WebP): unchanged — MUST keep animation; MUST NOT be routed through a flattening path.
- **A format that is already portable** (JPEG, PNG-opaque, WebP, GIF, MP4/H.264, audio, generic files): unchanged behavior.
- **Very large images**: existing size/quality handling applies after format conversion.
- **Sender and recipient on the same capable browser**: still must not regress (conversion is about the *worst-case* recipient, so convert regardless of the sender's own capabilities).

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire**: unchanged in nature — sealed, client-encrypted media blobs plus their existing capability-style ids. This fix changes the *bytes* (a transcoded MP4 instead of a raw WebM, a JPEG instead of a raw HEIC) but not what the server sees: still opaque ciphertext stored as `application/octet-stream`.
- **Where processing happens**: entirely **client-side**, before encryption — transcode/decode/rasterize all run in the browser (ffmpeg-wasm / WebCodecs / canvas / an HEIC decoder). No media is ever sent to the server for processing.
- **Unavoidably-visible metadata**: unchanged — the server already sees blob sizes and relay timing; conversion may change a blob's size but adds no new metadata, endpoint, log, or field.
- **Why it stays zero-knowledge**: the server neither inspects nor validates media (it cannot — it only holds ciphertext). All format decisions and conversions are made on the client from the plaintext it already holds. No new server capability is added.

## Requirements *(mandatory)*

### Functional Requirements

**Video interop — WebM (Story 1)**

- **FR-001**: Any video whose container is not natively portable across target browsers (i.e. not MP4/H.264 or MOV) MUST be transcoded to a portable form (MP4/H.264) before upload, **regardless of the selected quality** (including "Original").
- **FR-002**: The "send as-is" and accelerated (WebCodecs) fast paths MUST NOT allow a non-portable container to bypass conversion; a non-portable container MUST always be routed to a working transcode path.
- **FR-003**: When a non-portable video cannot be transcoded (size/limits/transcoder-unavailable), the app MUST surface a clear, honest failure to the sender and MUST NOT upload the raw unplayable bytes.
- **FR-004**: This applies to app-produced WebM as well (e.g. video-notes recorded on Chrome/Android), so recorded clips are also delivered playably to Safari/iOS recipients.
- **FR-005**: Already-portable video (MP4/H.264) MUST keep its current behavior, including quality tiers and poster generation.

**Image interop — HEIC (Story 2)**

- **FR-006**: A HEIC/HEIF image MUST be converted to a browser-portable image (e.g. JPEG) before upload, whether or not the sender's browser can natively decode HEIC, so all recipients can view it.
- **FR-007**: When a HEIC image cannot be decoded at all, the app MUST surface an honest failure and MUST NOT upload raw HEIC bytes that only some recipients could render.

**Image correctness — PNG alpha (Story 3)**

- **FR-008**: A PNG (or other image) that has an alpha channel MUST be delivered in a format that preserves transparency; it MUST NOT be flattened to an opaque JPEG.
- **FR-009**: Opaque images MUST retain current quality-tier downscaling behavior.

**Image polish — SVG thumbnail (Story 4)**

- **FR-010**: An SVG image SHOULD have a rasterized thumbnail/poster generated for its chat preview, while the original SVG remains openable in the viewer.

**Cross-cutting**

- **FR-011**: Paste and the file picker MUST remain equally permissive (no acceptance-filter divergence); the fix is in conversion/handling, not in restricting what can be attached.
- **FR-012**: Animated formats (GIF, animated WebP) MUST retain animation and MUST NOT be routed through a flattening/transcode path that drops frames.
- **FR-013**: No media is sent to the server for processing; all conversion happens client-side before encryption (zero-knowledge preserved).
- **FR-014**: Every accepted format MUST either send in an interoperable form or fail with a visible message — there MUST be no silent unplayable/blank send for any format the composer accepts.

### Key Entities *(include if feature involves data)*

- **Outgoing media item**: an attached blob with a MIME type and a chosen quality. This fix adds a *portability decision* (is the container/format natively viewable on target browsers?) that gates whether conversion is mandatory, independent of quality. No new stored or synced entity; the decision is computed client-side at send time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A WebM sent from a non-Safari browser (at any quality, including Original) plays with a poster on a Safari/iOS recipient in 100% of send attempts that complete, or fails with a visible error — never a silent broken tile.
- **SC-002**: A HEIC photo sent from a non-Safari browser renders for a non-Safari recipient in 100% of completed sends, or fails visibly.
- **SC-003**: A PNG with transparency, once received, retains its transparent regions (no black/white fill) in 100% of cases.
- **SC-004**: An SVG send shows a thumbnail preview in the bubble and still opens full in the viewer.
- **SC-005**: No format the composer accepts results in a silent unplayable or blank send; any un-sendable media produces a visible, honest error.
- **SC-006**: Formats that work today (JPEG, WebP, GIF, MP4/H.264, audio, generic files) show no regression in delivery, animation, or quality tiers.
- **SC-007**: No media is transmitted to the server for processing and no new server-visible metadata is introduced (verified: conversion is client-side, server still stores opaque blobs).

## Assumptions

- A client-side transcode path (ffmpeg-wasm, already in the app) can convert WebM→MP4; the fix routes non-portable containers to it unconditionally and treats "can't transcode" as an honest failure, not a raw-bytes fallback.
- A client-side HEIC decode capability is available or can be added (browser-native where supported, a wasm decoder otherwise); conversion targets JPEG for broad compatibility.
- "Portable" targets the browsers Ring supports (notably Safari/iOS for video/HEIC); MP4/H.264 and JPEG/PNG/WebP/GIF are treated as portable.
- Preserving PNG transparency implies delivering PNG (or another alpha-capable format) rather than JPEG when alpha is present; exact target format is an implementation choice constrained by "keeps transparency + reasonable size".
- Existing size caps and quality tiers remain; this fix changes *format portability*, not the size/quality policy, except that Original may no longer bypass a mandatory format conversion.

## Out of Scope

- Restricting or filtering which formats can be attached (paste/picker stay permissive).
- Server-side media validation or transcoding (would break zero-knowledge).
- New editing/cropping features; changes to the media viewer beyond adding an SVG thumbnail.
- Re-encoding already-portable formats differently (no change to JPEG/WebP/GIF/MP4 handling beyond the alpha-preservation and thumbnail cases above).
- Audio format interop beyond current behavior (audio already uploads; playback remains recipient-codec dependent) — noted, not addressed here.
