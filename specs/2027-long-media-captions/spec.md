# Feature Specification: Media captions wrap at the photo's edge

**Feature Branch**: `fix/2027-long-media-captions`

**Created**: 2026-07-12

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "If media has a long caption it looks odd!" (screenshot: a
photo bubble whose long caption stretches the bubble wider than the photo, leaving the
photo floating against dead bubble background).

## Root cause

A media bubble is a column flexbox whose width is its content's shrink-to-fit width. The
photo/video frame is a fixed 240px square (`.media-wrap`/`.video-poster`), but a long
caption's intrinsic width is the full unwrapped line — so the caption, not the media,
sizes the bubble (up to the 78% message-column cap), and the photo sits narrower than its
own bubble.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Long captions look like captions (Priority: P1)

A photo or video sent with a long caption renders as one tight unit: the media defines
the bubble's width and the caption wraps beneath it at the media's edge — the way every
mainstream messenger treats captions.

**Independent Test**: Send a photo with a one-line-plus caption; the bubble hugs the
photo and the caption wraps at the photo's width. Short captions are unchanged.

**Acceptance Scenarios**:

1. **Given** an image or video message with a caption longer than the media is wide,
   **When** it renders (incoming or outgoing, LTR or RTL text), **Then** the bubble is no
   wider than the media frame plus its 3px inset and the caption wraps within it.
2. **Given** a short caption, **When** it renders, **Then** nothing changes (the bubble
   already hugged the media).

### Edge Cases

- Narrow viewports where the 240px frame itself shrinks (`max-width: 100%`): the cap
  follows `min(100%, …)`, so bubble and media stay aligned.
- Albums are untouched (`.album-bubble` never carries `.bubble-media`).
- Video-note / voice / audio / file bubbles are untouched (not `.bubble-media`).
- RTL captions (dir="auto" + `unicode-bidi: plaintext`) wrap identically — the cap is a
  width, not a text-direction rule.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A `.bubble-media` bubble MUST be capped at the media frame width plus its
  own padding, so captions, sender lines, reply quotes, and the footer wrap at the
  photo's edge instead of stretching the bubble.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A photo with a long caption shows no bubble background beside the photo —
  media and caption share one width, on any screen size, either message direction.

## Assumptions

- The 240px media frame (spec 1011's fixed-square scroll-anchor rule) stays as is; the
  cap references it (240 + 2×3px inset = 246px) rather than restructuring the frame.
