# Feature Specification: Rearrange pinned chats with drag, stable manual order, and long-press chat preview

**Feature Branch**: `feat/1045-rearrange-pinned-chats`

**Created**: 2026-07-13

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "iMessage-style manual arrangement of pinned chats plus a long-press chat preview: drag a lifted pinned avatar to any grid position and it stays there; new messages never move a pin; drag a pin down into the list to unpin; drag a list row up into the grid to pin it at a chosen spot (forbidden badge when the 9-pin cap is reached); a longer hold opens a preview of the chat's latest messages with Pin/Unpin, Mark as Unread/Read, and Delete actions beneath it."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pinned chats keep the order I gave them (Priority: P1)

I pin the people who matter most and arrange them the way I think of them —
family in the first row, work below. Once arranged, that layout is mine: a new
message in any pinned chat lights up its badge but never moves the avatar.

**Why this priority**: This is the core promise of pinning. Today the grid
reorders itself by latest activity, so the muscle memory of "mom is top-left"
breaks every time someone writes. Every other story builds on a stable order.

**Independent Test**: Pin three chats, receive a message in the last one, and
confirm the grid order is unchanged (only the unread badge updates).

**Acceptance Scenarios**:

1. **Given** three pinned chats A, B, C in that order, **When** a new message
   arrives in C, **Then** the grid still shows A, B, C and C shows its unread badge.
2. **Given** a pinned chat, **When** I open it, send messages, mute it, or mark
   it unread, **Then** its position in the grid does not change.
3. **Given** pinned chats arranged on this device, **When** the same account
   syncs to another device, **Then** the arrangement arrives there too.

---

### User Story 2 - Drag a pinned avatar to rearrange (Priority: P1)

A short press-and-hold on a pinned avatar lifts it slightly (it grows and
floats above the grid). I can then drag it anywhere in the grid; the other
avatars part to make room, and when I let go it settles where I dropped it and
stays there.

**Why this priority**: Manual arrangement is the feature the user asked for by
name; a stable order (US1) without a way to set it is only half the job.

**Independent Test**: With 4+ pins, long-press the last avatar, drag it to the
first slot, release, and confirm the new order persists across app restarts.

**Acceptance Scenarios**:

1. **Given** pinned chats A, B, C, **When** I short-long-press C and drag it
   before A, **Then** the grid shows C, A, B and keeps that order afterwards.
2. **Given** a lifted avatar mid-drag, **When** I hover it between two others,
   **Then** the others visibly make room so I can see where it will land.
3. **Given** a lifted avatar, **When** I release it without moving it, **Then**
   nothing changes and no chat opens.
4. **Given** a short tap (no hold) on a pinned avatar, **Then** the chat opens
   as before.

---

### User Story 3 - Drag between the grid and the list to pin/unpin (Priority: P2)

Dragging a pinned avatar down into the regular chat list unpins it — it slides
back into the list where its recent activity puts it. Dragging a regular chat
row up into the grid pins it at the exact spot I drop it: while lifted, the row
shrinks into a round avatar so it reads as "becoming a pin". If nine chats are
already pinned, the hovering avatar shows a forbidden badge at its top right,
and dropping it does nothing.

**Why this priority**: Completes the drag language so pin membership and pin
order are one gesture, but pinning/unpinning is already possible via swipe and
the actions sheet, so it's not the MVP.

**Independent Test**: Drag a pin into the list and confirm it unpins; drag a
row into the grid and confirm it pins at the drop position; fill nine pins and
confirm the forbidden badge appears and the drop is rejected.

**Acceptance Scenarios**:

1. **Given** a pinned chat, **When** I drag its avatar below the grid into the
   list area and release, **Then** it is unpinned and appears in the list at
   its normal recency position.
2. **Given** fewer than nine pins, **When** I short-long-press a list row, drag
   it into the grid between two avatars and release, **Then** it is pinned at
   that position.
