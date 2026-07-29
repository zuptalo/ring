# Feature Specification: Full-size aspect-preserving media thumbnails in chat

**Feature Branch**: `feat/1063-full-size-media`

**Created**: 2026-07-26

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User request: "See the full-size media thumbnail in chat — any reasonable aspect ratio (3:4, 4:3, 16:9, 9:16, …) should use the max width of the media and render based on that, unless it gets too tall to fit the visible chat area, in which case height drives; if too wide, width drives. Thumbnails should be crystal clear on retina."

## Context

Today every photo/video in the chat renders in a fixed **240×240 square** frame with `object-fit: cover`, so all media is **center-cropped to a square** regardless of its real aspect ratio, and the shown image is the **512px on-wire poster** — fine for a 240px square but soft on a full-size retina bubble. This spec makes media render at its **true aspect ratio**, sized to a max width but height-capped so a tall clip never runs off the visible chat area, and **crystal-clear on retina** by rendering the full downloaded media (poster only as a pre-download placeholder).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Media shows at its real aspect ratio, full size (Priority: P1)

A user views photos/videos of any reasonable aspect ratio (3:4, 4:3, 16:9, 9:16, square). Each renders uncropped at its true ratio: width-driven up to a max width; if that would be too tall, height-driven capped at a max height so it stays within the visible chat area.

**Independent Test**: Send images of 3:4, 4:3, 16:9, 9:16, and 1:1 → each shows uncropped at its ratio; the tall 9:16 is capped in height (not running off-screen), the wide 16:9 is capped in width; none are square-cropped.

**Acceptance Scenarios**:

1. **Given** a landscape (e.g. 16:9) image, **When** it renders, **Then** it uses the max width and its height follows the ratio (short), uncropped.
2. **Given** a portrait (e.g. 9:16) image, **When** it would be taller than the height cap, **Then** height drives (capped) and width follows the ratio — it fits the visible chat area, uncropped.
3. **Given** any media, **When** it renders, **Then** it is NOT center-cropped to a square.
4. **Given** a very small image, **When** it renders, **Then** it still shows at full bubble width (visible and tappable), not as a tiny sliver.

### User Story 2 - Retina-crisp media (Priority: P1)

Media in the bubble is crisp on retina/high-DPI screens.

**Independent Test**: On a 2–3× DPI display, a full-size photo bubble looks sharp (not the soft 512px poster) once the media has downloaded.

**Acceptance Scenarios**:

1. **Given** a downloaded image, **When** it renders in the bubble, **Then** the full-resolution media is shown (browser downscales it) — crisp at any DPI.
2. **Given** an image not yet downloaded, **When** it renders, **Then** the poster shows as a placeholder until the full media resolves, then upgrades to crisp.
3. **Given** a video, **When** its bubble renders, **Then** its still preview is crisp at full size (a higher-resolution poster than the 512px on-wire one).

### Edge Cases

- **Unknown dimensions** (legacy messages without stored width/height): fall back to a sensible frame (square) rather than breaking layout.
- **Extreme ratios** (very wide panorama / very tall): clamped by the width and height caps respectively; still uncropped.
- **Off-screen / long media-heavy chats**: full-res rendering is bounded to near/visible items (existing media windowing), so memory stays controlled; off-screen items use the poster and lazy-load.
- **Albums / grid / viewer**: unchanged (this spec is the single-media chat bubble).

## Requirements *(mandatory)*

- **FR-001**: A single-media (image/video) chat bubble MUST render at the media's true aspect ratio (from the stored width/height), never center-cropped to a square.
- **FR-002**: Sizing MUST be width-driven up to a max width, and switch to height-driven (capped) when the aspect-preserving height would exceed a max height, so a tall clip fits the visible chat area.
- **FR-003**: The max width MUST make media feel full-size (wider than today's 240px) while remaining responsive on narrow screens; the max height MUST be viewport-relative so tall media never runs off the visible chat content.
- **FR-004**: Media MUST render at the computed max width (never a tiny, untappable sliver); a small/degenerate image is shown at full bubble width rather than at its native pixel size.
- **FR-005**: The bubble MUST render the full downloaded media for retina crispness, using the poster only as a placeholder until the full media resolves.
- **FR-006**: Video bubbles MUST show a crisp still at full size (a higher-resolution local poster than the ~512px on-wire poster), with the play affordance and tap-to-open-viewer unchanged.
- **FR-007**: Full-res rendering MUST stay bounded to near/visible items (reuse the existing media windowing) so long media-heavy chats don't blow up memory.
- **FR-008**: The on-wire poster (sealed in the message) MUST remain small (~40KB) — crispness comes from the locally-held full media / local hi-res poster, not a larger wire payload.

## Zero-Knowledge Impact *(mandatory)*

None. This is a client-side rendering/layout change over media the device already holds; nothing new crosses the client/server boundary, the on-wire poster stays as-is, and no new data is persisted or synced.

## Success Criteria *(mandatory)*

- **SC-001**: Images of 3:4, 4:3, 16:9, 9:16, and 1:1 all render uncropped at their true ratio; tall media is height-capped within the visible chat area; wide media is width-capped.
- **SC-002**: A downloaded photo bubble is visibly crisp on a 2–3× DPI display (clearly better than the 512px poster).
- **SC-003**: No square center-cropping remains for single-media bubbles.
- **SC-004**: Small/degenerate media still renders at full bubble width (visible and tappable), never a tiny sliver.
- **SC-005**: The sealed message poster size is unchanged (~40KB); no new wire/persisted data.
- **SC-006**: No regression to albums, the media grid, the full-screen viewer, or scroll/perf in long chats.

## Assumptions

- `mediaWidth`/`mediaHeight` are already stored on messages (set during the media job) and are sufficient for the aspect ratio; legacy messages without them fall back to square.
- `mediaInfo[mediaId].url` (the full downloaded media) is already resolved for near/visible items and is the crisp source to render.
- Exact max width/height values (≈ min(75vw, 330px) width, ≈ 60vh height) are tuned on-device via screenshots across aspect ratios; the spec fixes the behavior, not the pixel constants.
