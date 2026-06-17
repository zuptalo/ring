# Feature Specification: Smooth Chat-History Scroll-Up (verified by a multi-user end-to-end exercise)

**Feature Branch**: `feat/1011-smooth-chat-history`

**Created**: 2026-06-17

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Run the server locally, create 5 users, connect them (request + accept), create 1:1 and group chats, chat with text / audio / video messages and image + video uploads, build a lengthy chat and verify everything works between them and feels smooth and correct; then open a lengthy chat, scroll up, observe how infinite scroll behaves, and adjust it so older messages are prepared in good time and scrolling up to older content is smooth without jumping around or unsmoothness."

## Overview

Reading back through a long conversation should feel like reading a page — you flick
upward and older messages are simply *there*, with the line you were looking at
staying exactly where it was. Today Ring already renders a moving window of the
newest messages and tries to keep the viewport anchored when older ones load, but
older messages are only fetched the moment the user hits the top of what's loaded —
so a quick upward flick can outrun the load and produce a brief stall followed by a
snap, and the load can momentarily fight the device's own scroll momentum. The
result is occasional jumping/unsmoothness when scrolling up.

This feature makes scroll-up **smooth and continuous**: older messages are prepared
ahead of need, and they appear without moving the content under the user's view. To
prove it — and to give us a repeatable, realistic confidence check on the whole
messaging experience — it also delivers a **multi-user end-to-end exercise** that
spins up several users, connects them, holds real 1:1 and group conversations across
every message kind (text, voice/audio, video messages, image and video uploads),
builds a lengthy history, and then scrolls back through it to validate the smoothness.

This is a **client-only** change (chat view + its verification harness). It does not
touch the wire, the server, or any stored ciphertext.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Smooth scroll-up through a long conversation (Priority: P1)

A user opens a conversation with a long history and scrolls upward to re-read older
messages. As they scroll, older messages are already prepared, so the scroll never
stalls at a loading boundary; and as those older messages take their place above, the
message the user was looking at stays put — the view never jumps, snaps, or stutters.
This holds whether they scroll slowly or flick quickly, and in both 1:1 and group
chats (where avatars and grouped media can change row heights).

**Why this priority**: This is the headline value and the explicit ask — scrolling up
through history must feel continuous and natural. Everything else verifies or supports it.

**Independent Test**: Open a chat with a few hundred messages, scroll/flick upward
across several pages of history, and observe that the anchored message stays in place
(no jump) and the scroll never halts waiting for older messages to load.

**Acceptance Scenarios**:

1. **Given** a conversation longer than one screen of history, **When** the user
   scrolls up so older messages load, **Then** the message they were viewing remains
   at the same on-screen position (no visible jump).
2. **Given** the user flicks upward quickly, **When** they approach the top of the
   currently loaded messages, **Then** the next batch of older messages is already in
   place so the scroll continues without stalling or snapping.
3. **Given** the user is mid-flick (momentum scrolling) when a batch loads, **When**
   the older messages are inserted, **Then** the momentum is not interrupted — no
   stutter, teleport, or abrupt stop.
4. **Given** a new message or reaction arrives while the user is reading history,
   **When** it is applied, **Then** the user's viewport is not yanked (auto-follow to
   the newest only happens when they were already at the bottom).
5. **Given** a group chat where older runs introduce sender avatars or collapsed
   media albums, **When** those older messages load, **Then** the resulting row-height
   differences do not cause a jump.

---

### User Story 2 - Realistic multi-user exercise proves the chat works end-to-end (Priority: P1)

A repeatable exercise drives the real app as ~5 users: each sends connection requests
and the others accept; they form 1:1 and group chats; and they hold realistic
conversations exchanging every message kind — text, voice/audio messages, video
messages, image uploads, and video uploads — building a lengthy history. The exercise
confirms that messages and media are delivered, rendered, and reciprocated correctly
between all participants and that the experience feels smooth and correct, then opens
a lengthy chat and scrolls up to validate User Story 1.

**Why this priority**: It is both the proof for the scroll work and a broad,
re-runnable smoke test of connecting, messaging, media, and groups — high confidence
for low ongoing cost, and exactly the scenario the user asked to build.

