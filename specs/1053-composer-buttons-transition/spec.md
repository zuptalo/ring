# Feature Specification: Composer Buttons Transition Like WhatsApp

**Feature Branch**: `feat/1053-composer-buttons-transition`

**Created**: 2026-07-14

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User request (2026-07-14, two WhatsApp screen recordings, dark + light):
"Can you make the composer to have same transition as this video when it comes to
changing the available buttons? Please also make the buttons look exactly like
whatsapp and make sure it respect the dark and bright themes?"

## What the recordings show (both themes)

- Empty composer: bare + glyph left, pill input, then OUTSIDE the field a bare
  camera glyph and a FILLED GREEN CIRCLE holding a white mic.
- Text present: the camera collapses away, the input widens smoothly, and the
  green circle stays put while its glyph becomes the white send paper-plane.
- The green circle NEVER blinks out — it is one persistent element whose glyph
  crossfades; the whole change animates (~200 ms), nothing pops.

## Requirements

- **FR-001**: The composer's action cluster MUST transition, not swap: the
  primary circle persists across empty↔has-content, its glyph crossfading
  mic↔send; the camera collapses/expands (width + fade) so the input width
  animates instead of jumping.
- **FR-002**: Buttons MUST match WhatsApp's presentation: bare glyphs for
  + / camera (no button chrome), one filled primary-colored circular action
  button with a white glyph. Ring's disappearing-timer button keeps its place
  and adopts the bare-glyph look.
- **FR-003**: Colors MUST come from theme variables so dark and light both
  render correctly (no hardcoded per-theme colors in the markup).
- **FR-004**: Behavior is unchanged: tap camera = camera, hold camera = video
  note, mic = voice recording, send = send; the spec-2032 iPadOS tap rules
  (@mousedown.prevent, never bare @pointerdown.prevent) still hold.
- **FR-005**: The recording-mode and caption/media states keep working: any
  content (text OR pending media) shows the send glyph.

## Success Criteria

- **SC-001**: Typing the first character / clearing the last one animates the
  cluster exactly once, smoothly (no double-fire, no pop), in both themes —
  drive screenshots of empty/typing states, light and dark.
- **SC-002**: Existing composer e2e suites stay green (send, camera, voice,
  video-note, captions).
- **SC-003**: The reporter confirms the feel matches the recordings on-device.
