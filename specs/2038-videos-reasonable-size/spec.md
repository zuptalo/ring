# Feature Specification: Reasonable Videos Upload As-Is

**Feature Branch**: `fix/2038-videos-reasonable-size`

**Created**: 2026-07-15

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User direction (2026-07-15): "If a video file size to length ratio is
reasonable and doesn't really need conversion we should just simply upload it as
is; only videos captured on the phone itself in 4k quality are large enough to
require conversion to smaller and more compatible global format to make it work
across apple android and desktop."

## Requirements

- **FR-001**: Before any transcode engine loads, a video whose bitrate
  (size ÷ duration) is within 1.5× the target preset's bitrate AND whose
  resolution fits the preset MUST upload as-is — no re-encode, instant
  progression to the upload phase.
- **FR-002**: The as-is path MUST be limited to universally playable content:
  MP4/QuickTime containers carrying H.264 video. HEVC/AV1/VP9 (typical modern
  phone captures) and non-MP4 containers keep today's transcode-to-H.264 path —
  that is exactly the cross-platform conversion the user wants preserved.
- **FR-003**: 4K-class or preset-exceeding resolutions always transcode
  (downscale), whatever their bitrate.
- **FR-004**: Any probe/sniff failure falls back to today's behavior — the
  check can only ever SKIP work, never block a send.

## Why this also matters for stability

The transcode is the memory-heavy step behind the spec-2037 crash loop; not
running it at all for already-efficient clips removes the risk for the most
common share (downloaded/already-compressed videos).

## Success Criteria

- **SC-001**: Pure-rule unit tests: bitrate/resolution gate + codec sniff
  (H.264 accepts; HEVC/AV1/VP9 markers reject).
- **SC-002**: The reporter's real 17 MB clip posts with NO encode phase (drive
  validation: progress starts in the upload band immediately) when its codec is
  H.264; a synthetic HEVC-marked buffer still routes to the transcode.
