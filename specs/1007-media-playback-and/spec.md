# Feature Specification: Media Playback & Embedded Thumbnails

**Feature Branch**: `feat/1007-media-playback-and`

**Created**: 2026-06-16

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "The viewer's bottom thumbnails still don't fully use the generated thumbnail. We should generate the video thumbnail on the SENDER's device and embed it in the message, so the receiver does no thumbnail work and just shows it — with a play button baked in / overlaid, white play on a dark thumbnail and black play on a bright one. Sliding between media should fully STOP playback of the video you slide away from (no background video playback), but keep that video's progress at the position it was when you scrolled away so it resumes there. Audio messages / music should KEEP playing when you navigate away (not on loop), and we should offer quick pause/play + stop — either in the top toolbar if space allows, or a hovering audio controller like the hovering group-call UI."

## Overview

Three media-playback improvements:

1. **Sender-embedded video thumbnails.** Today a video poster may be generated on
   the *receiver* (bounded since spec 2002), but the viewer's thumbnail strip and
   bubbles still sometimes lack a poster. Generating the thumbnail on the **sender**
   and embedding it in the message means the receiver never generates anything — it
   just shows the embedded image — with a **contrast-aware play affordance** (light
   play glyph on dark thumbnails, dark glyph on bright ones).
2. **Stop video on slide-away, keep position.** In the full-screen viewer, sliding
   to another item must fully **stop** the previous video (no audio/CPU in the
   background), while **remembering its position** so returning resumes where you
   left off. Only the on-screen video may play.
