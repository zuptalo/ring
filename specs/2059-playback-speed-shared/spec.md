# Feature Specification: Playback speed belongs to the message you set it on

**Feature Branch**: `fix/2059-playback-speed-shared`

**Created**: 2026-07-29

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User report: "Changing the playback speed on one voice message apparently changes it for
every voice message, please make sure it remains per message and video"

## Context: why this hotfix exists

Speeding up one long voice message should not speed up the short one underneath it. Today it does —
and the same control gets the opposite bug on video, where the speed you chose is thrown away the
moment you look at something else.

Two different causes, one user-visible promise broken in both directions:

- **Voice messages and shared audio files share ONE speed.** The playback rate is a single
  app-wide value, and every voice bubble reads it directly rather than reading its own. Set 2× on
  one message and every voice message in every chat — plus every shared-audio card, and every voice
  post on the Wall — immediately reads 2×. Nobody chose that for those messages.
- **Video throws the speed away.** A video's rate lives only in the player instance that is
  currently mounted. The media viewer keeps one player per item and only mounts the one you are
  looking at (and its immediate neighbours), so swiping to the next video and back silently resets
  you to 1×. The viewer already remembers your scrub *position* per item, which makes the speed
  being forgotten look like an oversight rather than a decision.

The unifying principle: **playback speed is a property of the thing being played.** You set it on a
message; it stays on that message, and it does not leak onto anything else.

## Clarifications

### Session 2026-07-29

- Q: Should a message's playback speed survive closing and reopening the app? → A: **Session only.**
  The speed sticks to the message while the app is open and resets to normal on a fresh launch.
  Nothing is written to the database — no per-message write on every pill tap, and no stored
  preference for messages the user may never open again. This matches how the media viewer already
  treats scrub position, and it keeps the fix entirely inside the playback layer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Setting a voice message's speed leaves other messages alone (Priority: P1)

Someone sends a long rambling voice message and a short one. The recipient speeds up the long one
to get through it, then plays the short one — at normal speed, because they never asked for
anything else.

**Why this priority**: This is the reported defect. It is also the one that actively surprises
people: a control on one message silently reaches across every conversation in the app.

**Independent Test**: Set 2× on one voice message, then look at another voice message in the same
chat and in a different chat — both still show 1× and play at 1×.

**Acceptance Scenarios**:

1. **Given** two voice messages, **When** the speed of the first is changed, **Then** the second
   still shows and plays at normal speed.
2. **Given** a voice message set to 2× in one chat, **When** the user opens a different chat with
   voice messages, **Then** those show normal speed.
3. **Given** a voice message set to 2×, **When** the user plays that same message again, **Then**
   it is still 2× — the choice belongs to the message and is not forgotten.
4. **Given** a shared audio file (a music track) and a voice message, **When** the speed of one is
   changed, **Then** the other is unaffected.

---

### User Story 2 - A video keeps the speed you gave it (Priority: P1)

Someone watching a long clip at 1.5× swipes to the next item in the viewer and back. The clip is
still at 1.5×.

**Why this priority**: Same promise, same control, and the user asked for it explicitly. It is the
mirror image of User Story 1 — there the setting spreads too far, here it does not survive at all —
so fixing only one half would leave the control still behaving unpredictably.

**Independent Test**: Set 1.5× on a video in the viewer, swipe to another item and back, and
confirm it is still 1.5×; confirm the other video is at normal speed.

**Acceptance Scenarios**:

1. **Given** a video playing at 1.5×, **When** the user swipes to another item and returns,
   **Then** the video is still at 1.5×.
2. **Given** a video set to 1.5×, **When** the user opens a different video, **Then** that one
   plays at normal speed.
3. **Given** a video set to 1.5×, **When** the user closes the viewer and reopens that video,
   **Then** it is still 1.5×.

---

### User Story 3 - Wall voice posts each keep their own speed (Priority: P2)

Voice posts in the Wall feed behave like voice messages in a chat: speeding one up leaves the
others alone.

**Why this priority**: the Wall feed uses the same player as chat, so it has the same bug for the
same reason and is fixed by the same change. It is listed separately because it is a second surface
that must be checked, not because it needs different work.

**Independent Test**: Set 2× on one voice post in the feed and confirm another voice post below it
still reads 1×.

**Acceptance Scenarios**:

1. **Given** two voice posts in the feed, **When** one is set to 2×, **Then** the other still reads
   normal speed.
2. **Given** an album post containing several voice items, **When** one item's speed is changed,
   **Then** the other items in the same album are unaffected.

> **Two surfaces deliberately out of scope**, both checked in the source rather than assumed:
> the **floating audio controller** has no speed control at all, and a voice post's **own detail
> page** plays through the browser's native audio element (with the browser's own speed menu), not
> through our player. Neither shows our speed pill, so neither has this bug and neither is changed
> here. Bringing the detail page onto our player would be a separate piece of work.

---

### Edge Cases

- **Changing the speed of a message that is not the one currently playing**: the change applies to
  that message for when it is played, and must not disturb whatever is playing right now.
- **Changing the speed mid-playback**: takes effect immediately on the audio you are hearing,
  without restarting it or losing your position.
- **A message deleted, or its media removed to free space, after a speed was set for it**: the
  remembered speed is harmless — a number under an id nothing will ask for again, which the cap in
  FR-009 eventually reclaims. Message ids are never reused, so it cannot resurface elsewhere.
