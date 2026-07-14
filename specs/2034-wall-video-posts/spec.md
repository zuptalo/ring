# Feature Specification: Wall Video Posts — Honest Progress, Real Avatar, Media That Fits

**Feature Branch**: `fix/2034-wall-video-posts`

**Created**: 2026-07-14

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User bug report (2026-07-14, with iPhone screenshots): "uploading videos as post on the wall stay on 2% for most of the duration, then jumps to 63% and immediately after that finishes, the avatar while posting shows Y instead of my avatar! Also on my iphone the video is not shown fully so I don't see the controllers but looks fine on the desktop!" Followed up mid-fix with: "we should cover all aspect ratios for media on the wall, they should all fit in as best as they can regardless if they are images or videos."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Posting a video shows honest, forward-moving progress (Priority: P1)

Kamran shares a video to his Wall. The pending card's progress bar should move steadily through the work actually happening (compressing, then uploading) and never sit frozen near 0% for most of a minute before leaping to the end.

**Why this priority**: A stuck-at-2% bar reads as a hung upload; users may kill the app or retry, duplicating work. Root cause: when the fast hardware transcode (WebCodecs) completed but couldn't shrink an already-efficient clip, the pipeline silently fell into the ffmpeg.wasm leg — a ~30 MB engine download with no progress events plus a slow single-threaded second transcode that almost never shrinks such a clip either, while the bar sat at the bottom of the same 0–50% encode band.

**Independent Test**: Post an already-well-compressed H.264 clip (a downloaded meme video). The post completes without the multi-ten-second frozen-bar phase, and the bar never moves backwards.

**Acceptance Scenarios**:

1. **Given** a video whose hardware re-encode completes but is not smaller than the source, **When** it is posted, **Then** the original is uploaded directly (labeled honestly per spec 2007) with no second transcode attempt.
2. **Given** any engine fallback or phase transition during a post, **Then** the visible progress value never decreases.

---

### User Story 2 - The pending card is unmistakably mine (Priority: P2)

While a post uploads, the pending "Posting…" card shows the user's real profile picture — the same avatar the published post will show — not a generic "Y" initial disc.

**Acceptance Scenarios**:

1. **Given** a profile with an avatar set, **When** a post is uploading, **Then** the pending card shows that avatar; the "Y" initials disc appears only when no avatar exists.

---

### User Story 3 - Every aspect ratio fits the feed, images and videos alike (Priority: P1)

Wall media of ANY aspect ratio shows WHOLE in the feed. Tall (portrait) photos and videos are letterboxed into a bounded frame — like the album slides already are — instead of growing a box taller than the phone's viewport. For videos this guarantees the inline player's control bar is always visible; on the reporter's iPhone a 9:16 video overflowed its clamped box and the controls were unreachable (desktop, with more viewport height, never hit the clamp).

**Independent Test**: Post a 9:16 portrait video, a 9:16 portrait photo, a square photo, and a wide landscape photo. Each shows fully in the feed on a phone-sized viewport; the video's play/scrub/fullscreen bar is visible without scrolling tricks.

**Acceptance Scenarios**:

1. **Given** a portrait video taller than 5:4, **When** it renders in the feed, **Then** its box is capped at 4:5, the clip letterboxes whole inside it over a blurred fill (album-slide style), and the player controls are fully visible.
2. **Given** a portrait photo taller than 5:4, **Then** the same capped, letterboxed-whole presentation applies.
3. **Given** square or landscape media, **Then** it keeps its true aspect ratio (it already fits at any width) — no regression.
4. **Given** an album post, **Then** nothing changes (albums already use the 4:5 contained frame).

---

### Edge Cases

- Media records without stored dimensions keep today's 4:3 fallback box.
- A video with no poster yet still renders (no blurred fill, black background).
- The progress high-water mark applies per item, so multi-item posts still advance item-by-item.
- The WebCodecs → ffmpeg fallback is preserved for genuine WebCodecs FAILURES (unsupported codec, decode error) — only the completed-but-not-smaller outcome short-circuits to the original.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A completed hardware (WebCodecs) transcode whose output is not smaller than the source MUST result in the original being uploaded, with no ffmpeg attempt; ffmpeg remains the fallback for WebCodecs failures only.
- **FR-002**: Pending-post progress MUST be monotonic per item (never displayed decreasing).
- **FR-003**: The pending "Posting…" card MUST show the user's profile avatar when one exists, with initials only as the no-avatar fallback.
- **FR-004**: Single-media feed boxes MUST be capped at a 4:5 aspect ratio for taller media; capped media MUST render whole (contain) over a blurred self-fill, matching the album-slide presentation; square/landscape media keep their true ratio.
- **FR-005**: The inline video player's control bar MUST be fully visible within the feed box for every aspect ratio on phone-sized viewports.

## Zero-Knowledge Impact

- **What crosses the wire**: unchanged — same encrypted media upload; skipping a local transcode changes only WHICH locally-produced bytes are encrypted and uploaded (the original instead of a failed-to-shrink re-encode), a path that already existed.
- **Visible metadata**: unchanged.
- **Why**: pure client pipeline/UI change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Posting an already-compressed clip shows no frozen-progress phase longer than a few seconds (the reporter's repro: ~1 minute at 2%).
- **SC-002**: The reporter confirms on-device: real avatar on the pending card, video controls visible on a 9:16 post, portrait photos shown whole.
- **SC-003**: Client typecheck and the existing wall e2e suites stay green.

## Assumptions

- 4:5 (the existing album frame ratio) is the right portrait cap for single media — it matches the already-shipped album behavior and mainstream feed conventions.
- The "2% stall" diagnosis (ffmpeg leg after a completed-but-not-smaller WebCodecs pass) is from code-path analysis of the reported symptoms (2% ≈ restart of the encode band; 63% ≈ first upload progress event after the 50% band boundary); the reporter's on-device pass is the final confirmation (SC-002).
