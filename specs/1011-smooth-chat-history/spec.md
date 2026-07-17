# Feature Specification: Smooth Chat-History Scroll-Up (verified by a multi-user end-to-end exercise)

**Feature Branch**: `feat/1011-smooth-chat-history`

**Created**: 2026-06-17

**Status**: shipped
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
result is occasional jumping/unsmoothness when scrolling up. The whole conversation
is also held in memory and re-read on every change, so very long histories get heavy.

This feature makes scroll-up **smooth and continuous at any history length**: only the
rows around the viewport are rendered (older/newer rows are prepared ahead of need and
evicted when far off-screen), history is read in bounded batches rather than all at
once, and pages appear without moving the content under the user's view. To prove it —
and to give us a repeatable, realistic confidence check on the whole messaging
experience — it also delivers a **multi-user end-to-end exercise** that spins up
several users, connects them, holds real 1:1 and group conversations across every
message kind (text, voice/audio, video messages, image and video uploads), builds a
lengthy history, and then scrolls back through it to validate the smoothness.

This is a **client-only** change (chat view + data-access + its verification harness).
It does not touch the wire, the server, or any stored ciphertext.

## Zero-Knowledge Impact

This feature is **client-only** and leaves the zero-knowledge boundary untouched
(Constitution Principle I):

- **What crosses the wire**: nothing new. No request, payload, header, or metadata is
  added or changed. History is already on the device; this feature only changes how the
  existing local rows are read (bounded batches), rendered (a bounded window), and kept
  in place during scroll.
- **What is encrypted / decrypted**: nothing new. Messages remain stored as they are
  today; the bounded reads return the same already-decrypted-for-render `Message` rows
  the chat view already uses. No new key use, and no new plaintext is produced or persisted.
- **What metadata is unavoidably visible to the server**: none introduced. The server
  sees no read positions, scroll state, window bounds, or batch sizes — all of that is
  local-only in-memory / IndexedDB state.
- **Why**: the change lives entirely in the client render / data-access layer
  (`ChatDetailPage.vue`, a new `useChatHistory` composable, bounded reads in `queries.ts`,
  and a dev-only test hook). It never touches `messaging.ts`, the wire, the server, or any
  stored ciphertext, and makes no `DB_VERSION`/schema change. The `/speckit-checklist`
  zero-knowledge gate has been run for this spec (checklists/zero-knowledge.md) and confirms
  Principle I is unaffected.

## Clarifications

### Session 2026-06-17

- Q: How large must a conversation stay perfectly smooth on a mid-range device? →
  A: **~5,000+ messages** — adopt true virtual scrolling (render only on-screen rows
  plus a small buffer) backed by bounded/cursor reads of history, so the whole chat is
  never held in the view or memory at once.
- Q: Include jump-to-older navigation (tap a reply-quote / starred message above the
  loaded window → smoothly scroll to it)? → A: **Yes** — in scope (User Story 3).
- Q: What counts as "no jump" for the anchored message when older content loads? →
  A: **≤ 2px** of drift.
- Q: On very long scroll-backs, should older rendered rows be evicted to bound
  memory/DOM? → A: **Yes** — evict far-off-screen rows (both directions) so the
  rendered DOM and memory stay flat regardless of scroll distance.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Smooth scroll-up through a long conversation (Priority: P1)

A user opens a conversation with a long history and scrolls upward to re-read older
messages. As they scroll, older messages are already prepared, so the scroll never
stalls at a loading boundary; and as those older messages take their place above, the
message the user was looking at stays put — the view never jumps, snaps, or stutters.
This holds whether they scroll slowly or flick quickly, in both 1:1 and group chats
(where avatars and grouped media can change row heights), and at any history length.

**Why this priority**: This is the headline value and the explicit ask — scrolling up
through history must feel continuous and natural. Everything else verifies or supports it.

**Independent Test**: Open a chat with several hundred messages, scroll/flick upward
across many pages of history, and observe that the anchored message stays in place
(≤2px) and the scroll never halts waiting for older messages to load.

**Acceptance Scenarios**:

1. **Given** a conversation longer than one screen of history, **When** the user
   scrolls up so older messages load, **Then** the message they were viewing remains
   at the same on-screen position (≤2px drift; no visible jump).
2. **Given** the user flicks upward quickly, **When** they approach the top of the
   currently loaded messages, **Then** the next batch of older messages is already in
   place so the scroll continues without stalling or snapping.
3. **Given** the user is mid-flick (momentum scrolling) when a batch loads, **When**
   the older messages are inserted, **Then** the momentum is not interrupted — no
   stutter, teleport, or abrupt stop.