- **Very many messages given non-default speeds**: remembering a speed per message must not grow
  without bound (FR-009).
- **An album post with several voice items**: each item is its own playable thing and keeps its
  own speed. The Wall already gives each album slide a distinct player id for exactly this reason —
  that id is what the speed hangs off.
- **The draft-recording preview** in the composer has its own speed control for a recording that is
  not yet a message. It has no message id and is unaffected by this change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Playback speed MUST be remembered per message, not shared across messages.
- **FR-002**: Changing the speed of one message MUST NOT change the displayed or effective speed of
  any other message, in any chat or on the Wall.
- **FR-003**: A message with no speed ever chosen for it MUST play and display at normal speed.
- **FR-004**: A message whose speed was changed MUST still be at that speed the next time it is
  played within the same session, unless its entry has been displaced by the bound in FR-009.
  Displacement MUST favour the messages the user actually engages with: **playing a message, or
  changing its speed, counts as using it**. Merely having it on screen does not — a speed that is
  only being *displayed* is not evidence the user cares about that message.
- **FR-005**: Changing the speed while a message is playing MUST take effect immediately on the
  audio being heard, without interrupting it or losing position.
- **FR-006**: Changing the speed of a message that is NOT currently playing MUST NOT alter the
  playback of whatever is currently playing.
- **FR-007**: Video playback speed MUST be remembered per video and MUST survive the player being
  torn down and rebuilt — swiping away and back, or closing and reopening the viewer.
- **FR-008**: Every surface that renders our speed control for a given item MUST show the same
  value for it — the chat voice bubble, the shared-audio card, the Wall feed voice player, and the
  media viewer's video control row. (Surfaces that show no speed control — the floating audio
  controller, a voice post's own detail page, a video's chat-bubble poster — are unaffected.)
- **FR-009**: Remembered speeds MUST be capped at **200 entries**; beyond that, the entry least
  recently *used* (per FR-004's definition of use) is dropped. A dropped message simply returns to
  normal speed. This also means a deleted message's remembered speed cannot linger indefinitely.
- **FR-010**: The change MUST NOT alter what is sent, stored on the server, or observable to it —
  it is local playback preference only.

### Key Entities

- **Playback speed**: a per-message playback rate chosen by the user from the existing set of
  speeds. Absent for a message means normal speed. Device-local, never sent anywhere.

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

**What crosses the wire**: nothing. This is a local playback preference for how *this device*
renders media it already holds.

- **Sending**: unchanged. No new field in any sealed payload, no new request.
- **New state**: a per-message playback rate held on the device. It is never sent to the server,
  never own-data-synced, and never derived from anything the server provides. (Own-data sync
  carries only contacts, chats and chat lists, so it cannot pick this up even accidentally.)
- **Metadata visible to the server**: unchanged. The server cannot observe playback at all; media
  bytes are fetched once and played locally, and changing a rate issues no request.
- **Crypto surface**: untouched. No key handling, no primitive, no at-rest change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Setting a non-default speed on one message changes the speed shown on exactly one
  message — zero other messages change, across chats and the Wall.
- **SC-002**: A message returned to within a session plays at the speed it was last given, 100% of
  the time.
- **SC-003**: A video returned to after swiping away, or after closing and reopening the viewer,
  is at the speed it was given, 100% of the time.
- **SC-004**: Changing speed mid-playback keeps playing from the same position — no restart, no
  audible gap.
- **SC-005**: After giving non-default speeds to 250 different messages, at most 200 are
  remembered, and the 200 most recently used are the ones kept.
- **SC-006**: The reporter's scenario — change the speed on one voice message, look at another —
  shows the second one unchanged.

## Assumptions

- **Remembered for the session, not persisted to disk.** A speed is a transient "how I want to get
  through this particular message" choice, not a durable property of the conversation. Persisting
  it would mean a database write on every pill tap and a stored preference for messages the user
  may never open again. If people turn out to expect it to survive a restart, that is a follow-up
  rather than part of this fix.
- The available speeds and the pill's appearance are unchanged — this is about which message the
  chosen speed applies to, not about the control itself.
- Round video notes have no speed control today and gain none here.
- The 200-entry cap in FR-009 is far above any realistic session's worth of deliberate speed
  changes while still being a hard ceiling. Nothing depends on the exact number; it exists so the
  structure cannot grow without limit.

## Complexity & Exceptions

*Governance requires a waived or unmet **MUST** to be recorded here and accepted by a maintainer.*

| # | Principle / rule | Status | Detail |
|---|---|---|---|
| E-1 | **Development Workflow — supply-chain scan at the start of new work** (MUST) | ✅ **Waived by maintainer, 2026-07-29** | The Docker Scout report for the current `zuptalo/ring` tag was not reviewed — no Docker Hub access in the working environment. Maintainer waived the gate for this spec on the basis that it is a client-only change touching no Go module and no base image, so it carries no dependency surface the scan could flag, and undertook to run the scan before the release PR. The obligation moves to the release, it is not dropped. |
| E-2 | **Development Workflow — version bump at the start of a release cycle** (MUST) | ✅ Addressed | `develop` is at 1.0.32 with tag `v1.0.32` cut, so this is the first change of a new cycle. Carried as a task. |
