# Feature Specification: Video Posts Must Not Exhaust iPhone Memory

**Feature Branch**: `fix/2041-video-post-memory`

**Created**: 2026-07-15

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User report (2026-07-15, after specs 2036–2039 shipped to the dev
stack): "the app still crashes when posting a video on the wall on my iphone."
The 2037/2039 guards now stop the *loop* (3 attempts → failed card, safe mode),
but the crash itself remains: iOS kills the page on memory pressure (jetsam)
during the video pipeline.

## Diagnosis — where the memory goes

For one N-byte video post today, the JS heap simultaneously holds up to:

1. `enqueuePendingPost` inlines the whole file as an ArrayBuffer (N) plus the
   IDB structured-clone copy in flight (transiently ~2N at Share).
2. Every drain reads the record back (N) and rebuilds an in-memory Blob; the
   record (and its bytes) stays referenced for the entire createPost await.
3. `webcodecsTranscode` reads the blob into ONE whole-file ArrayBuffer for
   mp4box (N) and then copies EVERY compressed sample into
   `EncodedVideoChunk`s before decoding starts (≈N again).
4. Decoded 4K frame queues (bounded at 8 since spec 2038, ~100–200 MB) plus
   the in-memory muxer output.

A 1-minute iPhone 4K clip (~400 MB) peaks well past 1 GB — beyond what iOS
grants a standalone PWA. The ffmpeg.wasm fallback is worse (whole file into
the wasm heap plus a 30 MB runtime).

## Requirements

- **FR-001**: Outbox items above a size threshold MUST be stored as Blobs
  (disk-backed by the browser) instead of inline ArrayBuffers. Small items
  keep the proven inline-bytes path (spec 1024's iOS restart lesson).
- **FR-002**: Recovery MUST probe Blob-backed items for readability after a
  restart; unreadable ones fall back to the existing draft-ify path instead of
  wedging or crashing the drain.
- **FR-003**: The drain MUST NOT retain the outbox record's bytes across the
  createPost await (release before the heavy pipeline runs).
- **FR-004**: The WebCodecs transcode MUST demux incrementally: feed mp4box a
  bounded window of the source at a time, decode with the existing
  backpressure as samples arrive, and release consumed samples/buffers, so
  peak input-side memory is O(window + queues), not O(file).
- **FR-005**: Container layouts with trailing metadata (iPhone camera files:
  `mdat` before `moov`) MUST be handled without buffering the media data —
  follow mp4box's next-parse-position steering to locate `moov` first.
- **FR-006**: The ffmpeg.wasm leg MUST refuse inputs above a size bound with a
  clean error (degrading to the existing original/failed-card paths) instead
  of attempting a transcode that exhausts memory.
- **FR-007**: Pipeline behavior is otherwise unchanged: same presets, same
  as-is gate (spec 2038), same rotation baking, same output-playability gate,
  same progress reporting and attempt budget.

## Zero-Knowledge Impact

None — all changes are client-side memory management; the wire format and
server remain untouched.

## Success Criteria

- **SC-001**: Unit tests pin the outbox threshold rules (large → Blob-backed,
  small → inline bytes) and the recovery readability probe.
- **SC-002**: Unit tests exercise the streaming demuxer against a real mp4
  fixture (both moov-first and moov-last layouts) and assert sample counts,
  order, and that consumed buffers are released.
- **SC-003**: A drive scenario posts a real video and asserts the page's peak
  JS heap growth during the post stays far below the whole-file multiples of
  the old pipeline.
- **SC-004**: The reporter's iPhone posts a camera video without the app
  being killed.