4. **Given** a new message or reaction arrives while the user is reading history,
   **When** it is applied, **Then** the user keeps reading from exactly the same place —
   their view does not jump to the newest message. (The normative rule is FR-004,
   verified by SC-004.)
5. **Given** a group chat where older runs introduce sender avatars or collapsed
   media albums, **When** those older messages load, **Then** the resulting row-height
   differences do not cause a jump.
6. **Given** a 5,000-message history, **When** the user scrolls far back and forth,
   **Then** the app stays responsive throughout, no matter how far back they scroll.
   (The bounded-rendering mechanism behind this is FR-012, measured by SC-008.)

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
loaded window and confirm the view scrolls to that message (within ~1.0s) rather than
showing a "not available" message.

**Acceptance Scenarios**:

1. **Given** a reply whose quoted message is older than what's loaded, **When** the
   user taps the quote, **Then** the older message is brought into view smoothly.
2. **Given** a starred message older than the loaded window, **When** the user jumps
   to it, **Then** it is reached without an error.

---

### Edge Cases

- **Fast upward fling** on a very long chat: a quick flick must not outrun the
  look-ahead — the prefetch distance has to absorb fling velocity so there is no
  stall/snap at the boundary (the requirement itself is FR-002, verified by SC-003).
- **Media decoding mid-load**: an image/video poster in or near the anchored row
  decoding (and growing) between frames must not skew the anchor and cause a jump.
- **New message / reaction / status update while reading history**: must not move the
  viewport; the rendered list updating must not visibly re-shuffle or jump.
- **Anchored message deleted/edited** between frames during a load: must degrade
  gracefully (still no jump) rather than mis-correct the position.
- **Evicted anchor**: if the row used to preserve position is evicted while off-screen,
  the mechanism must still keep the viewport stable (use a still-rendered reference).
- **Scrolling back DOWN after scrolling far up**: returning toward the newest must be
  smooth too, re-rendering evicted newer rows without a jump.
- **Keyboard opens / view resizes** during scroll: must not fight the user's gesture
  (relies on the existing Ionic keyboard/resize handling — no new logic; manually
  smoke-checked mid-flick in T032).
- **Group vs 1:1**: avatars and album collapsing change row heights as older runs
  mount — both must stay smooth.
- **Backgrounded / locked chat**: scroll side-effects must not run while the view
  isn't visible (normative requirement FR-014).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When older messages load during an upward scroll, the message currently
  in view MUST remain at the same on-screen position (≤2px drift; no perceptible jump).
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
  anchored message's on-screen position is preserved within 2px and that the next older
  page is present before the top edge is reached.
- **FR-011**: All existing chat behaviors (sending, receipts/seen, reactions,
  disappearing messages, jump-to-newest on send, search) MUST continue to work
  unchanged; this feature only changes how history is prepared/rendered and how the
  viewport is preserved.
- **FR-012**: The rendered rows and memory MUST stay bounded regardless of how far the
  user scrolls — only rows near the viewport (plus a buffer) are rendered; far
  off-screen rows are evicted. Scrolling a 5,000+ message history MUST stay responsive.
- **FR-013**: Reading history MUST NOT require loading the entire conversation into
  memory at once; messages are read in bounded batches (by recency/position) as the
  user scrolls.
- **FR-014**: Scroll side-effects (look-ahead / load-older / load-newer, eviction, and
  any anchor-driven scroll-position correction or reactive list update) MUST NOT run
  while the chat view is not visible (backgrounded tab, locked screen, or navigated
  away) — preserving the app's existing visibility-gated behavior so the view is never
  silently scrolled while the user cannot see it.

### Key Entities *(include if feature involves data)*

- **Conversation history**: the full ordered set of a chat's messages (oldest →
  newest); now read in bounded batches rather than all at once. No change to how it's
  stored at rest.
- **Rendered window**: the bounded set of rows currently rendered around the viewport
  (on-screen plus a small buffer); rows far off-screen (in either direction) are
  evicted so the rendered DOM and memory stay bounded.
- **Older-message page**: a bounded batch of older messages prepared/added as the user
  scrolls up; its arrival must be invisible to the viewport (position-preserving).
- **Scroll anchor**: the reference message used to keep the viewport stable across a
  page load; must remain valid even if some rows are evicted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can scroll from the newest message back to the start of a
  conversation of at least 200 messages in continuous gestures with no visible jump
  and no stall at a loading boundary. Verified by an automated exercise.