3. **Given** nine pinned chats, **When** I lift a list row and hover it over
   the grid, **Then** a forbidden badge shows at the top right of the floating
   avatar and releasing it changes nothing.
4. **Given** a lifted list row dropped back where it came from (outside the
   grid), **Then** nothing changes.

---

### User Story 4 - Hold longer for a peek at the chat (Priority: P2)

If I keep holding (without dragging), the app opens a preview card of that
chat's latest messages — enough to read the recent back-and-forth without
opening the chat and marking it read. Tapping the preview opens the chat.
Tapping outside dismisses it. Under the preview sits a small menu: Pin or
Unpin, Mark as Unread or Mark as Read, and Delete.

**Why this priority**: A peek is a big quality-of-life win and iMessage parity,
but it doesn't gate the ordering work.

**Independent Test**: Long-hold a chat (tile or row), read the preview, tap
outside to dismiss; long-hold again and tap the preview to enter the chat;
use each menu action.

**Acceptance Scenarios**:

1. **Given** any chat (pinned tile or list row), **When** I press and hold
   without moving past the lift, **Then** a preview of the latest messages
   appears with the action menu beneath it.
2. **Given** an open preview, **When** I tap inside the preview, **Then** the
   chat opens; **When** I tap outside, **Then** the preview closes and nothing
   else happens.
3. **Given** an open preview of an unread chat, **Then** viewing the preview
   does not mark the chat read.
4. **Given** the action menu, **Then** it shows "Unpin" for a pinned chat /
   "Pin" for an unpinned one, "Mark as Unread" for a read chat / "Mark as
   Read" for an unread one, and "Delete" (or "Exit group" for a group), with
   Delete asking for confirmation first.
5. **Given** nine existing pins and the preview of an unpinned chat, **When** I
   tap "Pin", **Then** I see the existing "You can only pin 9 chats" notice.

---

### Edge Cases

- A drag that starts scrolling: movement before the lift completes cancels the
  hold and the page scrolls normally; after the lift, the page must not scroll
  while dragging.
- Release exactly on the grid/list boundary: the drop counts as "in the grid"
  only while hovering over the grid area; anywhere else behaves as a cancel
  (for a row) or an unpin (for a pin dragged out).
- Arrangements from another device (sync) may briefly disagree with local
  order; the most recent change wins, and duplicate/missing order values must
  not crash the grid — ties fall back to recency.
- Pins that predate this feature have no saved position: they keep their
  current relative order (recency at upgrade time) until first rearranged.
- The preview must respect existing content protections: previews of the
  latest messages render the same redacted forms used by the chat list (e.g.
  "Photo", deleted-message placeholder), then real bubbles for text.
- During an active search or a non-"All" filter chip there is no grid; rows
  behave as today (no drag; the long-hold preview still works).
- Deleting a pinned chat from the preview removes it from the grid.
- The unread badge, mention badge, and manual-unread dot keep rendering on a
  tile mid-drag (they move with it).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Pinned chats MUST display in a user-defined order that is
  unaffected by message activity, opening, muting, read/unread changes, or any
  interaction other than an explicit rearrangement.
- **FR-002**: A newly pinned chat (via swipe, actions sheet, or preview menu)
  MUST join the grid at the END of the current arrangement; a chat pinned by
  drag-into-grid MUST join at the drop position.
- **FR-003**: A short press-and-hold (~0.4 s) on a pinned avatar MUST lift it
  (visible elevation) and enter drag mode; dragging MUST live-preview the
  landing slot by moving the other avatars aside; releasing MUST commit the
  new order immediately and persist it.
- **FR-004**: The committed arrangement MUST survive app restarts and MUST
  sync to the user's other devices with last-write-wins semantics, without any
  plaintext leaving the device (order data rides the existing encrypted
  own-data sync).
- **FR-005**: Dragging a pinned avatar out of the grid (over the list area)
  and releasing MUST unpin it; the chat then sorts by recency in the list.
