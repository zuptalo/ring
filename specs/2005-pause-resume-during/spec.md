# Feature Specification: Video-message recording — stop & review before sending, clean start, right-sized, out of the gallery

**Feature Branch**: `fix/2005-pause-resume-during`

**Created**: 2026-06-22

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     Directory number sets the category (2001+ = hotfix/bug). -->

**Input**: A user reported that the "stop" button during video-message recording does
nothing. Investigation: the round video-note recorder shows a red square in its action
bar that looks like a stop control, but it is a decorative element with no behavior — and
there was no way to review a recording before it was sent (and it auto-sent at the max
length). The user chose the fix: tapping Stop must END the recording and let them WATCH IT
BACK, then explicitly Send or Retake — and a recording must never be sent without their
confirmation.

## Overview

Ring lets you record a round **video message** (hold the camera button in a chat). The
recorder fills a progress ring toward a maximum length. The action bar had a red square
that reads as the universal "stop recording" control — but it was inert, there was no way
to preview a take before sending, and reaching the max length auto-sent the clip. This
change makes **Stop** real: tapping it ENDS the recording and enters a **review** state
where the clip plays back so the user can watch it, then choose **Send** or **Retake**
(record again). Recording is a single continuous take; the clip is **never sent without an
explicit Send**, and the max-length limit **stops into review** instead of auto-sending.

While fixing the recorder, three adjacent video-message issues are corrected: (a) when the
camera opens, the preview briefly shows a scaled-down whole frame before it fills the round
window — the recorder must hide that initial render so the user only ever sees the framed
preview; (b) video messages are recorded at the camera's full default quality even though
they only ever play in a small in-chat circle (never fullscreen) — they must be captured at
a size/bitrate appropriate for that small circle; and (c) video messages appear in the
chat's "Media, links & docs" gallery, which doesn't fit their conversational, voice-message-
like nature — they must be excluded from that gallery (as voice messages already are).

## Bug & Root Cause

- **Symptom**: during video-message recording, tapping the red square (which looks like a
  stop button) has no effect; there is no way to watch a take back before it is sent, and
  reaching the max length sends the clip automatically.
- **Root cause**: the red square is a non-interactive decorative element — it was never
  wired to any stop behavior. The recorder only offered "send" (stop-and-send in one action)
  and "delete/cancel", with no review step, and the max-length handler called the same
  auto-send path. So a user could not stop to review and decide.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stop, review, then send or retake (Priority: P1)

While recording a video message, the user taps **Stop**. Recording ends and the recorder
enters a **review** state that plays the clip back so they can watch it. They then either
**Send** it or **Retake** (discard and record again). The clip is never sent until they tap
Send.

**Why this priority**: This is the reported broken control and the user's chosen fix — the
whole point of the change.

**Independent Test**: Record a clip, tap Stop, confirm it enters review and plays back,
confirm nothing is sent yet, then tap Send and confirm the clip is delivered.

**Acceptance Scenarios**:

1. **Given** a recording is in progress, **When** the user taps Stop, **Then** recording
   ends and the recorder enters review, playing the recorded clip back (no message sent).
2. **Given** the recorder is in review, **When** the user taps Send, **Then** that clip is
   sent as a single video message and the recorder closes.
3. **Given** the recorder is in review, **When** the user taps Retake, **Then** the clip is
   discarded and a fresh recording begins (nothing sent).

### User Story 2 - Review playback and controls are clear (Priority: P2)

The review state clearly offers watching the clip back (play/pause) plus Send and Retake,
and the recording state clearly offers a working Stop — each control reads correctly for
its state.

**Why this priority**: The original ▶-style glyph implied "play back" but resumed/ran the
recording; controls must mean what they show.

**Independent Test**: In recording, confirm a Stop affordance; after Stop, confirm a
play/pause-back control plus Send and Retake.

**Acceptance Scenarios**:

1. **Given** a recording is in progress, **When** the user looks at the control, **Then** it
   shows a Stop affordance (not a play/back glyph) and ends the recording when tapped.
2. **Given** the recorder is in review, **When** the user looks at the controls, **Then**
   they show a play/pause control that plays the clip back, plus distinct Send and Retake.

### User Story 3 - Nothing is sent without confirmation (Priority: P1)

