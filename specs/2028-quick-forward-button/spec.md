# Feature Specification: Quick-Forward Button Sits at the Bottom Edge of Tall Media Messages

**Feature Branch**: `fix/2028-quick-forward-button`

**Created**: 2026-07-13

**Status**: in-review

**Input**: User bug report with screenshots: "The forward icon is in wrong position!" — on a tall portrait photo message, the floating quick-forward button hovers vertically centered beside the image, far from the caption/footer where the eye expects it. (A second screenshot caught the swipe-to-delete affordance mid-swipe at the same height, compounding the misplaced look.)

## Bug

The floating quick-forward button beside incoming media/files/links (`.fwd-float`) uses `align-self: center` inside the message row's flex container. For short bubbles (files, links) centered reads fine; beside a tall portrait image it floats mid-image, visually detached from the message. Reference apps (Telegram's share button) anchor this control at the bubble's bottom corner, next to the caption and timestamp.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The forward button hugs the bottom of the message (Priority: P1)

A user receives a tall photo. The quick-forward button renders beside the message's bottom corner (aligned with the caption/footer area), not floating mid-image. Short messages (files, links) keep a sensible position too.

**Independent Test**: Send a portrait image between two test users; on the recipient, measure the button's bottom edge against the message column's bottom edge — they must align within a few pixels.

**Acceptance Scenarios**:

1. **Given** an incoming tall portrait photo, **When** the chat renders, **Then** the quick-forward button's bottom edge aligns with the message column's bottom edge (within a small tolerance), for both single media and albums.
2. **Given** an incoming file or link (short bubble), **When** the chat renders, **Then** the button still aligns to the bubble's bottom edge and remains fully visible and tappable.
3. **Given** a message with reactions hanging below the bubble, **Then** the button aligns to the bottom of the whole message block without overlapping the reaction pills.

### Edge Cases

- RTL locales: the button keeps its logical inline-end position (existing `margin-inline-start` behavior unchanged).
- Selection mode: the button stays pointer-inert as today (the `.sel-mode` rule targets the class, which is unchanged).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The quick-forward button MUST anchor to the bottom edge of the message column it accompanies, for every forwardable message shape (single media, album, file, link).
- **FR-002**: The fix MUST NOT change the button's size, tap target, icon, or horizontal placement, and MUST NOT alter when the button appears.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a tall portrait image, the button's bottom edge is within 8 px of the message column's bottom edge (was ~half the image height away).
- **SC-002**: The regression is covered by an automated e2e assertion that fails on the old CSS and passes on the new.

## Zero-Knowledge Impact

None. Pure client CSS; nothing crosses the wire.

## Assumptions

- Bottom-alignment to the message column (bubble plus any hanging reactions) is the intended reading of the report; centering on the image portion alone was considered and rejected as more complex for no visible benefit.
