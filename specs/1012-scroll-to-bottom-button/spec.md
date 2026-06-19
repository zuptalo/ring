# Feature Specification: Hovering "Scroll to Latest" Button in Chat

**Feature Branch**: `feat/1012-scroll-to-bottom-button`

**Created**: 2026-06-18

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Add a hovering scroll-to-bottom button to the chat detail
view. It floats just above the composer at the bottom (trailing side) of the message list,
is hidden while at/near the bottom, fades in once the user has scrolled up to read older
messages, and on tap smoothly returns to the newest message — fading away as the bottom is
reached, like WhatsApp/Telegram. Consider an optional unread-count badge for new messages
that arrived while scrolled up. Client-only, themed, LTR/RTL, accessible. A small enhancement
on top of spec 1011's chat scroll."

A small, self-contained UI affordance layered on spec 1011 (smooth chat-history scroll-up).
It adds **no new scroll mechanics** — it surfaces the existing "pinned to newest" state and
reuses the existing smooth jump-to-newest.

## Clarifications

### Session 2026-06-18

- Q: Should v1 ship the unread-count badge on the button (US2), or just the button? → A: Yes — ship the count badge.
- Q: When the badge is shown, what should it count? → A: Incoming messages only (your own sends, incl. from another device, do not increment it).
- Q: Where should tapping the button take the user? → A: The first unread message (the first incoming message received since the user left the bottom); when there are no unread, the newest message.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Jump back to the newest message after reading history (Priority: P1) 🎯 MVP

A user scrolls up to re-read or find an older message. A small floating button appears near
the bottom-trailing corner of the conversation, just above the composer. Tapping it returns
them to the newest message in one gesture. While they are already at the bottom, the button
is absent, so it never covers content when it isn't needed.

**Why this priority**: This is the core, universally-expected affordance (WhatsApp, Telegram,
Signal, iMessage all have it). Without it, getting back from deep history means a long manual
scroll — exactly the friction this removes. It is independently valuable and the MVP.

**Independent Test**: Open a long chat, scroll up ~a screen or more → the button fades in
above the composer on the trailing side; tap it → the view smoothly returns to the newest
message and the button fades out. Resting at the bottom shows no button.

**Acceptance Scenarios**:

1. **Given** the chat is resting at the newest message, **When** the view is idle, **Then** the button is not visible and occupies no tappable space.
2. **Given** the user scrolls up past the appear threshold, **When** they pause, **Then** the button fades in (≈200ms) anchored just above the composer on the trailing edge.
3. **Given** the button is visible, **When** the user taps it, **Then** the view smoothly scrolls to the newest message, auto-follow re-engages, and the button fades out as the bottom is reached.
4. **Given** the user scrolls back down manually (no tap), **When** the bottom is reached, **Then** the button fades out on its own.
5. **Given** the keyboard opens or a reply/edit bar appears, **When** the composer's height changes, **Then** the button stays just above the composer without overlapping it or the input.

---

### User Story 2 - See how many new messages arrived while reading history (Priority: P2)

While the user is scrolled up, new incoming messages do not yank the view (spec 1011). A small
count badge on the button shows how many new messages have arrived since the user left the
bottom, so they know there is something new without losing their place. Tapping the button
returns to the newest and clears the badge.

**Why this priority**: Useful but secondary — the button is valuable on its own. The badge
mirrors the new-message counter in WhatsApp/Telegram and is cleanly separable from US1.

**Independent Test**: Scroll up in a chat, have the peer send 3 messages → the button shows
"3"; tap it → the view returns to the newest and the badge clears. Messages received while
resting at the bottom never produce a badge.

**Acceptance Scenarios**:

1. **Given** the user is scrolled up and the button is visible, **When** N new incoming messages arrive, **Then** the button shows a count badge of N.
2. **Given** the badge shows a count, **When** the user activates the button, **Then** the view scrolls to the **first unread** message and the badge clears (the user can then continue down, or activate again to reach the newest).
3. **Given** the badge shows a count, **When** the user scrolls down to the bottom manually, **Then** the badge clears.
4. **Given** the user is resting at the bottom, **When** a new message arrives, **Then** no badge appears (it is already seen).
5. **Given** the user sends a message (or one of their own arrives from another device) while scrolled up, **When** it is added, **Then** the badge does not increment (it counts incoming only).
6. **Given** the count exceeds the display cap, **When** the badge renders, **Then** it shows a capped form (e.g. "99+").

---

### Edge Cases

