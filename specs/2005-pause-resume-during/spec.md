# Feature Specification: Pause/resume during video-message recording

**Feature Branch**: `fix/2005-pause-resume-during`

**Created**: 2026-06-22

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     Directory number sets the category (2001+ = hotfix/bug). -->

**Input**: A user reported that the "stop" button during video-message recording does
nothing. Investigation: the round video-note recorder shows a red square in its action
bar that looks like a stop/pause control, but it is a decorative element with no
behavior. By contrast, the voice-message recorder has a working Pause/Resume control. The
user confirmed the symptom (the red square does nothing) and chose the fix: the control
should pause and resume the same recording, matching the voice recorder.

## Overview

Ring lets you record a round **video message** (hold the camera button in a chat). The
recorder fills a progress ring toward a maximum length and offers Delete and Send. Between
them sits a red square that reads as the universal "stop recording" control — but it is
inert, so tapping it does nothing. Meanwhile the **voice-message** recorder already lets
you Pause a take (halting capture and the timer) and Resume it, then Send. This change
gives the video recorder the same working **Pause/Resume** control: a single tap pauses the
in-progress take (freezing the elapsed time and the progress ring), another tap resumes the
same take, and Send finalizes and sends from either state.

## Bug & Root Cause

- **Symptom**: during video-message recording, tapping the red square (which looks like a
  stop button) has no effect; the recording cannot be paused.
- **Root cause**: the red square is a non-interactive decorative element — it was never
  wired to any pause/stop behavior (it has been decorative since the feature was first
  added). The recorder offers only "send" (which stops and sends in one action) and
  "delete/cancel"; there is no way to pause and continue a take the way the voice recorder
  allows.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pause and resume a video-message recording (Priority: P1)

While recording a video message, a user taps the stop/pause control to pause the take; the
elapsed time and the progress ring stop advancing. They tap it again to resume the SAME
take, and the elapsed time and ring continue from where they left off. They then send the
combined recording.

**Why this priority**: This is the reported broken control and the user's chosen fix — the
whole point of the change.

**Independent Test**: Start a video recording, pause it, confirm the timer/ring freeze,
resume, confirm they continue, and send a single clip that includes footage from before and
after the pause.

**Acceptance Scenarios**:

1. **Given** a video recording is in progress, **When** the user taps the pause control,
   **Then** recording pauses, the elapsed time stops advancing, and the progress ring stops
   filling.
2. **Given** the recording is paused, **When** the user taps the control again, **Then** the
   same recording resumes and the elapsed time and ring continue from where they paused (not
   restarted, not jumped forward by the paused duration).
3. **Given** the recording was paused and resumed one or more times, **When** the user taps
   Send, **Then** a single video message is sent containing the footage from all recorded
   segments, with a duration equal to the recorded time (excluding paused gaps).

### User Story 2 - The control clearly reflects paused vs. recording (Priority: P2)

The control visibly indicates its current state, so the user knows whether tapping it will
pause or resume — consistent with how the voice recorder shows its Pause/Resume state.

**Why this priority**: Without a clear state cue the user can't tell if they're paused;
this is the difference between a control that "works" and one that's merely wired up.

**Independent Test**: Observe the control while recording vs. paused and confirm it shows a
distinct, understandable state in each.

**Acceptance Scenarios**:

1. **Given** a recording is in progress, **When** the user looks at the control, **Then** it
   indicates that tapping will pause (a stop/pause affordance).
2. **Given** the recording is paused, **When** the user looks at the control, **Then** it
   indicates that tapping will resume (a resume affordance), and there is a clear paused
   indication distinct from the actively-recording state.

### User Story 3 - Send and delete work from either state (Priority: P2)

Send and Delete behave correctly whether the recording is currently recording or paused.

**Why this priority**: A pause control that breaks send/delete would be a worse bug than the
one being fixed; finalizing from a paused state must work.

