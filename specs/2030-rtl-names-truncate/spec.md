# Feature Specification: RTL Names Truncate at the Correct End

**Feature Branch**: `fix/2030-rtl-names-truncate`

**Created**: 2026-07-13

**Status**: in-review

**Input**: User bug report with screenshots: a long Persian group name ("خانواده پفک نمکی و تاجی") truncates by clipping the BEGINNING of the name (the visually rightmost part an RTL reader starts from), in the chat header and the new pinned-chats grid tiles.

## Bug

Single-line name surfaces use `text-overflow: ellipsis`, and browsers place the ellipsis at the line's end edge as determined by the element's computed `direction` — which is `ltr` everywhere in the app shell. For RTL names this clips the name's start and puts the … where the name begins, not where it continues. The existing `unicode-bidi: plaintext` on some of these elements fixes rendering order but demonstrably does NOT move the ellipsis (the report's screenshots show surfaces that already have it).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - RTL names truncate from their reading end (Priority: P1)

A user with Persian/Arabic contact and group names sees long names keep their beginning (the part that identifies them) with the ellipsis at the continuation side — in the chat header, chat rows, pinned-grid tiles, and call surfaces — while Latin names keep today's behavior exactly.

**Independent Test**: Give a group an overlong Persian name; the chat header and its pinned tile keep the name's first words visible with … at the visual left. A long Latin name still ellipsizes at the right.

**Acceptance Scenarios**:

1. **Given** a group with a long RTL name, **When** it renders in the chat header, a chat row, or a pinned tile, **Then** the name's beginning is visible and the ellipsis sits at the visual left.
2. **Given** a long LTR name, **Then** truncation is unchanged (… at the visual right).
3. **Given** RTL names on call surfaces (incoming overlay, active-call header, tile labels, call-waiting banner, minimized pill), **Then** the same rule holds.
4. **Given** a mixed-direction name, **Then** the first strong character decides the direction (platform `dir="auto"` semantics).

### Edge Cases

- Names starting with emoji/neutral characters: `dir="auto"` skips neutrals and uses the first strong character.
- Layout alignment must not shift: elements keep their current text-align (rows stay start-aligned, headers/tiles centered) — only the ellipsis side and render order follow the name's direction.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every single-line, ellipsis-truncated name surface MUST derive its direction from the name's content so truncation preserves the name's beginning: chat header, chat list rows, pinned-grid tiles, incoming-call overlay, active-call header and tile labels, call-waiting banner, minimized-call pill.
- **FR-002**: LTR names and surrounding layout alignment MUST be unaffected.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The name elements resolve to RTL directionality for RTL content (machine-checkable via `:dir(rtl)`), and to LTR for Latin content — covered by an automated test that fails on today's code.
- **SC-002**: Visual confirmation on the reported surfaces (header + pinned tile) with the reporter's group name.

## Zero-Knowledge Impact

None. Pure client rendering; nothing crosses the wire.

## Assumptions

- `dir="auto"` (first-strong heuristic) is the intended behavior for mixed-direction names, matching platform conventions; constitution X's bidi mandate applies.
