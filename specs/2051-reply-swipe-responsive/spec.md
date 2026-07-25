# Feature Specification: Make incoming messages more responsive to swipe-to-reply

**Feature Branch**: `fix/2051-reply-swipe-responsive`

**Created**: 2026-07-25

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User request: "Make incoming messages more responsive to swipe-right for replies without interfering with swipe-to-back."

## Context

To keep the iOS standalone-PWA back-swipe from accidentally arming a reply (and dropping a stray draft as the page navigates away), the reply-swipe on **incoming** bubbles is ignored when the drag starts in the left portion of the bubble (`REPLY_DEAD_ZONE_FRAC` in `ChatDetailPage.vue`). It was set to **0.55** (left 55% inert), which is more conservative than necessary and makes reply-swipes on incoming bubbles feel unresponsive.

This hotfix reduces the inert fraction to **0.35** — a low-risk middle step — so the reply-active area grows from the right 45% to the **right 65%** of an incoming bubble, while the left third (the part most likely to overlap the OS back-swipe lane) stays inert. Outgoing bubbles are unchanged (fully swipeable). A future option, if needed, is to replace the fraction with a screen-edge-based lane; this step is deliberately minimal so it can be validated on real devices first.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reply-swipe on an incoming message is easier to start (Priority: P1)

A user swipes right on an incoming message to reply; the gesture engages across more of the bubble, so it feels responsive — without a right-swipe near the screen's left edge accidentally triggering a reply instead of navigating back.

**Independent Test**: On a real device, swipe right starting in the middle of an incoming bubble → the reply gesture engages (previously inert there). Separately, perform the OS back-swipe from the left edge → it still navigates back and does NOT arm a reply or leave a draft.

**Acceptance Scenarios**:

1. **Given** an incoming bubble, **When** I start a right-swipe anywhere in its right ~65%, **Then** the reply gesture engages (bubble follows, reply icon reveals past the trigger).
2. **Given** an incoming bubble, **When** I start a right-swipe in its left ~35%, **Then** no reply is armed (that region stays reserved for the OS back-swipe).
3. **Given** any outgoing bubble, **When** I swipe right, **Then** behavior is unchanged (fully swipeable).
4. **Given** the OS back-swipe from the screen's left edge, **When** I perform it, **Then** it navigates back and does not arm a reply or drop a draft.

### Edge Cases

- **Narrow incoming bubble hugging the left edge (1:1):** with 0.35 its active zone starts closer to the edge; if a back-swipe ever leaks into a reply there, the fraction is nudged back up (or the screen-edge approach adopted). This is the reason for on-device validation.

## Requirements *(mandatory)*

- **FR-001**: The inert (non-reply) region of an **incoming** bubble MUST be the left 35% of that bubble's width (was 55%); the right 65% MUST engage the reply-swipe.
- **FR-002**: Outgoing bubbles MUST remain fully swipeable (unchanged).
- **FR-003**: A right-swipe that begins in the reserved left region MUST NOT arm a reply, preserving the OS back-swipe (no stray draft on back-navigation).
- **FR-004**: The reply fire threshold, max travel, direction lock, and delete-swipe behavior are unchanged.

## Zero-Knowledge Impact *(mandatory)*

None. This is a client-only touch-gesture threshold change; nothing crosses the client/server boundary, nothing is persisted or synced.

## Success Criteria *(mandatory)*

- **SC-001**: On a real device, a reply-swipe started in the middle of an incoming bubble engages (it did not before).
- **SC-002**: The OS back-swipe from the left edge still navigates back with no reply armed and no stray draft, across incoming bubbles of varying widths.
- **SC-003**: No regression to outgoing-bubble swipe, the delete-swipe, or scroll vs. swipe direction locking.

## Assumptions

- 0.35 is a first, low-risk step chosen for on-device tuning; the exact safe value depends on iOS's back-swipe lane width, which can only be confirmed on a real iPhone.
- The screen-edge-lane alternative remains available as a follow-up if 0.35 proves too aggressive on narrow left-edge bubbles.