**Independent Test**: Pause a recording, then (a) Send and confirm the clip is sent, and
separately (b) Delete and confirm the take is discarded with nothing sent.

**Acceptance Scenarios**:

1. **Given** a paused recording, **When** the user taps Send, **Then** the recorded clip is
   finalized and sent (no further user step required).
2. **Given** a paused recording, **When** the user taps Delete/Cancel, **Then** the take is
   discarded, nothing is sent, and the camera is released.

### Edge Cases

- **Auto-stop at max length**: the recorder finalizes at a maximum duration; that maximum
  must count only RECORDED time, so a paused recording does not auto-send while paused and
  does not lose recorded time to the paused gap.
- **Pause then immediately send**: sending right after pausing (without resuming) must still
  produce a valid clip of the recorded duration.
- **Multiple pause/resume cycles**: repeated pause/resume in one take must keep the elapsed
  time and ring accurate (the sum of recorded segments).
- **Flip camera / cancel while paused**: switching camera or cancelling from a paused state
  must behave the same as from a recording state (current take discarded / restarted), with
  no orphaned camera stream.
- **Pause/resume unsupported by the platform**: on a platform that cannot pause a recording
  mid-take, the control must degrade gracefully rather than corrupt the recording (see
  Assumptions; the voice recorder already relies on the same capability on supported
  platforms).
- **Live preview while paused**: the camera preview may keep showing the live camera while
  paused; pausing affects only what is recorded, not the preview.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The video-message recorder MUST provide a working control that pauses an
  in-progress recording and resumes the SAME recording, replacing the current non-functional
  red square.
- **FR-002**: While paused, the recorder MUST stop advancing the elapsed time and the
  progress ring; on resume it MUST continue them from where they paused.
- **FR-003**: The reported elapsed time and the duration of the sent video MUST reflect only
  recorded time, excluding paused gaps.
- **FR-004**: A video message sent after one or more pause/resume cycles MUST contain the
  footage from all recorded segments as a single playable clip.
- **FR-005**: The control MUST visibly indicate its current state — actively recording
  (tap to pause) vs. paused (tap to resume) — consistent with the voice recorder's pattern.
- **FR-006**: Send MUST finalize and send the recording from either the recording or the
  paused state; Delete/Cancel MUST discard the take and release the camera from either state.
- **FR-007**: The automatic finalize at the maximum recording length MUST be driven by
  recorded time only, so a paused recording is not auto-finalized while paused.
- **FR-008**: The behavior SHOULD match the voice-message recorder's Pause/Resume semantics
  for consistency across the two recorders.

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

- **SC-001**: Tapping the pause control during a video recording pauses it in 100% of cases
  on supported platforms (the timer and ring stop), and tapping again resumes the same take.
- **SC-002**: After pausing for any duration and resuming, the elapsed time and sent-clip
  duration equal the total RECORDED time, with the paused gap excluded (verified to within a
  small rounding tolerance).
- **SC-003**: A clip sent after one or more pause/resume cycles plays back as a single video
  containing all recorded segments.
- **SC-004**: The control shows a distinct, correct state for recording vs. paused in 100%
  of cases.
- **SC-005**: Send and Delete succeed from the paused state (clip sent / take discarded and
  camera released), with no orphaned camera stream left running.

## Assumptions

- The platform's media recording supports pause/resume of an in-progress recording. The
  voice-message recorder already uses this successfully on the user's platform, so video can
  rely on the same capability; where it is unsupported the control degrades gracefully
  (Edge Cases) rather than producing a corrupt clip.
- "Pause" halts capture only; the live camera preview may continue to display the camera
  feed while paused (freezing the preview is not required).
- The maximum recording length and the existing Delete/Send/Flip/Cancel controls are kept;
  this change adds the pause/resume control and corrects the elapsed-time accounting around
  pauses.
- No change to the recorded media format, the encryption, or the send path; the only output
  difference is that a clip may now consist of multiple recorded segments from one take.
