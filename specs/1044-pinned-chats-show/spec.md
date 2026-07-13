# Feature Specification: Pinned Chats Grid (iMessage-style)

**Feature Branch**: `feat/1044-pinned-chats-show`

**Created**: 2026-07-13

**Status**: in-review

**Input**: User description: "Make pinned chats look like iMessage: large circular avatars in a grid at the top of the Chats tab, up to 9 pins." (with reference screenshot of iMessage's pinned grid)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pinned chats show as an avatar grid at the top (Priority: P1)

A user who has pinned chats opens the Chats tab and sees them as large, circular avatars arranged in a grid (three per row) above the conversation list, each with the chat's name beneath it, exactly like iMessage's pinned conversations. Tapping an avatar opens that chat. Pinned conversations no longer repeat as rows in the list below.

**Why this priority**: This is the entire visual feature; everything else supports it.

**Independent Test**: Pin two chats, open the Chats tab: both render as grid tiles above the list and their rows are absent from the list; tapping a tile opens the right chat.

**Acceptance Scenarios**:

1. **Given** a user with 1-9 pinned chats, **When** they open the Chats tab, **Then** the pinned chats render as circular avatar tiles in a 3-column grid above the list, name under each, ordered by recent activity, and do not appear as rows in the list below.
2. **Given** no pinned chats, **When** they open the Chats tab, **Then** no grid area renders (no empty placeholder) and the list looks exactly as today.
3. **Given** a pinned chat receives a new message, **When** the user views the Chats tab, **Then** the tile shows the unread state (badge with count) without changing its size or shape.
4. **Given** the user taps a tile, **Then** the chat opens exactly as tapping its old list row did.
5. **Given** the user searches or switches to a filter chip other than All, **Then** the grid hides and pinned chats appear in the filtered list results like any other chat (search must still find them).

### User Story 2 - Manage pins from the grid and the actions sheet (Priority: P2)

Because pinned chats leave the list, the swipe-to-unpin gesture no longer reaches them. Long-pressing a grid tile opens the same chat actions sheet used elsewhere, which gains a Pin/Unpin action. Up to 9 chats can be pinned (up from 3 today); the cap message reflects the new limit.

**Why this priority**: Without this, pinning becomes a one-way door for grid chats.

**Independent Test**: Long-press a tile → sheet opens → Unpin returns the chat to the list. Pin a 10th chat → friendly cap message.

**Acceptance Scenarios**:

1. **Given** a pinned chat tile, **When** the user long-presses it, **Then** the chat actions sheet opens for that chat and offers Unpin (plus the existing actions).
2. **Given** an unpinned chat row, **When** the user opens its actions sheet ("More"), **Then** it offers Pin (in addition to the existing swipe gesture).
3. **Given** 9 chats already pinned, **When** the user pins another, **Then** nothing is pinned and a message explains the 9-chat limit.
4. **Given** a pinned chat is archived, **Then** it leaves the grid (archiving already clears the pin today; behavior preserved).

### User Story 3 - Pins respect hidden chats and sync (Priority: P3)

Pinned hidden chats stay invisible until revealed (the grid inherits the fail-closed hidden filter). Pin state continues to sync across the user's devices as it does today.

**Acceptance Scenarios**:

1. **Given** a pinned chat that is hidden, **When** the Chats tab renders without an active reveal, **Then** the tile does not appear anywhere; during a reveal, the chat appears per the existing reveal ordering.
2. **Given** the user pins a chat on device A, **When** device B syncs, **Then** the chat is pinned there too (existing chats-store sync; no new sync surface).

### Edge Cases

- Cold open before the hidden-chat set is known: the grid must not flash (inherits listChats fail-closed empty state; gate on the existing `ready` flag).
- Long names under tiles: single line, ellipsized, centered.
- 4-9 pins wrap to additional rows of 3 (iMessage behavior); 1-2 pins keep tile size (no stretching).
- A pinned chat with no avatar uses the same generated disc as its list row did (UserAvatar handles all avatar kinds).
- RTL locales: grid order follows the reading direction (use logical CSS; constitution X).
- Devices already syncing >3 pins never occur today (cap enforced at write), but if a synced snapshot carries more than 9 pinned chats, render them all (cap only gates new pins).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Chats tab MUST render pinned chats as circular avatar tiles in a 3-column grid above the conversation list, name beneath each tile, ordered by recent activity, when the All filter is active and search is empty.
- **FR-002**: Pinned chats MUST NOT appear as rows in the list while the grid shows them; under search or a non-All filter chip the grid hides and pinned chats appear in the list results normally.
- **FR-003**: Tiles MUST show the chat's unread state and open the chat on tap.
- **FR-004**: Long-pressing a tile MUST open the existing chat actions sheet; the sheet MUST gain a Pin/Unpin action (available for list rows too).
- **FR-005**: The pin cap MUST rise from 3 to 9, with the cap message updated; pinning beyond the cap changes nothing.
- **FR-006**: The grid MUST inherit the existing hidden-chat filtering (fail closed) and the existing archived-chats behavior (archiving unpins).
- **FR-007**: Pin state MUST continue to sync exactly as today (chats-store record field; no new wire data, no new server capability).
- **FR-008**: The grid MUST be composed from stock Ionic primitives + the existing UserAvatar component and theme tokens (constitution XI); no bespoke widget where an Ionic primitive exists.

### Key Entities

- **Pinned chat**: existing `Chat.pinned` boolean on the chats store; no schema change, no DB_VERSION bump.
- **Pin cap**: existing `MAX_PINNED_CHATS` constant; 3 → 9.

## Success Criteria *(mandatory)*

- **SC-001**: With 1-9 pins, the Chats tab visually matches the iMessage pattern (3-column circular grid above the list) and pinned rows are absent from the list below.
- **SC-002**: All pin management flows (pin, unpin, cap message, archive-unpins) work from both the grid and the sheet; no flow requires the removed swipe path for a pinned chat.
- **SC-003**: No regression in hidden-chat concealment: a pinned hidden chat is never visible while concealed (e2e-verifiable).
- **SC-004**: Chats-tab initial render time does not measurably regress (grid renders from the same already-loaded chats array; no extra queries).

## Zero-Knowledge Impact

Nothing new crosses the wire. `Chat.pinned` already exists and already syncs inside the encrypted own-data snapshot; the cap change and the grid are pure client presentation. The server learns nothing.

## Assumptions

- iMessage semantics chosen where they conflict with today's UI: pinned chats leave the list rows; the grid only shows on the All chip with empty search.
- The unread indicator on tiles is Ring's existing count badge (not iMessage's dot) for consistency with the rest of the app.
- Presence dots on tiles are included if trivially composable from the existing row implementation, otherwise deferred (note in plan).
- No drag-to-reorder of tiles in v1 (iMessage supports it; Ring pins stay activity-ordered). Candidate follow-up spec.