3. **Persistent, non-looping audio with quick controls.** Voice messages / music
   should keep playing when you navigate away from the chat (it's audio — leaving
   the view shouldn't cut it), but must **not loop**, and the user needs a
   quick **pause/play + stop** reachable from anywhere — via a **hovering audio
   mini-controller** (mirroring the existing hovering call UI), which fits the
   pattern better than crowding the toolbar.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Receiver shows a sender-made thumbnail, no local generation (Priority: P1)

A received video shows its thumbnail immediately (everywhere it appears: bubble,
album grid, viewer strip, Media grid) from a poster the sender embedded — the
receiver generates nothing. The play affordance is clearly visible against the
thumbnail regardless of its brightness.

**Acceptance Scenarios**:

1. **Given** a received video message, **When** it renders anywhere a thumbnail is
   shown, **Then** it uses the sender-embedded poster and the receiver runs no video
   decode/poster generation for it.
2. **Given** a dark vs a bright thumbnail, **When** the play affordance is drawn,
   **Then** it has clear contrast (light glyph on dark, dark glyph on bright).
3. **Given** a legacy/old message with no embedded poster, **When** it renders,
   **Then** the existing bounded receiver-side generation (2002) is the fallback.

---

### User Story 2 - Sliding away stops the video and keeps its position (Priority: P1)

In the viewer, when I slide from a playing video to another item, the first video
stops completely (no background audio or decoding), and if I slide back it resumes
from where I left it.

**Acceptance Scenarios**:

1. **Given** a playing video, **When** I slide to the next/previous item, **Then**
   the first video stops (paused, no audio, not decoding in the background).
2. **Given** I slid away mid-playback, **When** I slide back to it, **Then** it is
   at the position it was when I left (ready to resume there, not reset to 0).
3. **Given** any slide, **When** it settles, **Then** at most the on-screen video is
   active; no off-screen video plays.

---

### User Story 3 - Audio keeps playing across navigation, with quick controls (Priority: P2)

Playing a voice message or music and then leaving the chat keeps the audio going
(not looping); a hovering audio controller appears with play/pause and stop so I can
control it from anywhere, and it goes away when playback stops/ends.

**Acceptance Scenarios**:

1. **Given** audio is playing, **When** I navigate away from the chat/message,
   **Then** the audio continues (it does not stop), and it does not loop when it ends.
2. **Given** audio is playing, **When** I look at the app, **Then** a hovering audio
   controller (like the minimized-call UI) shows the track with pause/play + stop.
3. **Given** the hovering controller, **When** I tap stop (or it ends), **Then**
   playback ends and the controller disappears; pause/play toggles without losing
   position.
4. **Given** I start a different audio, **When** it begins, **Then** only one audio
   plays at a time (the previous is replaced/stopped), never two at once.

### Edge Cases

- Switching from audio to a video (or starting a call) must not leave two audio
  sources playing; define precedence (a call/voice-note interaction supersedes music).
- Leaving the viewer entirely (closing it) stops any video (US2 applies on close too).
- A bright thumbnail with a busy center: the play affordance must stay legible
  (e.g. a subtle scrim behind the glyph) — contrast is guaranteed, not best-effort.
- Embedded poster size must stay small (it rides in the E2EE message) — bounded
  dimensions/quality so messages don't bloat.
- Background audio must respect leaving the app / lock as the platform dictates
  (don't fight the OS), and must end cleanly on logout/lock.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The sender MUST generate a small video thumbnail and embed it in the
  message; receivers MUST render that embedded thumbnail everywhere a video
  thumbnail appears, performing no local poster generation when one is present.
- **FR-002**: When no embedded poster exists (legacy messages), the receiver MUST
  fall back to the bounded generation from spec 2002.
- **FR-003**: The play affordance over a video thumbnail MUST be contrast-aware
  (light on dark thumbnails, dark on bright), guaranteed legible (scrim if needed).
  Prefer an Ionic/CSS overlay computed from the thumbnail's luminance over baking
  pixels into the JPEG (keeps it themeable/accessible; Constitution XI).
- **FR-004**: In the viewer, sliding away from a video MUST stop it fully — paused,
  muted-to-silent, not decoding in the background; only the on-screen video may be
  active.
- **FR-005**: A video's playback position MUST be retained when slid away so sliding
  back resumes from that position (not reset).
- **FR-006**: Closing the viewer MUST stop any playing video.
- **FR-007**: Audio (voice messages / music) MUST continue playing when the user
  navigates away from its message/chat, and MUST NOT loop on end.
- **FR-008**: A hovering audio controller (consistent with the minimized-call UI)
  MUST appear while audio plays, offering pause/play and stop, and disappear when
  playback ends/stops.
- **FR-009**: At most one audio source plays at a time; starting another replaces
  the previous. Call audio takes precedence over media audio.
- **FR-010**: The embedded poster MUST be size-bounded (dimensions + quality) so it
  doesn't bloat the E2EE message payload.
- **FR-011**: All UI MUST use stock Ionic components + existing theme tokens; the
  hovering controller mirrors the existing minimized-call component (Constitution XI).

## Zero-Knowledge Impact *(mandatory)*

- **Embedded thumbnail**: the sender's poster rides **inside the E2EE message**
  payload (like the existing `posterData`), so it's encrypted end-to-end exactly as
  the media is; the server sees only ciphertext. It slightly increases message size
  (bounded by FR-010). No new server-visible metadata.
- **Playback / audio controller**: purely client-side; no wire/server/data-model
  change. Emoji/usage-style local prefs not involved here.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A received video renders its thumbnail with zero receiver-side poster
  generation when the sender embedded one (instrumented/verified); legacy fallback
  still works.
- **SC-002**: The play affordance is legible on both dark and bright thumbnails
  (contrast check).
- **SC-003**: After sliding away from a video, no off-screen video is playing or
  decoding (no background audio); sliding back resumes at the retained position.
- **SC-004**: Audio keeps playing across navigation, never loops, and is controllable
  (pause/play/stop) from the hovering controller anywhere in the app; only one audio
  plays at once.

## Assumptions

- Sender-side poster generation already exists (`generateVideoPoster` + an embedded
  `posterData` on send); this spec makes it the authoritative path and ensures all
  receiver surfaces consume it, with 2002's bounded generation as the legacy
  fallback only.
- The viewer currently keeps current±1 videos mounted (so the slid-away one can keep
  playing); the fix pauses/teardowns non-current videos while preserving each one's
  `currentTime`.
- A persistent audio service (single shared `<audio>`/element) + a hovering
  controller component (modeled on `MinimizedCall.vue`) is the right structure;
  background audio follows platform behavior and ends on logout/lock.
- Contrast-aware overlay (luminance sampled from the thumbnail) is preferred over a
  baked-in glyph; the baked-in idea was considered but rejected for theming/a11y.
