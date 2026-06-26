# Feature Specification: Media Sharing & Viewer Improvements

**Feature Branch**: `feat/1018-media-sharing-and`

**Created**: 2026-06-26

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Media sharing and media viewer improvements. Three threads: (1) BUG — portrait-ratio videos play upright for the sender but are rendered rotated 90° to the left on the receiver; (2) image and video message thumbnails are low resolution / pixelated and should be crisper while staying mindful of the encrypted payload size; (3) image/video viewing — individually and from the chat's media section — should offer pinch-to-zoom and panning as smooth as native iOS/iPadOS. All processing stays strictly client-side (zero-knowledge)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shared videos appear upright for everyone (Priority: P1)

A person records or picks a vertical (portrait) video on their phone and sends it in a chat. On their own device the message thumbnail and the in-chat playback both look upright and correct. The recipient opens the same message and sees the video play **upright** — not rotated, stretched, or with swapped width/height. This holds regardless of how the original was captured: portrait, landscape, or upside-down.

**Why this priority**: This is a correctness defect that makes shared portrait videos — the most common phone-captured format — effectively unwatchable for the recipient. It silently corrupts content the sender believes they sent correctly, undermining trust in the core sharing feature. It is the only thread that fixes broken behavior rather than improving working behavior.

**Independent Test**: Send a portrait video from device A and confirm on device B that playback orientation, aspect ratio, and the message thumbnail all match what device A sees. Repeat for landscape and upside-down source videos. Delivers value on its own without the thumbnail-quality or viewer work.

**Acceptance Scenarios**:

1. **Given** a portrait video captured on a phone, **When** the sender shares it and the recipient opens the message, **Then** the recipient sees it upright with the same aspect ratio the sender sees.
2. **Given** a landscape video, **When** it is shared, **Then** both sender and recipient see it in correct landscape orientation (no regression).
3. **Given** a video captured upside-down (180°) or in either sideways orientation, **When** shared, **Then** the recipient sees it the same way the sender does.
4. **Given** any shared video, **When** the recipient views its thumbnail (chat list, message bubble, media grid), **Then** the thumbnail orientation matches the playback orientation.

---

### User Story 2 - Crisp image & video thumbnails (Priority: P2)

A person scrolls their chats and opens conversations containing photos and videos. The small preview thumbnails shown in the chat list, inside message bubbles, and in the chat's media section look sharp and clear — not blurry, blocky, or visibly pixelated — on both standard and high-density (Retina) displays.

**Why this priority**: Pixelated previews make the app feel low-quality and make it hard to recognize a photo/video before opening it. It affects every media message but is a polish/quality improvement rather than broken functionality, so it ranks below the correctness fix.

**Independent Test**: Send representative photos and videos, then inspect the thumbnails in the chat list, message bubbles, and media grid on a high-density display; confirm no visible pixelation at the sizes they are displayed. Can ship independently of US1 and US3.

**Acceptance Scenarios**:

1. **Given** a photo is sent, **When** its thumbnail renders in a message bubble on a high-density display, **Then** it appears crisp with no visible blocking or pixelation at its displayed size.
2. **Given** a video is sent, **When** its poster thumbnail renders in the chat list, bubble, and media grid, **Then** it appears crisp at each of those sizes.
3. **Given** thumbnails are part of the encrypted message payload, **When** a higher-quality thumbnail is produced, **Then** the per-message size stays within an agreed budget so it does not noticeably slow message send/sync.
4. **Given** existing already-sent messages with old low-quality thumbnails, **When** a recipient views them after the change ships, **Then** they continue to display without error (no broken/missing previews).

---

### User Story 3 - Smooth, native-feeling zoom & pan when viewing media (Priority: P3)

A person taps a photo or video to view it full-screen — either from a message bubble or from the chat's media section/grid — and wants to inspect detail. They pinch to zoom, drag to pan around the zoomed image, double-tap to quickly zoom in and back out, and the motion feels fluid and responsive, with gentle resistance at the edges, matching the feel of the native iOS/iPadOS Photos experience.

**Why this priority**: This is an experience upgrade that makes viewing shared media feel premium, but the current viewer is functional. It is the most involved of the three and the least urgent, so it ranks last.

**Independent Test**: Open an image in the full-screen viewer and exercise pinch-zoom, pan, double-tap-to-zoom, and release-at-bounds; confirm fluid motion and that the gestures behave consistently whether the viewer was opened from a message or from the media grid. Independent of US1 and US2.

**Acceptance Scenarios**:

1. **Given** an image open in the full-screen viewer, **When** the user pinches outward, **Then** the image zooms smoothly centered on the pinch point and tracks the fingers without lag.
2. **Given** a zoomed-in image, **When** the user drags, **Then** the image pans smoothly and cannot be panned beyond its content edges, showing a gentle rubber-band/overscroll that settles back to the bound on release.
3. **Given** an image at default zoom, **When** the user double-taps, **Then** it zooms in to a comfortable level centered on the tap; **When** double-tapped again, **Then** it returns to fit-to-screen.
4. **Given** a zoomed-in image, **When** the user releases a pan with velocity, **Then** the image continues with momentum and decelerates naturally.
5. **Given** the viewer is opened from the media grid with multiple items, **When** the user zooms one item and then navigates to the next, **Then** the next item starts at fit-to-screen (zoom does not leak between items).

---

