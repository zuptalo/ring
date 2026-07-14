# Feature Specification: Message Bubble Grows to Hold Its Reactions

**Feature Branch**: `feat/1051-message-bubble-grows`

**Created**: 2026-07-14

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User report with screenshot (2026-07-14, morning device pass): a short message ("Really?") with five reactions shows the chips spilling sideways past the bubble's edge, floating over the wallpaper. "Let's make the message bubble grow in width when the message itself is short, but number of reactions increases."

## User Story - Reactions always sit on their bubble (P1)

A short message that collects several reactions widens so the reaction pills straddle ITS edge (WhatsApp/Telegram behavior), instead of overflowing sideways onto the background. Long messages are unchanged; the 78% bubble-width cap still applies, and a chip row wider than the cap wraps as it does today.

**Acceptance**:
1. **Given** a short message with more reactions than fit under its natural width, **Then** the bubble is at least as wide as its reaction row (both incoming and outgoing, LTR and RTL).
2. **Given** a message without reactions, or whose text is wider than its chips, **Then** nothing changes visually.
3. **Given** enough reactions to exceed the bubble-width cap, **Then** the chips wrap and the bubble spans the cap.

## Requirements

- **FR-001**: A message bubble's width MUST be at least the width of its reaction row, up to the existing bubble-width cap; excess chips wrap.
- **FR-002**: Bubbles without reactions and media/album/game bubbles keep their current sizing (scope: the standard text-family bubble the report shows).
- **FR-003**: Verified by an automated bounding-box assertion (reaction row right/left edges within the bubble's) plus a live screenshot.

## Zero-Knowledge Impact

None — pure presentation.

## Success Criteria

- **SC-001**: e2e bounding-box check: with 5 distinct reactions on a 2-character message, the reactions row's box is horizontally contained by the bubble's box (±2px).
- **SC-002**: Existing chat e2e suites stay green (no layout regressions elsewhere).
