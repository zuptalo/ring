# Feature Specification: App-wide UX polish and fixes

**Feature Branch**: `feat/1025-app-ux-polish`

**Created**: 2026-07-01

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: a collection of nine independent UX polish items and bug fixes across
notifications, the media viewer, settings, hidden chats, disappearing messages, and the calls area.

## Overview

A batch of small, mostly independent quality fixes that make Ring feel more like a native app and
remove rough edges found during real-device use. Each item is a standalone slice: any one can be
built, tested, and shipped on its own. All changes stay within Ring's zero-knowledge boundary. The
server keeps relaying only sealed ciphertext and content-free push tickles; nothing here adds
server-visible plaintext.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Back from a notification deep-link lands home, not on a blank view (Priority: P1)

The app is fully closed. A push notification arrives and the user taps it, and the app cold-starts
directly onto the target: a chat message, a Wall post, a friend request, a "request accepted"
screen, an app-update prompt, or an incoming call. When the user then presses or swipes Back, they
must land on the Chats list (the app's home), never on a blank browser view or an empty page.

**Why this priority**: This is the worst current break. A cold-started deep link has no history
behind it, so Back dead-ends the user on a blank view and feels broken. It affects the most common
re-entry path into the app.

**Independent Test**: Fully close the app, deliver each notification type, tap it to deep-link in,
then press Back and confirm the Chats list appears every time.

**Acceptance Scenarios**:

1. **Given** the app is fully closed, **When** the user taps a new-message notification and then presses Back, **Then** the Chats list is shown (not a blank view).
2. **Given** the app is fully closed, **When** the user taps a Wall-post notification and then presses Back, **Then** the Chats list is shown.
3. **Given** the app is fully closed, **When** the user taps a friend-request or request-accepted notification and then presses Back, **Then** the Chats list is shown.
4. **Given** the app is fully closed, **When** the user taps an app-update notification and then presses Back, **Then** the Chats list is shown.
5. **Given** the app is fully closed, **When** the user answers or dismisses an incoming call reached from a notification and then presses Back, **Then** the Chats list is shown.

---

### User Story 2 - Notification previews respect the global toggle and always protect hidden chats (Priority: P1)

A user with the "Show preview" option turned off should never see message content on the lock
screen or in in-app notifications; only a generic notice appears. Regardless of that global setting,
a hidden (PIN-locked) chat must always behave with the most protective rules: its notifications stay
generic and never reveal sender, content, or that a hidden conversation exists.

**Why this priority**: Preview leakage is a privacy regression, and hidden chats are Ring's
strongest privacy promise. Hidden-chat protection must win over any general preview preference.

**Independent Test**: Toggle "Show preview" on and off and confirm previews appear/disappear for
normal chats; then send into a hidden chat with preview on and confirm the notification stays
generic.

**Acceptance Scenarios**:

1. **Given** "Show preview" is off, **When** a message arrives in a normal chat, **Then** the notification shows a generic notice with no sender or content.
2. **Given** "Show preview" is on, **When** a message arrives in a normal chat, **Then** the notification shows the sender and a content preview.
3. **Given** "Show preview" is on, **When** a message arrives in a hidden chat, **Then** the notification is still generic and reveals nothing about the hidden chat.

---

### User Story 3 - Hidden-chat rows reveal their swipe actions cleanly (Priority: P2)

After entering the PIN and revealing hidden chats, the user swipes a hidden-chat row left or right.
The action buttons underneath appear immediately, and the row's name, avatar, date, and eye icon
stay on an opaque background that slides cleanly over the buttons, so the buttons are only visible in
the revealed area and never bleed through under the row content (today the near-transparent hidden
row lets the buttons show through and the content looks like it floats on top of them).

**Why this priority**: The current reveal is visually broken (buttons bleed through the translucent
row), which undermines confidence in a sensitive, PIN-gated area.

**Independent Test**: Unlock hidden chats, swipe a row both directions, and confirm the buttons show
immediately and the row content sits on an opaque background with no bleed-through.

**Acceptance Scenarios**:

1. **Given** hidden chats are revealed, **When** the user swipes a hidden-chat row, **Then** the underlying action buttons are visible immediately.
2. **Given** a row is swiped open, **When** the user looks at it, **Then** the name, avatar, date, and eye icon sit on an opaque background and the buttons are only visible in the revealed area (no bleed-through).

---

### User Story 4 - The media viewer shows a properly sized video poster (Priority: P2)

Opening the chat media viewer and swiping between items, a video should display a full-frame poster
image (with a play control), matching how photos fill the viewer, instead of a tiny thumbnail
floating in a large blank area. Every context in the app (bubble, album grid, media strip,
full-screen viewer) should use the correctly sized image already carried by the message so nothing
looks under-scaled.

**Why this priority**: The tiny, blank-surrounded video poster looks unfinished and unlike a native
gallery. It is highly visible whenever a video is viewed.

**Independent Test**: Send a video, open it in the viewer, swipe to it among other media, and confirm
its poster fills the frame like a photo, at crisp resolution.

**Acceptance Scenarios**:

1. **Given** a video message, **When** it is shown in the full-screen viewer, **Then** its poster fills the available frame with a centered play control and no large blank margins.
2. **Given** media in different contexts (bubble, grid, strip, viewer), **When** each renders, **Then** it uses an appropriately sized thumbnail tier so it looks crisp and correctly scaled.

---

### User Story 5 - The disappearing countdown is spaced and placed sensibly (Priority: P2)

On a disappearing message, the time-left indicator has clear separation from the timestamp. For
incoming messages the countdown sits to the right of the timestamp (for outgoing it stays where it
reads best), so the two never crowd each other.

**Why this priority**: A small but constant readability issue on disappearing messages.

**Independent Test**: Send and receive disappearing messages and confirm spacing and side placement.

**Acceptance Scenarios**:

1. **Given** any disappearing message, **When** it renders, **Then** there is visible spacing between the timestamp and the countdown.
2. **Given** an incoming disappearing message, **When** it renders, **Then** the countdown appears to the right of the timestamp.

---

### User Story 6 - The Calls area shows ISO dates, swapped actions, and usage totals (Priority: P2)

In the Calls list and a call's detail, dates read in an ISO-style `YYYY-MM-DD` format. On the call
detail, the Video and Message action buttons swap positions (Video takes Message's place and vice
versa). A totals summary shows the combined minutes of audio calls, the combined minutes of video
calls, and the data used for audio, for video, and combined.

**Why this priority**: Consistent dates and honest usage totals improve trust and utility; the
button swap matches the user's preferred layout.

**Independent Test**: Place audio and video calls, then open the Calls list and a detail and confirm
the date format, button order, and the minute and data totals.

**Acceptance Scenarios**:

1. **Given** call history, **When** the Calls list and detail render dates, **Then** dates use `YYYY-MM-DD`.
2. **Given** a call detail, **When** the action buttons render, **Then** Video and Message are swapped relative to today.
3. **Given** completed audio and video calls, **When** the totals summary renders, **Then** it shows total audio minutes, total video minutes, and data used for audio, video, and combined.

---

### User Story 7 - One Animations setting that actually works (Priority: P3)

Settings has a single "Animations" control (the duplicate is removed), and turning it off measurably
reduces or disables non-essential motion across the app.

**Why this priority**: Two controls for the same thing is confusing, and a setting that does nothing
erodes trust. Lower priority because it is cosmetic.

**Independent Test**: Confirm only one Animations control exists, toggle it, and observe motion
change accordingly.

**Acceptance Scenarios**:

1. **Given** Settings, **When** the user looks for Animations, **Then** exactly one Animations control exists.
2. **Given** Animations is turned off, **When** the user navigates the app, **Then** non-essential animations are suppressed.

---

### User Story 8 - No dead Vibrate control (Priority: P3)

If in-app vibration cannot be triggered reliably from the PWA on Ring's supported platforms, the
Vibrate toggle is removed from In-app notifications so users are not offered a control that does
nothing.

**Why this priority**: A non-functional toggle is misleading, but low impact.

**Independent Test**: Confirm the Vibrate toggle is gone from In-app notifications (given the
platform limitation), and the surrounding settings still render cleanly.

**Acceptance Scenarios**:

1. **Given** the platform cannot vibrate in-app, **When** the user opens In-app notifications, **Then** no Vibrate toggle is present and no empty gap or dangling row remains.

---

### User Story 9 - Tidy Help screen (Priority: P3)

The Help screen keeps a clean version line, and the "Run self-test" action is removed if it does not
perform a meaningful, user-visible check.

**Why this priority**: Removes clutter and a possibly misleading control. Low impact.

**Independent Test**: Open Help and confirm the version line reads cleanly and no non-functional
self-test control remains (or, if kept, it produces a meaningful result).

**Acceptance Scenarios**:

1. **Given** the Help screen, **When** it renders, **Then** the version line is present and tidy.
2. **Given** "Run self-test" does nothing meaningful, **When** Help renders, **Then** that control is removed.

### Edge Cases

- Deep-link Back when the app was NOT cold-started (already open with history): normal Back behavior is preserved; only the no-history cold-start case is forced home.
- A deep-link target that no longer exists (post expired, chat deleted, call already ended): the app still resolves to a sensible screen and Back still reaches the Chats list.
- "Show preview" changed while a chat is open or a notification is pending: the next notification reflects the new setting; hidden-chat protection is never affected.
- A video message whose poster tier is missing on an older message: it still shows a reasonable poster (backfilled or derived) rather than a tiny image.
- Calls with zero duration or an interrupted connection: totals count them consistently (a defined rule) and do not double-count.
- No call history yet: the totals summary shows zeros or is hidden gracefully (no broken layout).

## Requirements *(mandatory)*

### Functional Requirements

**Notification deep-link back navigation (US1)**

- **FR-001**: When the app cold-starts from a tapped notification directly onto a deep-link target, the navigation history MUST be seeded so that Back resolves to the Chats list.
- **FR-002**: FR-001 MUST apply to every notification-driven deep link: new chat message, Wall post, new friend request, friend-request-accepted, app-update prompt, and incoming call.
- **FR-003**: Back from a cold-start deep link MUST NEVER present a blank view, an empty page, or the external browser.
- **FR-004**: When the app is already open with real history, Back MUST retain its normal behavior (this requirement does not force home in that case).

**Notification previews and hidden-chat precedence (US2)**

- **FR-005**: The "Show preview" setting MUST control whether message sender and content appear in notifications, end to end, for normal chats.
- **FR-006**: A hidden (PIN-locked) chat MUST always use the most protective notification behavior (generic, no sender, no content, no indication a hidden chat exists), regardless of the "Show preview" setting.
- **FR-007**: Hidden-chat precedence MUST hold across both background (system) notifications and in-app notifications.

**Hidden-chat swipe actions (US3)**

- **FR-008**: Swiping a revealed hidden-chat row left or right MUST reveal the underlying action buttons immediately.
- **FR-009**: While a hidden-chat row is swiped open, its name, avatar, date, and eye icon MUST render on an opaque background so the action buttons are only visible in the revealed area and do not bleed through under the row content.

**Media viewer video poster (US4)**

- **FR-010**: The full-screen media viewer MUST display a video's poster at a size that fills the available frame (matching photo presentation), with a centered play control and no large blank margins.
- **FR-011**: Each message MUST carry the set of thumbnail tiers needed so the app can select the correctly sized image per context (bubble, album grid, media strip, full-screen viewer) without re-deriving it at view time.
- **FR-012**: Media presentation across contexts MUST look crisp on high-density displays (use a tier at least as large as the render size).

**Disappearing countdown placement (US5)**

- **FR-013**: A disappearing message MUST show clear visible spacing between the timestamp and the time-left countdown.
- **FR-014**: For incoming disappearing messages, the countdown MUST appear to the right of the timestamp.

**Calls area (US6)**

- **FR-015**: The Calls list and call detail MUST format dates in ISO-style `YYYY-MM-DD`.
- **FR-016**: On the call detail, the Video and Message action buttons MUST swap positions relative to the current layout.
- **FR-017**: The Calls area MUST show a totals summary: total audio-call minutes, total video-call minutes, and data used for audio, for video, and combined.
- **FR-018**: The totals MUST be derived on-device from call records and MUST NOT require any new server-visible data.

**Settings cleanup (US7, US8, US9)**

- **FR-019**: Settings MUST expose exactly one "Animations" control (the duplicate removed), and it MUST be the single source of truth.
- **FR-020**: Turning "Animations" off MUST suppress non-essential motion across the app; turning it on MUST restore it.
- **FR-021**: If in-app vibration cannot be triggered from the PWA on supported platforms, the Vibrate toggle MUST be removed from In-app notifications, leaving no empty section or dangling row.
- **FR-022**: The Help screen MUST retain a tidy version line, and the "Run self-test" control MUST be removed if it performs no meaningful, user-visible check.

**Cross-cutting**

- **FR-023**: All changes MUST preserve Ring's zero-knowledge boundary: no new plaintext is sent to or stored on the server, and push tickles remain content-free.

### Key Entities *(include if feature involves data)*

- **Call record**: An existing per-call entry (kind audio or video, start time, duration, and, where available, bytes transferred) used to compute the Calls totals. No new server-side field is introduced.
- **Media thumbnail tiers**: The set of preview sizes already associated with a media message (for example bubble, grid, strip, poster) that the app selects among per context.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of cold-start notification deep-link cases (all six types), pressing Back lands on the Chats list and never on a blank view or the browser.
- **SC-002**: With "Show preview" off, 0% of normal-chat notifications reveal sender or content; with it on, previews appear. In 100% of hidden-chat cases the notification stays generic regardless of the setting.
- **SC-003**: Swiping a revealed hidden-chat row shows its action buttons with no perceptible delay, with the row content on an opaque background and no button bleed-through.
- **SC-004**: A video in the full-screen viewer fills at least the same frame proportion as a photo of the same aspect ratio, with no tiny-thumbnail blank margins, on a high-density display.
- **SC-005**: Every disappearing message shows measurable spacing between timestamp and countdown, and incoming messages place the countdown to the right of the timestamp 100% of the time.
- **SC-006**: The Calls list and detail show `YYYY-MM-DD` dates, the swapped button order, and totals that match the sum of the underlying call records (audio minutes, video minutes, and data per kind and combined).
- **SC-007**: Exactly one Animations control exists and toggling it visibly changes motion; no Vibrate toggle remains where the platform cannot vibrate; the Help screen shows a tidy version with no non-functional self-test.

## Assumptions

- "The Chats list is the app home" is the correct Back destination for all cold-start deep links (matches Ring's tab structure).
- In-app vibration is not reliably available from the PWA on Ring's primary target (installed PWA on iOS, and constrained on others), so the Vibrate toggle is expected to be removed; the plan phase confirms this per platform before removing.
- Call data-usage bytes are available on-device from existing call statistics; if a given historical call lacks byte data, its data contribution is treated as zero (minutes still count).
- Duration and data totals are computed over the call records already stored on the device (no retroactive server fetch).
- The media thumbnail tiers introduced in prior media specs already exist for new messages; older messages may need an on-device backfill of the missing tier rather than a new capture.
- The "totals summary" lives in the Calls area (list header or a dedicated summary row); exact placement is a design detail resolved during planning.
- Disappearing-message rendering, hidden-chat gating, notification infrastructure, and the settings schema are reused as-is; this spec changes their presentation and wiring, not their security model.
