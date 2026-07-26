# Feature Specification: Send webm best-effort instead of hard-failing when it can't transcode

**Feature Branch**: `fix/2052-webm-best-effort`

**Created**: 2026-07-26

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User report: "Sending a webm fails with 'video couldn't be converted to send.' Why do we need to convert a webm? Browsers support webm."

## Context: regression from spec 2050

Spec 2050 made non-portable video containers (webm) **mandatorily** transcode to MP4 and, if the transcode couldn't run, **hard-fail** the send (`failReason: 'cant-convert'`). Intent: Safari/iOS can't decode VP8/VP9 webm, so an un-transcoded webm shows a black tile there.

But that hard-fail is too aggressive. Diagnosis on a real 1920p/~25s VP8 webm: the single-threaded ffmpeg-wasm core **decodes and re-encodes the whole clip, then `Aborted()` (OOM) at the mux/finalize step** — so a legitimate, ordinary webm can't be transcoded on-device and was **blocked entirely**, even though it plays fine on Chrome/Firefox/Android. Being unable to send at all is worse than the pre-existing Safari limitation.

This hotfix makes webm **best-effort**: attempt the MP4 transcode (so Safari recipients benefit when it succeeds), but if it can't, **send the raw webm** rather than blocking. Also drops `-movflags +faststart` (its in-memory moov relocation contributed to the finalize OOM, and progressive-start buys nothing for chat videos that are fully downloaded before playback), and keeps the transcoded MP4 for a non-portable source even when it isn't smaller (portability beats size there).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A webm always sends (Priority: P1)

A user sends a webm; it goes through. If it can be transcoded to MP4 it is (best for all recipients); if it can't, the raw webm is sent (plays on Chrome/Firefox/Android) — never a "couldn't convert" block.

**Independent Test**: On macOS, send a large (1920p/~25s) VP8 webm → it delivers (as raw webm when the wasm transcode OOMs); send a small/short webm → it delivers as MP4. Neither shows the "couldn't convert" failure.

**Acceptance Scenarios**:

1. **Given** a webm the on-device transcoder can convert, **When** I send it, **Then** it is delivered as MP4 (playable on Safari/iOS too).
2. **Given** a webm the on-device transcoder can NOT convert (e.g. too heavy for wasm), **When** I send it, **Then** the raw webm is delivered (no "couldn't convert" failure).
3. **Given** an MP4/H.264 video, **When** I send it, **Then** behavior is unchanged.
4. **Given** a webm that genuinely exceeds the send size cap, **When** I send it, **Then** it fails with the existing "too large" reason (not "couldn't convert").

### Edge Cases

- **Raw webm to a Safari/iOS recipient** when the transcode couldn't run: it won't play there (pre-existing VP8/VP9 limitation) — accepted, since blocking the send is worse and most recipients can play it. Smaller webms still transcode to MP4 and play everywhere.
- **HEIC images** keep failing honestly if they can't be decoded (raw HEIC is unviewable on most browsers, unlike webm) — unchanged from 2050.

## Requirements *(mandatory)*

- **FR-001**: A non-portable video container (webm, etc.) MUST be sent best-effort: transcode to MP4 when possible, otherwise send the raw file. It MUST NOT hard-fail the send solely because the transcode couldn't run.
- **FR-002**: When the transcode succeeds for a non-portable source, the MP4 MUST be used even if it is not smaller than the source (portability over size).
- **FR-003**: `-movflags +faststart` MUST NOT be used (avoids the finalize OOM; unnecessary for fully-downloaded chat playback).
- **FR-004**: A genuinely too-large original MUST still fail with the existing "too large" reason (memory-safety / server cap), not "couldn't convert".
- **FR-005**: HEIC image conversion behavior is unchanged (still fails honestly if undecodable). MP4 video behavior is unchanged.

## Zero-Knowledge Impact *(mandatory)*

None new. All transcoding remains client-side before encryption; the server still stores opaque blobs. This change only affects the client-side fallback decision (send raw vs. block).

## Success Criteria *(mandatory)*

- **SC-001**: A 1920p/~25s VP8 webm that OOMs the wasm transcoder is delivered (as raw webm), not blocked — verified end-to-end.
- **SC-002**: A webm small enough to transcode is delivered as MP4.
- **SC-003**: No "couldn't convert" failure occurs for any webm within the send size cap.
- **SC-004**: MP4 and HEIC behavior show no regression.

## Assumptions

- The single-threaded ffmpeg-wasm core has a hard memory ceiling that some ordinary large webms exceed; a multi-threaded core (needs COOP/COEP) is deliberately not used, so best-effort + raw fallback is the pragmatic behavior.
- webm plays natively on Chrome/Firefox/Android; only Safari/iOS lacks VP8/VP9 — so raw webm is a reasonable fallback for the majority.
