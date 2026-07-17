# Feature Specification: Connect Four, the Second Built-in Game

**Feature Branch**: `feat/0010-connect-four-second`

**Created**: 2026-07-06

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "A second built-in game, proving the game plugin
registry: Connect Four, playable everywhere tic-tac-toe already is — 1:1 chats,
group challenges, and Wall challenges — with themes, the same notifications,
sounds, stats, and rules, added purely by writing one new game module."

**Depends on**: spec 0008 (the game platform: registry, session engine, bubble,
sounds, stats) and spec 0009 (group/Wall challenges). This spec deliberately
changes NEITHER — its point is that it doesn't have to.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Play Connect Four in a 1:1 chat (Priority: P1)

A user opens the attach menu's Game entry and now sees a real choice: Tic-tac-toe
or Connect Four, each with its own style options. Picking Connect Four starts the
familiar instantly-playable bubble, but with a 7-wide, 6-tall board: tapping a
column drops your disc to the lowest free cell. Four in a row — across, down, or
diagonally — wins; a full board is a draw. Everything else feels identical to
tic-tac-toe: turn cues, re-surfacing on moves, the result overlay, Play again,
resign, sounds, stats in Message info, and the one-game-per-chat gate.

**Why this priority**: The core deliverable — the second game, playable where
games began.

**Independent Test**: Two accounts play Connect Four in a 1:1 chat to a vertical
win; both devices converge on the identical result; the picker showed both games.

**Acceptance Scenarios**:

1. **Given** the game picker, **When** it opens, **Then** it lists BOTH games,
   each leading to its own theme choices (the single-game fast path retires
   naturally).
2. **Given** a Connect Four bubble, **When** a player taps a column, **Then**
   their disc lands on the lowest free cell of that column on both devices.
3. **Given** a column that is full, **When** a player taps it, **Then** nothing
   happens (an illegal move never leaves the device).
4. **Given** four in a row in any direction, **Then** both devices show the same
   winner with the standard result overlay; a 42-move full board is a draw.
5. **Given** a game of Connect Four in progress, **When** either player opens
   Message info, **Then** the same stats section renders (players, style,
   result, moves, pace).

---

### User Story 2 - Connect Four challenges in groups and on the Wall (Priority: P2)

The group attach menu and the Wall composer's challenge picker offer Connect
Four alongside Tic-tac-toe. The whole 0009 challenge loop — first to accept
plays, quiet observers, Follow, turn notifications, sealed player identity,
post-page stats — works unchanged with the new game.

**Why this priority**: Proves the challenge layer is game-agnostic; pure reuse.

**Independent Test**: In a three-member group, A throws a Connect Four
challenge, B accepts, C observes; the board plays to a diagonal win visible to
all three. On the Wall, the same loop over a challenge post.

**Acceptance Scenarios**:

1. **Given** a group challenge with Connect Four, **When** the first member
   accepts, **Then** the seated game plays exactly like tic-tac-toe challenges
   (same racing rules, observer read-only, result for everyone).
2. **Given** a Wall challenge post with Connect Four, **When** the audience
   plays it out, **Then** moves converge from the sealed engagement records and
   the post page shows the stats.

---

### User Story 3 - Connect Four looks like Connect Four (Priority: P3)

The board reads as the real thing: a grid of circular slots, discs in two
colors (or themed emoji marks), the last move gently highlighted, sized to fit
the same bubble and Wall card the square board fits today — on phones and
desktop, light and dark.

**Acceptance Scenarios**:

1. **Given** the classic theme, **Then** the two sides play visually distinct
   discs (not letters), with at least the same theme variety pattern
   tic-tac-toe established (a classic look plus emoji styles).
2. **Given** a finished or mid-game board, **Then** the last-move disc carries
   the same attention treatment tic-tac-toe's last move gets.
