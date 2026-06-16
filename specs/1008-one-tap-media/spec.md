# Feature Specification: One-Tap Media Open & Inline Quick-React Bar

**Feature Branch**: `feat/1008-one-tap-media`

**Created**: 2026-06-16

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "The image/video/album viewing has become 2 steps since we have to first tap the content and then choose 'View'. For videos/images/albums where tapping is expected to open the media, tapping should open it directly. Make the bubble's bottom (timestamp) row a bit taller; put the timestamp for sent on the right next to the delivery status, and for received on the left (incoming messages are left-aligned). On the opposite side — right for incoming, left for outgoing — put an add-circle-outline icon that brings up only the 7 most-used emoji, with an add-circle-outline at the end of that list to pick a new one (which then joins the most-used list). No more sliding; all are visible. The full message menu stays home to the rest of the message functionality. So two separate popups; one could be visible at a time, and leaving the chat dismisses any open one even if it was open when the user swiped right to go back."

## Overview

Spec 1004 made a single tap open the per-message action menu (so the media viewer
became a two-step "tap → View"), and put the quick-react emoji in a horizontally
**scrolling** row inside that menu. Testing showed both are worse for the common
cases: tapping a photo/video/album should just open it, and the reaction row should
show its options at a glance without sliding.

This feature splits the interaction into two distinct, purpose-built affordances:

1. **One-tap open** — a single tap on an image, video, or album opens the media
   directly (the full-screen viewer / playback), the way tapping media is expected
   to behave.
2. **Inline quick-react** — each bubble's bottom row gains a direction-aware reaction
   button that reveals the **7 most-used emoji** (all visible, no scrolling) plus a
   "+" to pick a new one (which then enters the most-used set). The timestamp and
   delivery status are laid out by message direction.

The **full message menu** (reply, forward, edit, save, copy, select, delete, message
info, reactions list) remains, but is no longer the single-tap action — it's a
separate menu reached by a deliberate gesture. The two popups are mutually exclusive
and are dismissed automatically when the chat view is left, even mid swipe-back.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One tap opens media (Priority: P1)

Tapping an image, a video, or an album cell opens the media directly — the full-screen
viewer for images, playback for video — with no intermediate menu step.

**Why this priority**: This is the most common media interaction and the most-felt
regression from 1004; restoring it is the core value.

**Independent Test**: Send/receive an image, a video, and an album; tap each and
confirm the viewer/playback opens directly (no menu in between).

**Acceptance Scenarios**:

1. **Given** an image bubble, **When** I single-tap it, **Then** the full-screen
   viewer opens at that image.
2. **Given** a video bubble, **When** I single-tap it, **Then** the video opens in
   the viewer and plays (per spec 1007 autoplay-on-land).
3. **Given** an album, **When** I tap a cell, **Then** the viewer opens at that
   specific item.

---

### User Story 2 - Inline quick-react with the 7 most-used, no sliding (Priority: P1)

Every message bubble shows a reaction button in its bottom row. Tapping it reveals
exactly the 7 most-used emoji (all visible at once) and a trailing "+" to choose a
new emoji; choosing one applies it and moves it into the most-used set.