**Independent Test**: Run the exercise against a local stack; confirm all 5 users
connect, the 1:1 and group conversations contain each message kind delivered to every
participant, the media renders, and the lengthy chat opens and scrolls back smoothly.

**Acceptance Scenarios**:

1. **Given** 5 fresh users, **When** the exercise connects them via request + accept,
   **Then** each intended pair is connected and can message.
2. **Given** connected users, **When** they exchange text, voice/audio, video
   messages, image uploads, and video uploads in 1:1 and group chats, **Then** every
   message and its media is delivered to, and renders correctly for, all intended
   participants.
3. **Given** a lengthy chat built by the exercise, **When** it is opened and scrolled
   upward, **Then** the scroll-up smoothness from User Story 1 is observed and asserted.
4. **Given** the exercise has run once, **When** it is run again, **Then** it sets up
   from scratch with no manual steps and leaves the environment clean afterward.

---

### User Story 3 - Jumping to older-than-loaded content stays smooth (Priority: P2)

A user taps a reply-quote (or opens a starred message) whose original is older than
the currently loaded window. The app brings that older message into view smoothly —
loading whatever history is needed to reach it — instead of failing or reporting that
the message isn't available.

**Why this priority**: It's a real "scroll up to older content" smoothness gap, but
secondary to the primary scroll gesture; valuable polish that completes the story.

**Independent Test**: In a long chat, tap a reply that quotes a message far above the
loaded window and confirm the view scrolls to that message rather than showing a
"not available" message.

**Acceptance Scenarios**:

1. **Given** a reply whose quoted message is older than what's loaded, **When** the
   user taps the quote, **Then** the older message is brought into view smoothly.
2. **Given** a starred message older than the loaded window, **When** the user jumps
   to it, **Then** it is reached without an error.

---

### Edge Cases

- **Fast upward fling** on a very long chat: the next page must already be present
  before the top is reached (no stall, no snap).
- **Media decoding mid-load**: an image/video poster in or near the anchored row
  decoding (and growing) between frames must not skew the anchor and cause a jump.
- **New message / reaction / status update while reading history**: must not move the
  viewport; the rendered list updating must not visibly re-shuffle or jump.
- **Anchored message deleted/edited** between frames during a load: must degrade
  gracefully (still no jump) rather than mis-correct the position.
- **Keyboard opens / view resizes** during scroll: must not fight the user's gesture.
- **Very long histories**: memory and rendered-DOM growth must stay bounded enough to
  remain smooth on a mid-range device.
- **Group vs 1:1**: avatars and album collapsing change row heights as older runs
  mount — both must stay smooth.
- **Backgrounded / locked chat**: scroll side-effects must not run while the view
  isn't visible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When older messages load during an upward scroll, the message currently
  in view MUST remain at the same on-screen position (no perceptible jump).
- **FR-002**: Older messages MUST be prepared ahead of need so that scrolling upward
  — including a fast flick — does not stall waiting at a loading boundary.
- **FR-003**: Any automatic scroll adjustment performed while loading older messages
  MUST NOT interrupt or fight the user's in-progress momentum scroll (no stutter,
  teleport, or abrupt stop).
- **FR-004**: While the user is reading history (not at the bottom), a newly arriving
  message, reaction, or status update MUST NOT move their viewport; the view follows
  the newest message only when the user is already at the bottom.
- **FR-005**: Scroll-up smoothness MUST hold for both 1:1 and group conversations,
  including where sender avatars and collapsed media albums change row heights.
- **FR-006**: Tapping a reply-quote or opening a starred message that is older than the
  currently loaded window MUST bring that message into view (loading the intervening
  history as needed) rather than failing.
- **FR-007**: Media (images, videos, voice/video messages) MUST render correctly for
  every recipient and MUST NOT cause the scroll position to drift when it decodes.
- **FR-008**: The project MUST provide a repeatable exercise that creates ~5 users,
  connects them via request + accept, forms 1:1 and group chats, exchanges text,
  voice/audio, video messages, image uploads, and video uploads, builds a lengthy
  chat, and verifies correct delivery, rendering, and reciprocation between all
  participants.
- **FR-009**: The exercise MUST drive the real application UI/flows (not bypass them),
  be runnable repeatedly with no manual setup, and leave the environment clean afterward.