- **FR-006**: A short press-and-hold on a regular list row MUST lift it as a
  round avatar (pin-shaped); dropping it over the grid MUST pin it at the
  hovered position when fewer than nine chats are pinned. When NO chats are
  pinned yet (no grid exists), lifting a row MUST reveal a drop target where
  the grid will appear, so the first pin can also be created by drag.
- **FR-007**: When nine chats are already pinned, a lifted list row MUST show
  a forbidden badge at the top right of the floating avatar while over the
  grid, and releasing MUST NOT pin it.
- **FR-008**: Movement beyond a small threshold before the lift completes MUST
  cancel the hold (normal scrolling/swiping wins); after the lift, drag
  movement MUST NOT scroll the page.
- **FR-009**: Continuing to hold (~0.9 s total) without dragging MUST open a
  preview overlay of the chat's latest messages, on both pinned tiles and
  list rows.
- **FR-010**: The preview MUST be read-only and MUST NOT mark the chat read
  or alter unread counts.
- **FR-011**: Tapping the preview MUST open the chat; tapping outside MUST
  dismiss the overlay with no side effects.
- **FR-012**: Beneath the preview a menu MUST offer: Pin/Unpin (label matches
  current state, honouring the nine-pin cap with the existing notice),
  Mark as Unread/Mark as Read (label matches current state), and Delete
  (Exit group for groups) with the existing confirmation.
- **FR-013**: All existing entry points (tap to open, swipe actions, the
  actions sheet, contextmenu on tiles) MUST keep working unchanged.
- **FR-014**: Hidden-chat protections MUST hold: the preview and drag surfaces
  only ever operate on chats already visible in the list, and the preview
  renders the same content the chat is allowed to show in its list row.

### Key Entities

- **Chat pin position**: for each pinned chat, its place in the user's
  arrangement (first, second, …). Stored with the chat's other organisation
  flags, synced encrypted like them, absent for unpinned chats.
- **Chat preview**: a transient, read-only view of the most recent messages of
  one chat; never persisted, never affects message/read state.

## Zero-Knowledge Impact *(constitution I)*

- **What crosses the wire**: nothing new. The pin arrangement is stored on the
  chat record, which already travels inside the encrypted own-data sync blob;
  the server keeps seeing one opaque ciphertext snapshot per account.
- **What is encrypted**: the arrangement (like the pinned flag itself) is
  sealed client-side under the user's keys before sync.
- **Unavoidably visible metadata**: unchanged — only blob size/timing of the
  existing own-data sync, which this feature does not alter in any observable
  way (one small numeric field on up to nine records).
- **Preview**: rendered entirely from local device data; opening it sends
  nothing (no read receipts, no media downloads it wouldn't already have).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A pinned chat's grid position never changes across 100% of
  message receipts/sends — only explicit user rearrangement moves it.
- **SC-002**: Users can move a pin from any slot to any other slot in a single
  gesture of under 3 seconds, and the result is visible immediately.
- **SC-003**: Rearrangements persist across a full app restart and appear on a
  second signed-in device after its next sync.
- **SC-004**: Pinning by drag is impossible past nine pins, and users get the
  forbidden-badge cue 100% of the time they try.
- **SC-005**: Opening the preview never marks a chat read and never triggers
  navigation unless the user taps inside the preview.

## Assumptions

- The nine-pin cap and its "You can only pin 9 chats." notice stay as they are
  (spec 1044); this feature adds order, not capacity.
- Pinned arrangement is per-account (synced), like the pinned flag itself —
  not per-device.
- The preview shows the latest messages (about the last screenful, most recent
  at the bottom) rendered from local data only; media shows as its existing
  list-preview label/thumbnail, not full players.
- Drag interactions target the main Chats tab in "All" view where the grid
  lives; search results and filter chips keep plain rows (today's behaviour),
  though the long-hold preview works everywhere rows exist.
- Mouse and touch both drive the same gestures (press-and-hold applies to
  both; desktop users may also keep using contextmenu/swipe surfaces).
- Existing pins at upgrade keep their current visual order until the user
  first rearranges them.