**Why this priority**: Reacting is frequent; making all options visible without a
slide (the 1004 row didn't slide reliably) is the second core improvement.

**Independent Test**: Open the quick-react on a message, confirm 7 emoji + "+" are
all visible without scrolling, tap one and confirm it's applied; tap "+", pick a new
emoji, confirm it applies and later appears in the 7.

**Acceptance Scenarios**:

1. **Given** any message, **When** I tap its reaction button, **Then** a quick-react
   popup shows the 7 most-used emoji and a trailing "+", all fully visible (no scroll).
2. **Given** the quick-react popup, **When** I tap an emoji, **Then** it's applied as
   my reaction and the popup closes.
3. **Given** the quick-react popup, **When** I tap "+", choose an emoji, **Then** it's
   applied and, over time, surfaces among the 7 most-used.
4. **Given** repeated reactions, **When** the 7 are computed, **Then** they reflect
   usage (most-used first), consistent with the existing on-device usage tally.

---

### User Story 3 - Direction-aware timestamp row (Priority: P2)

The bubble's bottom row is a bit taller and lays out by direction: for sent messages
the timestamp sits on the right next to the delivery tick and the reaction button on
the left; for received messages the timestamp sits on the left and the reaction
button on the right.

**Why this priority**: Makes the reaction button reachable and the row readable; it's
the visual frame for US2 but secondary to the react behavior itself.

**Acceptance Scenarios**:

1. **Given** a sent message, **When** it renders, **Then** the timestamp + tick are
   right-aligned and the reaction button is on the left.
2. **Given** a received message, **When** it renders, **Then** the timestamp is
   left-aligned and the reaction button is on the right.

---

### User Story 4 - Full message menu via long-press (Priority: P1)

The full action menu (reply, forward, edit, save/save-all, copy, select, delete,
message info, reactions list) is still available, reached by a **long-press** on the
bubble — distinct from the one-tap-open and the quick-react button.

**Why this priority**: All the non-reaction actions must remain reachable; without
this the redesign removes functionality.

**Acceptance Scenarios**:

1. **Given** any message, **When** I long-press it, **Then** the full action menu
   opens with the same actions as today (minus the inline quick-react row, which now
   lives in the bottom-row button).
2. **Given** a media message, **When** the full menu is open, **Then** it still
   offers media actions (save / save all / view), so media is reachable from the menu
   too, not only by tapping.

---

### User Story 5 - Popups are exclusive and auto-dismiss on leave (Priority: P2)

Only one popup (quick-react or full menu) is open at a time, and any open popup is
dismissed when the chat view is left — including when the user swipes right to go
back with a popup still open.

**Acceptance Scenarios**:

1. **Given** the quick-react popup is open, **When** I open the full menu (or vice
   versa), **Then** the first one closes.
2. **Given** any popup is open, **When** I leave the chat (back button or swipe-back),
   **Then** the popup is dismissed and does not linger over the previous view.

---

### Edge Cases

- A fresh account with no reaction history shows a sensible default set of 7.
- Very wide / very narrow bubbles still show all 7 emoji + "+" without clipping or
  scrolling, in both LTR and RTL.
- A deleted message shows no reaction button (and no menu).
- Tapping a non-media bubble (text) does nothing; reactions come from the bottom-row
  button and the full menu from long-press.
- The quick-react popup stays fully on-screen for messages at the top/bottom edge.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A single tap on an image, video, or album (cell) MUST open the media
  directly — the full-screen viewer for images, playback for video, the tapped item
  for an album — with no intermediate menu.
- **FR-002**: Each non-deleted message bubble MUST present a reaction button in its
  bottom row. Tapping it MUST reveal a quick-react popup of the 7 most-used emoji plus
  a trailing "+", all visible at once (no horizontal scrolling).
- **FR-003**: Tapping an emoji in the quick-react popup MUST apply it as the user's
  reaction (toggling off if already set, per existing behavior) and close the popup.
- **FR-004**: The "+" MUST open the full emoji picker; the chosen emoji MUST be
  applied and counted toward the usage tally so it can enter the most-used 7.
- **FR-005**: The 7 quick-react emoji MUST be ordered by on-device usage (most-used
  first, after any fixed defaults), reusing the existing usage tally (spec 1004), with
  a sensible default set before any history exists.
- **FR-006**: The bubble bottom row MUST be laid out by direction: sent → timestamp +
  delivery status on the right, reaction button on the left; received → timestamp on
  the left, reaction button on the right. The row MUST be tall enough to host the
  button comfortably.
- **FR-007**: The full message menu MUST remain available with all current actions
  (reply, forward, edit, save, save all, copy, select, delete, message info, reactions
  list, and media "view"), opened by a **long-press** on the bubble (any kind). The
  single-tap-on-media open and the long-press-for-menu are distinct gestures.
- **FR-008**: A single tap on a text (non-media) bubble MUST do nothing (text has no
  "open" action). Reactions come from the bottom-row button; the full menu from
  long-press. Tap therefore never opens a menu anywhere — consistent across bubbles.
- **FR-009**: The quick-react popup is a transient popover: it opens on tapping the
  reaction button and closes on an outside tap or after a pick. The quick-react popup
  and the full menu MUST be mutually exclusive — opening one closes the other (only one
  popup visible at a time).
- **FR-010**: Any open popup MUST be dismissed when the chat view is left, including a
  swipe-right back gesture, so it never lingers over another view.
- **FR-011**: All UI MUST use stock Ionic components + existing theme tokens; build
  custom only where no Ionic primitive fits, composed from Ionic (Constitution XI).
- **FR-012**: Behavior MUST be correct in LTR and RTL and across light/dark themes.

## Zero-Knowledge Impact *(mandatory)*

- Client-only UI/interaction change. Reactions ride the existing E2EE reaction path
  unchanged; the emoji usage tally is an on-device preference, never sent to the
  server. No wire, server, or data-model change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Opening a photo/video/album from the chat is a single tap (verified e2e
  for each kind: tap → viewer/playback, no menu step).
- **SC-002**: The quick-react popup shows 7 emoji + "+" with none clipped or requiring
  a scroll, at narrow and wide bubble widths (verified by assertion + visual).
- **SC-003**: Tapping a quick-react emoji applies it; "+" applies a custom one that
  later appears in the 7 (verified e2e via the usage tally).
- **SC-004**: The full menu remains reachable and exposes all prior actions (verified
  e2e: invoke the menu gesture, assert the actions are present).
- **SC-005**: Leaving the chat with a popup open leaves no lingering overlay (verified
  e2e: open popup, navigate back, assert no popup in the DOM).

## Assumptions

- Builds directly on the current chat UI (specs 1004/1005/1007 and the round-2 fixes
  on the integration branch): the action menu component, the `quickReactEmojis` usage
  tally, the media viewer (one-tap → `openMediaViewer`), and the emoji picker all
  exist and are reused; this spec re-wires gestures and adds the inline bottom-row
  reaction button rather than building new subsystems.
- "7 most-used" reuses `quickReactEmojis` (it already returns most-used-first with a
  default fallback); the count is fixed at 7 here.
- The full emoji picker for "+" is the existing one used by 1004's "more".
- Default emoji set before any usage history is the existing `DEFAULT_QUICK` set.