3. **Given** a 7×6 board in a chat bubble, **Then** it fits the bubble width
   without horizontal scrolling and cells stay tappable (taps are per COLUMN,
   which keeps the effective target tall even where cells are small).

---

### Edge Cases

- **Full column tap**: refused locally, silently — identical to occupying a
  taken tic-tac-toe cell (an honest device never emits an illegal move; an
  inbound one is tampering → the standard out-of-sync terminal).
- **Old app versions**: a pre-0010 client receiving a Connect Four bubble or
  challenge shows the shipped unknown-game fallback ("Update Ring to play this
  game") — never a crash, never a wrong board. Its device can still relay
  everything.
- **Draw at 42 moves**: the standard draw result (🤝), like tic-tac-toe's.
- **One game per chat**: unchanged — one ongoing game OR open challenge per
  chat regardless of which game it is.
- **Games in flight during the update**: existing tic-tac-toe sessions are
  untouched; the new module only adds a registry id.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The game registry MUST gain exactly one new bundled module,
  `connect4`, implementing the existing GameModule interface (initial state,
  per-move validation, status, turn) with NO changes to the engine, the wire
  contract, the challenge layer, or the server.
- **FR-002**: The board MUST be 7 columns × 6 rows; a move is a COLUMN choice;
  the disc occupies the lowest free cell; 4-in-a-row horizontally, vertically,
  or diagonally wins; 42 moves without a winner is a draw.
- **FR-003**: Move legality MUST be validated by the pure module on both ends,
  exactly like tic-tac-toe (pre-validated locally; invalid inbound → the
  labeled out-of-sync terminal, never a corrupted board).
- **FR-004**: Connect Four MUST be available everywhere games start today: the
  1:1 attach menu, the group challenge picker, and the Wall composer — through
  the existing picker, which now renders its real multi-game list.
- **FR-005**: Every platform behavior MUST apply unchanged and without
  game-specific code: turn/result notifications and their settings, follows,
  sounds, re-surfacing, stats, forwards exclusion, TTL expiry, the
  one-game-per-chat gate, and sealed player identity on the Wall.
- **FR-006**: The module MUST ship at least three visual themes following the
  0008 pattern (a classic disc look plus emoji styles), listed in the design
  ledger (docs/ANIMATED-EMOJI.md) like tic-tac-toe's.
- **FR-007**: The wire identifier `connect4` and its move shape (the chosen
  column) MUST be frozen once shipped (contract §1 discipline).

### Zero-Knowledge Impact *(include when the feature touches the wire, storage, or the server)*

- **What crosses the wire**: only the existing sealed structures with a new
  `gameType` string value and `{ col }` moves inside them. No new fields, no
  new payload kinds, no engagement changes.
- **What the server unavoidably sees**: nothing new — the server diff for this
  feature is EMPTY (SC-004).
- **Version skew**: pre-0010 clients render the shipped unknown-game fallback.

### Success Criteria *(mandatory)*

- **SC-001**: Two players complete a Connect Four game (win and draw paths) in
  a 1:1 chat with both devices deriving identical results — including across an
  offline gap.
- **SC-002**: A 3-account group challenge and a Wall challenge play Connect
  Four end to end with the full 0009 behavior matrix (accept race, observers,
  follows, notifications) and no challenge-layer code changes.
- **SC-003**: The implementation adds a game module + board component +
  registry entry and does NOT modify the session engine, challenge engine,
  crypto payload types, or notification routing (verifiable by diff).
- **SC-004**: `git diff --stat server/` is empty.
- **SC-005**: The existing tic-tac-toe unit + e2e suites pass unchanged
  (byte-identical expectations).

### Assumptions

- Standard Connect Four rules (7×6, 4-in-a-row, gravity) — no variants.
- The challenger/starter moves first, as in tic-tac-toe (player 0).
- The picker's single-game fast path simply disappears because the registry
  returns two games — that behavior was explicitly designed to be temporary
  (spec 0008 decision: the picker "IS the plugin-forward UI").