A video message is only ever sent when the user explicitly taps Send — including when a
recording reaches the maximum length.

**Why this priority**: The reported failure was a clip auto-sending without review; this
must not be possible.

**Independent Test**: Record without tapping Send and confirm nothing is delivered; let a
recording reach the max length and confirm it stops into review (not sent); Cancel and
confirm nothing is delivered and the camera is released.

**Acceptance Scenarios**:

1. **Given** a recording in progress, **When** the user has not tapped Send, **Then** no
   video message is delivered.
2. **Given** a recording reaches the maximum length, **When** the limit is hit, **Then** the
   recording stops into review (it is NOT auto-sent).
3. **Given** a recording or review, **When** the user taps Cancel/close, **Then** the take
   is discarded, nothing is sent, and the camera is released.

### User Story 4 - The camera preview opens already framed (Priority: P2)

When the recorder opens, the user sees a black/countdown cover that gives way to a correctly
framed round preview — never a brief scaled-down whole-frame flash before it fills.

**Why this priority**: A visible glitch on every open; the existing countdown was meant to
hide it but races the camera and doesn't.

**Independent Test**: Open the recorder repeatedly and confirm the framed preview appears
without a scaled-down intermediate render.

**Acceptance Scenarios**:

1. **Given** the recorder is opening, **When** the camera has not yet produced a frame,
   **Then** the preview area stays covered (no scaled-down whole-frame render is shown).
2. **Given** the camera has produced its first frame, **When** the cover gives way,
   **Then** the preview is already framed to fill the round window.

### User Story 5 - Video messages are right-sized for in-chat playback (Priority: P2)

Video messages are captured at a size and bitrate suited to their small in-chat circle (they
never play fullscreen), so files stay small without visible loss at that display size.

**Why this priority**: Recording at full camera quality wastes storage/bandwidth for content
shown only in a ~200px circle.

**Independent Test**: Record a video message and confirm its captured resolution/bitrate are
materially below the camera's uncapped default while looking crisp in the in-chat circle.

**Acceptance Scenarios**:

1. **Given** a video message is recorded, **When** it is captured, **Then** its resolution
   and bitrate are constrained to a small-circle-appropriate target, not the camera default.
2. **Given** the constrained capture, **When** it plays in the chat, **Then** it looks crisp
   in the circle (no obvious quality regression at that size).

### User Story 6 - Video messages stay out of the media gallery (Priority: P2)

Video messages do not appear in the chat's "Media, links & docs" gallery and cannot be
opened in the fullscreen media viewer — they live in the conversation, like voice messages.