- **FR-010**: Smoothness MUST be verifiable automatically — e.g. asserting that the
  anchored message's on-screen position is preserved within the agreed tolerance and
  that the next older page is present before the top edge is reached.
- **FR-011**: All existing chat behaviors (sending, receipts/seen, reactions,
  disappearing messages, jump-to-newest on send, search) MUST continue to work
  unchanged; this feature only changes how older history is prepared and how the
  viewport is preserved.

### Key Entities *(include if feature involves data)*

- **Conversation history**: the full ordered set of a chat's messages (oldest →
  newest); the source the rendered window draws from. No change to how it's stored.
- **Rendered window**: the contiguous slice of the newest N messages currently shown;
  grows toward older messages as the user scrolls up.
- **Older-message page**: a batch of older messages added to the rendered window when
  scrolling up; its arrival must be invisible to the viewport (position-preserving).
- **Scroll anchor**: the reference message used to keep the viewport stable across a
  page load.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can scroll from the newest message back to the start of a
  conversation of at least 200 messages in continuous gestures with no visible jump
  and no stall at a loading boundary. Verified by an automated exercise.
- **SC-002**: When an older page loads during scroll-up, the anchored message's
  on-screen position changes by no more than a small, imperceptible tolerance
  (see Assumptions) — effectively "stays put". Verified.
- **SC-003**: The next older page is present before the user reaches the top edge of
  the loaded content (there is never a frame at the top with more history unrendered).
  Verified.
- **SC-004**: A new message, reaction, or status update arriving while the user reads
  history never moves the viewport. Verified.
- **SC-005**: The multi-user exercise runs end-to-end and confirms every message kind
  (text, voice/audio, video message, image upload, video upload) is delivered to and
  renders for all participants across 1:1 and group chats. Verified.
- **SC-006**: Tapping a reply/starred reference older than the loaded window brings the
  target into view within ~1 second, with no "not available" outcome for an on-device
  message. Verified.
- **SC-007**: Scrolling up across several pages on a mobile-emulated device shows
  continuous content — no blank flash, no snap, day-dividers and avatars rendering in
  place. Verified by inspection (screenshots) via the UI-driving harness.

## Assumptions

- Builds on the existing approach (a windowed render of the newest messages with an
  anchor-and-restore on prepend) rather than introducing a new list/virtualization
  subsystem; the change prepares older pages earlier and hardens the position-preserve.
- The verification exercise is realized through the project's existing UI-driving
  capability (the `drive/` harness + the dev-only test hook) and automated end-to-end
  coverage where practical; media uses test fixtures.
- "Lengthy chat" means at least ~200 messages for the scroll exercise; smoothness is
  targeted for typical histories up to ~1,000 messages on a mid-range device. Larger
  histories (5,000+) may warrant additional optimization treated as out of scope here.
- "No jump" is interpreted as ≤ ~2px of anchor drift (imperceptible); the exact
  tolerance is confirmed during clarification.
- Older pages are prepared on scroll proximity (look-ahead) by default; proactive
  idle-time preloading is an optional enhancement, not required for v1.
- The rendered window grows toward older messages for the session and is not required
  to shrink/evict older rows in v1 (bounded-DOM eviction is a possible later refinement).
- Roster, receipts, reactions, and all other messaging behaviors are unchanged; this
  is purely about history preparation and viewport stability.
- Client-only: no server, wire, or stored-ciphertext change — zero-knowledge boundary
  untouched (no `/speckit-checklist` required on that basis).

## Open product decisions (for `/speckit-clarify`)

These have reasonable defaults above but materially affect scope and should be confirmed:

1. The largest history that must stay smooth on a low-end device (decides whether
   windowing + look-ahead is sufficient or whether bounded/cursor reads + true virtual
   scrolling are needed).
2. The exact "no jump" tolerance (0px vs ≤2px) — sets the acceptance threshold.
3. Whether jump-to-older navigation (reply/starred above the window, User Story 3) is
   in scope here or a separate spec.
4. Whether older rendered rows should ever be evicted to bound DOM on very long
   scroll-backs.
5. Whether older pages should also be preloaded proactively while idle, or only on
   scroll proximity.