- **SC-002**: When an older page loads during scroll-up, the anchored message's
  on-screen position changes by no more than **2px** — effectively "stays put". Verified.
- **SC-003**: The next older page is present before the user reaches the top edge of
  the loaded content (there is never a frame at the top with more history unrendered).
  Verified.
- **SC-004**: A new message, reaction, or status update arriving while the user reads
  history never moves the viewport. Verified.
- **SC-005**: The multi-user exercise runs end-to-end and confirms every message kind
  (text, voice/audio, video message, image upload, video upload) is delivered to and
  renders for all participants across 1:1 and group chats. Verified.
- **SC-006**: Tapping a reply/starred reference older than the loaded window brings the
  target into view within **1.0 second** (on a mid-range device), with no "not available"
  outcome for an on-device message. Verified.
- **SC-007**: Scrolling up across several pages on a mobile-emulated device shows
  continuous content — no blank flash, no snap, day-dividers and avatars rendering in
  place. This is a **supplementary** visual check (screenshots via the UI-driving
  harness), not a blocking CI gate; the blocking acceptance is the measurable invariants
  in SC-002/003/004/008. Verified by inspection.
- **SC-008**: Scrolling through a 5,000-message history keeps the rendered row count
  and memory bounded (they do not grow with scroll distance) and the app stays
  responsive throughout. Verified.

*Mapping* (SC are the user-facing outcomes; INV are the implementation contracts in
contracts/chat-history.md §3 that the tests assert). The direct pairs:
SC-002 = INV-1 (≤2px anchor), SC-003 = INV-2 (page-before-top), SC-004 = INV-4 (no-yank),
SC-006 = INV-6 (seek), SC-008 = INV-3 (bounded DOM/memory). The remainder are intentionally
not 1:1:
- **SC-001** is composite — a continuous-scroll exercise that confirms INV-1 + INV-2 + INV-3
  + INV-4 together end-to-end (verified by the US2 exercise T023/T024).
- **SC-005** is orthogonal to scroll mechanics — it is the multi-user delivery/render proof
  (US2) and maps to no scroll INV.
- **SC-007** verifies **INV-7** (group-row edge — avatars/day-dividers do not flicker).
- **INV-5** (no momentum fight) is a defensive guard with no primary user-facing SC; its
  *logic* is unit-tested (T005/T010) and its *fling feel* is confirmed manually (T032).

## Assumptions

- Adopts virtual scrolling (render only on-screen rows plus a small buffer, evicting
  off-screen rows in both directions) backed by bounded/cursor reads of history —
  extending the current windowed render + anchor-and-restore rather than loading the
  whole chat into the view/memory (per Clarifications: ~5,000+ messages must stay smooth).
  The full approach rationale and the adversarial comparison of alternatives are the
  source of truth in research.md (decisions D1–D9); this section only summarizes them.
- The verification exercise is realized through the project's existing UI-driving
  capability (the `drive/` harness + the dev-only test hook) and automated end-to-end
  coverage where practical; media uses test fixtures.
- "Lengthy chat" means at least ~200 messages for the scroll exercise; smoothness with
  bounded memory is targeted up to 5,000+ messages on a mid-range device.
- "No jump" means ≤ 2px of anchor drift (per Clarifications).
- The rendered set is bounded by evicting off-screen rows (both directions), so DOM and
  memory stay flat regardless of scroll distance (per Clarifications).
- Older pages are prepared on scroll proximity (look-ahead) by default; proactive
  idle-time preloading is an optional enhancement, not required.
- Roster, receipts, reactions, and all other messaging behaviors are unchanged; this
  is purely about history preparation/rendering and viewport stability.
- Client-only: no server, wire, or stored-ciphertext change — zero-knowledge boundary
  untouched. The `/speckit-checklist` zero-knowledge gate was run (checklists/zero-knowledge.md);
  see Complexity & Exceptions.

## Complexity & Exceptions

- **`/speckit-checklist` gate (Constitution gate-sequencing + Principle I).** The
  constitution requires `/speckit-checklist` for any spec *touching* Principle I or IV.
  Although this feature is client-only and asserts the zero-knowledge boundary is
  **untouched**, the gate has been **run** (not waived) —
  [checklists/zero-knowledge.md](./checklists/zero-knowledge.md) — matching the precedent of
  the client-only specs 1009 and 1010. All 14 checklist items pass: nothing new crosses or
  changes the client↔server boundary, no new plaintext / keys / server-visible metadata, and
  no schema change. Principle IV (crypto) is untouched, so no crypto checklist applies.