**Why this priority**: They are conversational/ephemeral; listing them in the gallery (and
allowing a fullscreen open they don't support well) is inconsistent with voice messages.

**Independent Test**: Send a video message, open the chat's media gallery, and confirm it is
not listed; confirm it cannot be opened in the fullscreen viewer.

**Acceptance Scenarios**:

1. **Given** a chat with video messages, **When** the user opens "Media, links & docs",
   **Then** video messages are not shown in the media grid (consistent with voice messages).
2. **Given** a video message in the conversation, **When** the user interacts with it,
   **Then** it plays inline only and does not open the fullscreen media viewer.

### Edge Cases

- **Max length reached**: at the maximum duration the recording stops INTO review (it is
  never auto-sent); the user still chooses Send or Retake.
- **Replay in review**: playing the clip back to its end and tapping play again replays it
  from the start; Send is available whether or not it has been played.
- **Retake**: discarding in review releases the prior clip and starts a fresh recording
  (new countdown), with no leaked object URLs or orphaned camera stream.
- **Cancel/close from recording or review**: discards the take, sends nothing, and releases
  the camera in both states.
- **Flip camera mid-recording**: switching front/back DURING a recording continues the same
  take — the clip keeps recording across the switch as one continuous video (no restart, no
  countdown), with no orphaned camera stream. Audio is uninterrupted across the flip.
- **Review playback with sound**: the recorded clip plays back with audio (un-mirrored, as
  the recipient will see it), distinct from the muted, mirrored live preview.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The video-message recorder MUST provide a working **Stop** control that ends
  the in-progress recording and enters a review state, replacing the non-functional red
  square.
- **FR-002**: In review, the recorder MUST play the recorded clip back and let the user
  play/pause (and replay) it before deciding.
- **FR-003**: In review, the user MUST be able to **Send** the clip (delivering a single
  video message and closing the recorder) or **Retake** (discard it and record again).
- **FR-004**: A video message MUST NOT be sent unless the user explicitly taps Send — there
  is no auto-send.
- **FR-005**: Controls MUST read correctly for their state: a Stop affordance while
  recording (not a play/back glyph), and a play/pause-back control plus Send and Retake in
  review.
- **FR-006**: Cancel/close MUST discard the take, send nothing, and release the camera from
  either the recording or the review state (no orphaned camera stream, no leaked clip).
- **FR-007**: Reaching the maximum recording length MUST stop the recording into review,
  NOT auto-send it.
- **FR-008**: Recording is a single continuous take; the reported elapsed time and the sent
  clip's duration MUST reflect the recorded length.
- **FR-009**: When the recorder opens, the preview MUST remain covered until the camera has
  produced its first frame, so the brief scaled-down whole-frame render is never visible; the
  countdown/reveal MUST begin only once the framed preview is available (with a sensible
  timeout fallback so a camera that never reports a frame doesn't hang the recorder).
- **FR-010**: Video messages MUST be captured at a resolution and bitrate targeted at their
  small in-chat circle (not the camera's uncapped default), keeping files small without an
  obvious quality regression at that display size.
- **FR-011**: Video messages MUST be excluded from the chat's "Media, links & docs" gallery
  (the media grid), consistent with how voice messages are already excluded.
- **FR-012**: Video messages MUST NOT be openable in the fullscreen media viewer; they play
  inline in the conversation only. (Already true in the chat bubble; FR-011's gallery change
  must not reintroduce a fullscreen entry point.)
- **FR-013**: The user MUST be able to flip the camera (front/back) DURING a recording and
  have the take continue as one continuous clip — the recording does not stop, restart, or
  re-run the countdown when the camera is switched, and audio is uninterrupted.

### Key Entities

- *(none — local, in-memory recorder UI state; no persisted data, no new stored entity.)*

## Zero-Knowledge Impact

*(Required by Constitution Principle I.)*

- **What new data becomes visible to the server?** None. This is a purely client-side change
  to the local media recorder's UI/controls and timing. The resulting video message is
  encrypted and sent exactly as today (same media pipeline); no client/server contract,
  payload, or stored data changes. The crypto/ZK checklist is therefore **not required**.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Tapping Stop during a recording ends it and enters review in 100% of cases,
  playing the recorded clip back.
- **SC-002**: No video message is delivered until the user taps Send — including when a
  recording reaches the maximum length (which stops into review, never auto-sends).
- **SC-003**: From review, Send delivers exactly the reviewed clip and Retake discards it
  and starts a fresh recording.
- **SC-004**: Controls read correctly for their state (a Stop affordance while recording;
  play/pause-back + Send + Retake in review) in 100% of cases.
- **SC-005**: Cancel/close from recording or review discards the take, sends nothing, and
  releases the camera, with no orphaned camera stream left running.
- **SC-006**: Opening the recorder never shows a scaled-down whole-frame flash before the
  framed preview — the preview area stays covered until the first camera frame.
- **SC-007**: A recorded video message's resolution/bitrate are constrained to the
  small-circle target (materially below the camera default), with no obvious quality loss in
  the in-chat circle.
- **SC-008**: Video messages do not appear in the chat's media gallery and cannot be opened
  in the fullscreen viewer (0 video-note entries in the media grid).
- **SC-009**: Flipping the camera during a recording continues the same take (recording stays
  active, the timer keeps advancing rather than resetting, no countdown reappears), and the
  delivered clip is a single continuous video spanning the switch.

## Assumptions

- Recording is a single continuous take (no mid-take pause/continue); Stop finalizes it for
  review. Review plays the finalized clip back from the recorded blob.
- The maximum recording length and the existing Flip/Cancel controls are kept; this change
  replaces the inert red square with a real Stop, adds the review (play-back) state with
  Send/Retake, and makes max-length stop into review instead of auto-sending. (The remaining
  Assumptions about quality and the gallery are unchanged.)
- No change to the recorded media format, the encryption, or the send path; only the
  capture size/bitrate (smaller) and the recorder's control flow change.
