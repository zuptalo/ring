# Feature Specification: A visible, WhatsApp-style doodle background in chats

**Feature Branch**: `feat/1046-quick-call-tiles` <!-- bundled with spec 1046 (precedent: PR #965 carried specs 2028/2029/1044) -->

**Created**: 2026-07-13

**Status**: in-progress

**Input**: User description: "Make our chat background more visible like how WhatsApp does it" (with WhatsApp light/dark screenshots vs Ring's current, nearly invisible shield tile).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The chat feels like a place, not a blank page (Priority: P1)

When I open a conversation I want the backdrop to be a friendly, clearly
visible doodle pattern — like WhatsApp's — in both light and dark themes,
without competing with the bubbles.

**Why this priority**: The single ask.

**Independent Test**: Open a chat in light and dark themes and confirm the
pattern is plainly visible at arm's length yet the bubbles remain the clear
foreground; compare against the previous barely-there tile.

**Acceptance Scenarios**:

1. **Given** a chat in the light theme, **Then** a varied line-doodle pattern
   is clearly visible behind the bubbles.
2. **Given** the dark theme, **Then** the same pattern reads clearly against
   the dark background (not washed out, not glaring).
3. **Given** any bubbles, media, or overlays, **Then** legibility is
   unaffected (bubbles stay opaque; contrast of foreground text unchanged).

### Edge Cases

- The pattern must stay behind the scroll content exactly as today (no change
  to scroll behaviour or performance — a static repeating tile).
- RTL and different viewport widths simply tile; no seams.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The chat conversation background MUST show a repeating doodle
  pattern of varied, communication-themed line glyphs (including Ring's shield
  mark) at a density comparable to WhatsApp's wallpaper — not a single sparse
  motif.
- **FR-002**: The pattern MUST be clearly visible in BOTH themes while staying
  subtle enough that bubbles and text remain the unambiguous foreground.
- **FR-003**: The change is purely visual: no behavioural, performance, or
  layout change to the chat view.

## Zero-Knowledge Impact *(constitution I)*

None — a static, bundled CSS/SVG asset; nothing crosses the wire.

## Success Criteria *(mandatory)*

- **SC-001**: In side-by-side screenshots (light + dark), the pattern is
  obviously present (WhatsApp-comparable) where the old one was near-invisible.
- **SC-002**: No regression in chat e2e suites (visual-only change).

## Assumptions

- One neutral mid-grey stroke works for both themes (tuned by screenshot
  review); per-theme variants only if review shows one theme failing.
- No user-configurable wallpapers in this spec (future work if asked).