- **Conversation fits one screen** (nothing to scroll): the button never appears.
- **Opened mid-history** (jump-to-date / reply-quote / starred-jump lands away from the bottom): the button appears and returns to the newest on tap.
- **Sending while scrolled up**: the existing jump-to-newest fires; the button hides and any badge clears (the user is now at the bottom).
- **Rapid fling across the boundary**: the show/hide is threshold-gated (hysteresis) so it does not strobe when the user hovers right at the appear/disappear line.
- **RTL layout**: the button sits on the trailing side consistent with the writing direction.
- **Outgoing messages while scrolled up** (e.g. from another device): do NOT increment the badge — it counts incoming only.
- **Activating with unread present**: the view lands on the **first unread** message (not the very bottom); the user can keep scrolling down, or activate the (now unread-free) button again to reach the newest.
- **Activating with no unread**: the view goes straight to the newest message.
- **Backgrounded / inactive view**: no visual work; the shown/hidden + count + boundary state is correct on return.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The chat view MUST present a single floating "scroll to latest" control, positioned above the composer on the trailing side of the message-list scroll area, whenever the conversation is scrolled away from the newest message.
- **FR-002**: The control MUST be hidden — and occupy no interactive space — while the view is at or near the newest message.
- **FR-003**: The control MUST fade in/out (not pop) as the at-bottom state changes, with a threshold/hysteresis that prevents flicker when the user lingers near the boundary.
- **FR-004**: Activating the control MUST scroll to the **first unread message** (the earliest incoming message received since the user left the bottom) when one or more unread messages exist, and to the **newest message** otherwise. Activation MUST clear the unread indicator. Reaching the bottom (whether by this action or continued scrolling) MUST re-enable auto-follow. The motion MUST use the same smooth scroll as the existing jump-to-newest.
- **FR-005**: The control MUST stay correctly positioned just above the composer as the composer height changes (keyboard open/close, reply/edit bar, multi-line input).
- **FR-006**: The control MUST NOT overlap or block the composer/input, the newest message's content, or its tap targets.
- **FR-007**: The control MUST be an accessible, clearly-labeled control (descriptive accessible name, adequate touch-target size, reachable by assistive tech) and MUST honor light/dark themes and LTR/RTL layout using existing theme tokens (no bespoke styling system).
- **FR-008** *(P2)*: While the user is scrolled up, the control MUST show a count of unread messages — **incoming** messages received since the user left the bottom. Outgoing messages (including the user's own sent from another device) MUST NOT increment it. The count MUST reset when the control is activated or when the user reaches the bottom by scrolling, MUST NOT appear for messages received while already at the bottom, and MUST render large counts in a capped form.
- **FR-009**: The control MUST be a purely local view affordance — it MUST NOT change message data, ordering, receipts/seen state, or any cross-device/wire/storage behavior.

### Key Entities *(include if feature involves data)*

- **Scroll-to-latest control (transient view state)**: `visible` (derived from the existing at-bottom/pinned state); `unreadCount` (P2 — incoming messages received since the user left the bottom); and an **unread boundary** marking where the user left the bottom, from which the **first unread** is the earliest incoming message. All of this is view-local to the session — no persistence, no wire representation, and independent of (and never modifying) the per-chat seen/unread receipts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From anywhere in a long conversation, a user returns to the newest message in a single tap (replacing repeated manual scroll gestures).
- **SC-002**: The control is never visible while the view rests at the newest message (it never covers content at the bottom).
- **SC-003**: The control appears within ≈200ms of the user leaving the bottom and disappears within ≈200ms of returning, with no visible flicker near the threshold.
- **SC-004**: The control stays clear of the composer/input in every composer state (keyboard open/closed, reply/edit bar) — no overlap observed.
- **SC-005** *(P2)*: When messages arrive while the user is scrolled up, the indicator accurately reflects how many **incoming** messages were received since they left the bottom and clears on activation or on returning to the bottom.
- **SC-006**: Activating the control with unread present lands the user on the first unread message (not the bottom) in a single action; with no unread, it lands on the newest message.
- **SC-007**: Behavior and appearance are correct in light/dark and LTR/RTL, and the control is labeled and reachable for assistive technology.
- **SC-008**: No change to message content, delivery, receipts, or any server/wire/storage behavior (zero-knowledge boundary untouched).

## Assumptions

- **Builds directly on spec 1011.** The chat view already tracks a "pinned to newest" /
  near-bottom state and a smooth `jump-to-newest`; this feature surfaces that state and reuses
  that motion rather than adding any new scroll/anchor logic.
- **Appear threshold.** "Near the bottom" reuses the existing pinned-to-newest threshold; the
  *appear* threshold may be slightly larger (≈ one viewport) so the button does not flash for
  tiny scrolls. Exact value finalized in planning.
- **Tap target = the first unread message** when unread exist (the earliest incoming message
  received since the user left the bottom), otherwise the newest message. "Unread" here is
  **view-local to the session** (messages that arrived while scrolled up) — it is independent
  of, and never modifies, the persistent seen/unread receipts. A persistent unread-divider
  line is not required by this spec; the tap simply lands on the first unread message.
- **The P2 badge counts incoming messages received while scrolled up** (outgoing/own-device
  sends excluded), is independent of the per-chat unread/seen counters used elsewhere, and
  does not modify them.
- **Client-only, single view** (`ChatDetailPage`): no server, wire, storage, or DB-schema
  change. Per the constitution — zero-knowledge boundary untouched (Principle I), Ionic-first
  UI with theme tokens (Principle XI), accessibility & i18n preserved (Principle X), and TDD +
  quality gates apply (Principles III/VII).
- **1:1 and group chats behave identically.**
- **Scope boundary**: this spec covers only the floating control and its optional badge. It
  does not change history loading, eviction, media, receipts, or any other chat behavior.
