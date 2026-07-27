# Feature Specification: An oversized preview must never block a send

**Feature Branch**: `fix/2055-poster-budget`

**Created**: 2026-07-27

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User report, after spec 2053 shipped in 1.0.29: "some gif images still can be sent and get stuck, didn't you say we send gif and animated webp and images as they are without any conversion?"

## Context: why this hotfix exists

Spec 2053 fixed media sends that hung in the **`compressing`** phase. This is a **second, independent** stuck-forever bug one stage later, which 2053 could not have caught — and it is why GIFs still stick. Both render the same clock icon, which is why they looked like one bug: `ChatDetailPage` shows the clock for `compressing` **and** `pending`.

The sender embeds a small preview (the "bubble tier") **inside the sealed message** as `MediaRef.poster`, so the recipient sees something before downloading the full file. Generating that tier had a shortcut: if the image is already within the 512px tier, don't make a second copy — **use the original as its own thumbnail**.

That shortcut tested **pixels only**. For an **animated** GIF or WebP the assumption is false: size lives in the *frame count*, not the frame size, so a 480×480 GIF is routinely several megabytes. Such a file became its own multi-megabyte "poster", was base64-encoded (~1.37×) into the sealed message, and the resulting websocket frame exceeded the server's **1 MiB** read limit (`ws/hub.go maxMessageSize`). The frame was never acked, so the message sat at `pending` — the sending clock — **forever**, and because the durable outbox retries at-least-once, every retry re-sent the same doomed frame.

Reproduced deterministically (`drive/scenarios/oversize-poster-repro.mjs`): an 882 KB, 512×512 image went `compressing → pending` and stopped; the recipient received **nothing**. With the fix, the same input reaches `delivered` in ~2s and the recipient gets it.

This also explains the user's puzzlement about conversion: nothing was converting the GIF (2050/2053 are correct that GIF/WebP pass through untouched). The blocker was the *preview* generated alongside it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A large animated GIF or WebP sends (Priority: P1)

A user sends a multi-megabyte animated GIF or WebP with modest pixel dimensions. It delivers, still animated, instead of sitting on the sending clock.

**Why this priority**: The reported defect. It silently loses messages — the sender believes it is sending and the recipient never receives anything.

**Independent Test**: Send an image whose long edge is within the bubble tier but whose bytes are far above the preview budget; confirm it reaches delivered and the recipient has it.

**Acceptance Scenarios**:

1. **Given** a small-dimension, large-byte animated image, **When** I send it, **Then** it is delivered and the recipient can view it, animated.
2. **Given** that same send, **When** it completes, **Then** the embedded preview is within the wire budget (a re-encoded still frame), not the whole file.
3. **Given** an image small in both pixels and bytes, **When** I send it, **Then** behaviour is unchanged (it still serves as its own preview — no second copy).

---

### User Story 2 - A preview can never block delivery (Priority: P1)

However a preview was produced, an oversized one is dropped rather than allowed to prevent the message being delivered.

**Why this priority**: The invariant that makes this class of failure impossible, not just this instance. A preview is an optimisation; delivery is the product.

**Independent Test**: Force an over-budget preview and confirm the message still delivers, without the preview.

**Acceptance Scenarios**:

1. **Given** a message whose preview exceeds the wire ceiling, **When** it is sent, **Then** the preview is dropped and the message is delivered.
2. **Given** that delivery, **When** the recipient opens it, **Then** they still get the full media by downloading it.

---

### Edge Cases

- **Animation MUST be preserved**: the preview is a still frame, but the delivered file is the untouched original (specs 2050/2052 unchanged) and renders animated.
- **A small-but-heavy source MUST NOT be upscaled** when re-encoded for the preview.
- **Unknown/degenerate dimensions** must not be treated as "small enough" to skip the check.
- Existing images small in both pixels and bytes must keep the no-second-copy optimisation (no storage or bandwidth regression).

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire**: strictly less. The preview rides inside the same sealed envelope as before, now bounded; no new field, endpoint or metadata.
- **Where processing happens**: entirely client-side, before encryption.
- **Unavoidably-visible metadata**: unchanged, and marginally reduced — sealed media messages get smaller.
- **Why it stays zero-knowledge**: a purely local decision about how large a locally-generated preview may be.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An image may serve as its own preview tier only when it is small in **both** pixel dimensions and bytes.
- **FR-002**: A source within the tier's pixel size but over the byte budget MUST have a preview generated (re-encoded to fit) rather than being reused whole.
- **FR-003**: Preview generation MUST NOT upscale a small source.
- **FR-004**: An embedded preview exceeding a hard wire ceiling MUST be dropped and the message delivered without it, never blocked.
- **FR-005**: The rule in FR-001 MUST be shared by the preview generator and the send path, so the two cannot disagree.
- **FR-006**: Media format handling is unchanged — GIF and animated WebP still send as-is, animation intact.
- **FR-007**: An image small in both dimensions and bytes MUST keep serving as its own preview (no extra copy stored or sent).

### Key Entities *(include if feature involves data)*

- **Bubble-tier preview** (`MediaRef.poster`): the small still image embedded in the sealed message. This fix makes its size bounded by construction and, as a backstop, at the point it is put on the wire. No schema change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A small-dimension, multi-megabyte animated image delivers successfully instead of stalling on the clock.
- **SC-002**: The embedded preview of any sent image is within the wire budget.
- **SC-003**: No send is ever blocked by its preview — an over-budget preview is dropped, the media still delivers.
- **SC-004**: Images small in both dimensions and bytes keep the existing no-second-copy behaviour.
- **SC-005**: Animated media still arrives animated (no conversion regression from specs 2050/2052/2053).

## Assumptions

- A still-frame preview is acceptable for animated media: the recipient downloads and renders the full animation regardless, so the preview only has to look right before download.
- Dropping a preview is always preferable to failing delivery.
- The server's 1 MiB frame limit is a fixed constraint to design within, not something to raise — a bigger limit would only move the threshold.

## Out of Scope

- Changing which media formats are converted (specs 2050 / 2052).
- The media-job lane/timeout work (spec 2053) — this is the next stage of the same pipeline.
- Raising or renegotiating the server frame limit, or chunking large previews across frames.
- Animated (multi-frame) previews.
