# Feature Specification: Media Thumbnails Stay Thumbnails (no autoplay storm)

**Feature Branch**: `fix/2002-media-thumbnails-stay`

**Created**: 2026-06-16

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "when viewing an album or all the media in the chat (Media, links & docs), the thumbnails for videos do not remain as thumbnails — no matter where they are (the slider bottom thumbnails or the Media tab), they all start playing at the same time, which puts a lot of pressure on the device, makes the UI laggy, and sometimes crashes/freezes the app on a white or black view, forcing a full restart (sometimes several times)."

## Overview

A chat with several videos makes media browsing janky and, with enough videos,
freezes or crashes the app. Video **thumbnails** are meant to be still poster
images, but when a chat opens (or its media is browsed), the app generates a
poster for every video that doesn't already have a cached one — and each poster
is produced by spinning up a real, decoding `<video>` element that begins
playback to grab a frame. With many videos these run **all at once, unbounded**,
saturating the device's video decoders and memory: the UI lags, and on
constrained devices the app freezes on a blank (white/black) view and must be
force-closed and reopened, sometimes repeatedly.

The fix: video thumbnails must be produced **cheaply and one-at-a-time (bounded),
cached so they're generated once**, and the app must never run a herd of
simultaneously-playing video decoders for thumbnailing. Thumbnails stay still
images; actual playback happens only when the user opens a video in the viewer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browsing a chat with many videos never lags or crashes (Priority: P1)

A user opens a chat (or its "Media, links & docs" grid, or an album) that
contains many videos. The screen stays responsive and the app never freezes or
crashes; videos do not all start decoding/playing at once.

**Why this priority**: This is the reported crash/freeze — the most severe issue,
data-loss-adjacent (forces repeated force-quits) and blocks media browsing.

**Independent Test**: With a chat containing many (e.g. 10+) videos lacking
cached posters, open it and browse the media grid/album; the app stays responsive,
no crash/freeze, and at most a small bounded number of poster generations run
concurrently.

**Acceptance Scenarios**:

1. **Given** a chat with many videos and no cached posters, **When** the user
   opens the chat / its media grid / an album, **Then** the app remains responsive
   and does not freeze or crash.
2. **Given** poster generation is needed for N videos, **When** they are
   thumbnailed, **Then** no more than a small bounded number run at once (the rest
   queue), rather than all N simultaneously.

---

### User Story 2 - Video thumbnails are stable still images (Priority: P1)

Everywhere a video appears as a thumbnail — chat bubble, album grid, the album
viewer's bottom thumbnail strip, and the "Media, links & docs" grid — it shows a
still poster frame with a play affordance, not a playing video.

**Why this priority**: "Thumbnails don't stay thumbnails / they play" is the
visible half of the same defect and the direct user complaint.

**Independent Test**: In each of those surfaces, a video item renders as a static
poster image with a play icon; nothing plays until the user taps to open it.

**Acceptance Scenarios**:

1. **Given** a video in any thumbnail surface, **When** it is displayed, **Then**
   it shows a still poster (with a play indicator) and is not playing.
2. **Given** a video's poster has been generated once, **When** the same video is
   shown again (re-open, scroll back), **Then** the cached poster is reused and no
   new generation runs.

---

### Edge Cases

- A video whose poster generation fails or times out MUST fall back to a neutral
  placeholder (with a play icon) and MUST NOT retry in a tight loop or block other
  thumbnails.
- Generation MUST be muted and non-visible/non-audible — thumbnailing must never
  produce sound or a visible playing element.
- Leaving the chat/media view MUST stop/cancel any in-flight or queued generation
  (no background decoder churn after navigating away).
- Object URLs / decoder elements created for generation MUST be released so they
  don't leak across many videos.
- Low-memory devices: the bounded approach MUST keep peak concurrent decoders low
  enough to avoid the freeze.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Video thumbnail (poster) generation MUST be **concurrency-bounded** —
  at most a small fixed number run at once; additional requests queue.
- **FR-002**: A generated poster MUST be **cached and persisted** so each video is
  thumbnailed at most once; subsequent displays reuse the cache without regeneration.
- **FR-003**: Thumbnail generation MUST be muted and off-screen/non-interactive, and
  MUST NOT cause any visible or audible playback.
- **FR-004**: All video thumbnail surfaces (chat bubble, album grid, album-viewer
  thumbnail strip, "Media, links & docs" grid) MUST display a still poster with a
  play affordance — never an autoplaying video element.
- **FR-005**: Navigating away from a chat/media view MUST cancel in-flight and
  queued poster generation, and release the decoder elements / object URLs used.
- **FR-006**: A failed/timed-out generation MUST degrade to a neutral placeholder
  (with play icon) without tight-loop retries and without blocking other items.
- **FR-007**: Opening a video in the viewer MAY play it (user-initiated), but
  thumbnail surfaces MUST NOT; only the actively-viewed video (and, at most, its
  immediate neighbors, already the case) may mount a real player.
- **FR-008**: The app MUST NOT freeze or crash when a chat contains many videos
  without cached posters.

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire / is encrypted**: Unchanged. This is a **client-side**
  rendering/perf fix. Media stays E2EE; posters are derived locally from
  already-decrypted media and cached locally (same as today). No new wire traffic,
  no server change, no new server-visible metadata.
- **Poster cache**: posters are thumbnails of already-decrypted user media and are
  stored on-device through the existing media/poster persistence; they never leave
  the device unencrypted (no change to the existing at-rest posture).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Opening a chat with 10+ posterless videos keeps the UI responsive and
  causes no freeze/crash (manual device check + a bounded-concurrency unit test).
- **SC-002**: At most the bounded number of poster generations run concurrently,
  regardless of how many videos need posters (unit-tested).
- **SC-003**: Each video is thumbnailed at most once per device (cache hit on
  subsequent views); no regeneration on scroll-back/re-open.
- **SC-004**: No video thumbnail surface ever shows a playing video; thumbnails are
  still posters with a play affordance.

## Assumptions

- The root cause is unbounded, simultaneous `generateVideoPoster()` calls (each
  spinning up a decoding `<video>`), spawned per posterless video — not the
  thumbnail markup itself (which already uses `<img>` posters).
- A bounded queue + persistent poster cache + lighter capture is sufficient; no new
  dependency or worker is required (prefer the existing approach, made safe).
- The album viewer already mounts a real player only for the current slide and
  immediate neighbors; that behavior is kept (FR-007).
- This is a regression-class bug: per the constitution it begins with a failing
  test reproducing the unbounded-concurrency behavior before the fix.
