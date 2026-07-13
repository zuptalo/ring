# Feature Specification: Chat background pattern reads clearly in both themes

**Feature Branch**: `feat/1046-quick-call-tiles` <!-- bundled with spec 1046 (precedent: PR #965 carried specs 2028/2029/1044) -->

**Created**: 2026-07-13

**Status**: in-review

**Input**: User description: "Make the chat background lines a bit brighter on the dark theme and darker on the bright theme." (An earlier richer-wallpaper direction was explored and reverted by request — the original artwork stays; only its per-theme contrast changes.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The backdrop is visible in whichever theme I use (Priority: P1)

The scattered Ring-shield pattern behind conversations should be plainly
visible in the light theme (slightly darker lines than before) and in the dark
theme (brighter lines, where it previously all but disappeared) — without
changing the artwork or competing with the bubbles.

**Independent Test**: Open a chat in each theme; the pattern is visible in
both, bubbles/text unchanged.

**Acceptance Scenarios**:

1. **Given** the light theme, **Then** the shield pattern shows with slightly
   darker strokes than before.
2. **Given** the dark theme, **Then** the pattern shows with brighter strokes
   instead of fading into the background.
3. **Given** any theme, **Then** artwork, layout, density, and loading
   behaviour are unchanged (same inline tile, now a per-theme token).

## Requirements *(mandatory)*

- **FR-001**: The chat background tile MUST use a per-theme stroke: darker on
  light, brighter on dark, with the artwork otherwise identical.
- **FR-002**: The tile MUST keep loading exactly as before (inline in the
  stylesheet; no new requests).

## Zero-Knowledge Impact *(constitution I)*

None — a bundled CSS asset; nothing crosses the wire.

## Success Criteria *(mandatory)*

- **SC-001**: Screenshots in both themes show the pattern clearly where the
  dark theme previously showed almost nothing.

## Assumptions

- Implemented as a `--app-chat-doodle` token in the theme variables (same
  light/dark override pattern as every other app token).