### Edge Cases

- **Video with no orientation metadata** (already-upright bytes): must not be double-rotated; it should display upright.
- **Animated images (GIF / motion formats)** and **very large images**: thumbnail generation and zoom must handle them without freezing the UI.
- **Extreme aspect ratios** (very tall panoramas, very wide images): fit-to-screen and zoom bounds must still behave sensibly.
- **Pinch that crosses into a swipe-to-next gesture** in the grid viewer: the system must disambiguate zoom from item-navigation so neither fires accidentally.
- **Low-memory / older devices**: higher-quality thumbnails and smooth zoom must degrade gracefully rather than crash or stutter badly.
- **Offline viewing**: thumbnails and the zoom/pan experience must work for already-downloaded media without a network round-trip.
- **Backward compatibility**: messages sent before this change (old thumbnails, old video encoding) must still render correctly for both parties.

## Requirements *(mandatory)*

### Functional Requirements

**Video orientation (US1)**

- **FR-001**: Shared videos MUST display in the same orientation and aspect ratio for the recipient as they do for the sender, for portrait, landscape, and rotated (90°/180°/270°) source captures.
- **FR-002**: A video's generated thumbnail/poster MUST match the orientation of its playback.
- **FR-003**: Videos that are already upright (no rotation metadata) MUST NOT be rotated or distorted (no double-correction).
- **FR-004**: Orientation correctness MUST hold without the server gaining access to media plaintext or metadata (all handling client-side).

**Thumbnail quality (US2)**

- **FR-005**: Image and video message thumbnails MUST render without visible pixelation at the sizes they are displayed in the chat list, message bubbles, and media grid, including on high-density displays.
- **FR-006**: Thumbnail data MUST remain inside the encrypted message payload (no separate plaintext thumbnail leaves the device).
- **FR-007**: The per-message thumbnail size MUST stay within a defined budget so that send and sync performance is not noticeably degraded relative to today.
- **FR-008**: Messages created before this change MUST continue to display their existing thumbnails without error.

**Media viewer zoom & pan (US3)**

- **FR-009**: The full-screen media viewer MUST support pinch-to-zoom centered on the gesture, smooth panning while zoomed, double-tap to toggle zoom, and momentum/inertia on pan release.
- **FR-010**: Panning MUST be bounded to the content with a rubber-band/overscroll effect that settles back to the edge on release.
- **FR-011**: The zoom/pan experience MUST behave identically whether the viewer is opened from a message bubble or from the chat's media section/grid.
- **FR-012**: Zoom state MUST reset to fit-to-screen when navigating between items in a multi-item viewer.
- **FR-013**: Gesture handling MUST disambiguate zoom/pan from item-to-item navigation and from dismissing the viewer, so gestures do not trigger the wrong action.

### Key Entities *(include if feature involves data)*

- **Media message**: A chat message carrying an image or video. Relevant attributes (conceptual): the encrypted full media, an embedded preview thumbnail, and orientation/aspect information needed to render correctly.
- **Thumbnail / preview**: The small representation embedded in a media message and shown in lists, bubbles, and the media grid; subject to a size budget because it travels inside the sealed payload.
- **Media viewer session**: The full-screen viewing context for one or more media items, tracking the current item and per-item zoom/pan state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of test videos (portrait, landscape, 180°, and both sideways orientations) display with matching orientation and aspect ratio on sender and recipient devices.
- **SC-002**: Zero reports of "received video is sideways/rotated" for newly sent videos after release (down from the current reproducible failure).
- **SC-003**: Image and video thumbnails show no visible pixelation at their displayed sizes on a high-density display, as confirmed by side-by-side review against the source.
- **SC-004**: The increase in average media-message payload size from higher-quality thumbnails stays within the agreed budget, with no measurable regression in send/sync time for a typical photo message.
- **SC-005**: In the full-screen viewer, pinch-zoom and pan track the user's fingers fluidly with no perceptible lag during normal use, and bounds/inertia behave consistently across repeated trials.
- **SC-006**: Users can zoom into a shared photo to inspect detail and return to fit-to-screen using only intuitive gestures (pinch, drag, double-tap) without on-screen controls or instructions.
- **SC-007**: No regression: previously sent media (old thumbnails/encodings) still render correctly for both sender and recipient.

## Assumptions

- **Zero-knowledge boundary is non-negotiable**: all transcoding, thumbnail generation, and orientation handling happen on the client; the server only ever relays/stores opaque ciphertext (per the project constitution).
- **Scope of zoom/pan**: applies to the full-screen media viewer reached from both individual messages and the media grid; pinching the grid of thumbnails itself (to resize the grid) is out of scope.
- **Thumbnail size budget**: a concrete size/quality target will be settled during clarify/plan; the working assumption is "visibly crisp at display size on high-density screens" balanced against keeping typical thumbnails small enough not to slow send/sync.
- **No re-processing of historical media**: the fixes apply to newly sent media and to rendering of existing media; the system does not retroactively re-encode or re-thumbnail already-sent messages.
- **Primary target is touch devices** (the installable PWA on phones/tablets), where the iOS/iPadOS-smooth feel matters most; pointer/trackpad zoom is a nice-to-have, not a requirement.
- **Existing media send/transfer pipeline is reused**: this feature changes how media is encoded/oriented and previewed and how the viewer handles gestures, not the underlying encrypted-transfer mechanism.
