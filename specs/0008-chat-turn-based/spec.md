# Feature Specification: In-Chat Turn-Based Games

**Feature Branch**: `feat/0008-chat-turn-based`

**Created**: 2026-07-05

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "In-chat turn-based games, starting with tic-tac-toe, playable in 1:1 chats. Users can start a game from the chat composer's attach menu; the game appears as an interactive bubble in the conversation that both participants play directly inside the chat. Moves travel as end-to-end-encrypted messages over the existing opaque relay — the server never learns that a game is being played, let alone its state (zero server changes). Architected as an internal plugin registry: each game is a bundled, first-party, reviewed module conforming to a common game interface so future games are added by writing one new module and registering it — never dynamically loaded or third-party code. v1 scope: tic-tac-toe only, 1:1 chats only, bubble-only UI, a game picker listing available games, 'Your move' notifications behind the existing mute/hidden-chat/generic gates, resign and play-again (rematch = fresh bubble), no accept handshake. Game state is a move log stored with the game's own message, replayed deterministically with both clients validating every move; invalid/conflicting moves mark the game 'out of sync' with a play-again offer. Games expire with their bubble under disappearing-message rules. Design mirrors the existing poll feature end-to-end."

## Clarifications

### Session 2026-07-05

- Q: Can multiple games be ongoing in the same 1:1 chat at once? → A: One at a time — the Game entry in the attach menu is unavailable while a game in that chat is still ongoing.

### Session 2026-07-05 (post-implementation feedback)

- Q: How should players see whose turn it is at a glance? → A: An animated cue on the bubble using the app's existing animated emoji (animated hourglass while waiting, an animated cue when it is your move), falling back to the plain status text where animation is off or unavailable.
- Q: How do players remember which mark is theirs mid-game? → A: The bubble always states which mark you play, colored to match the board.
- Q: Should an active game stay visible as messages arrive? → A: Yes — any accepted move or resignation re-surfaces the game bubble to the newest position in the conversation, identically on both devices; the bubble's displayed time then reflects its latest activity.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Play tic-tac-toe inside a 1:1 chat (Priority: P1)

While chatting with a friend, a user opens the composer's attach menu, chooses "Game", and picks tic-tac-toe from the list of available games. A game board appears in the conversation as a message bubble on both sides, instantly playable with no invitation step. The person who started the game moves first; the two players then alternate, tapping cells directly on the board in the bubble. Both boards stay in step, each bubble clearly shows whose turn it is, and when someone wins or the board fills up, both players see the result (win, loss, or draw) on the bubble.

**Why this priority**: This is the entire feature — a complete, playable game between two people inside their existing private conversation. Everything else (resign, rematch, notifications) decorates this core loop.

**Independent Test**: With two paired accounts in a 1:1 chat, account A starts tic-tac-toe from the attach menu; both accounts alternate moves to a win and separately to a draw; both sides display the identical final board and result.

**Acceptance Scenarios**:

1. **Given** an open 1:1 chat, **When** a user opens the attach menu and chooses a game, **Then** a game bubble appears in the conversation on both participants' devices, ready to play with no acceptance step.
2. **Given** a fresh game bubble, **When** the recipient tries to move first, **Then** the move is not accepted, because the game starter moves first.
3. **Given** an ongoing game where it is player A's turn, **When** A taps an empty cell, **Then** the move appears on both devices and the turn indicator flips to player B on both.
4. **Given** an ongoing game, **When** a player taps an occupied cell or taps when it is not their turn, **Then** nothing is sent and the board is unchanged.
5. **Given** a game one move from completion, **When** the winning move is played, **Then** both devices show the same result (winner announced to both, or draw) and the board accepts no further moves.
6. **Given** the recipient's device is offline when moves are made, **When** it comes back online, **Then** the missed moves arrive and its board catches up to the same state as the sender's.
7. **Given** a game in the chat is still ongoing, **When** either participant opens the attach menu, **Then** the Game entry is unavailable (with a brief explanation) until that game finishes.

---

### User Story 2 - Resign and play again (Priority: P2)

A player who wants out of a game can resign from the bubble; both sides see the game end with the other player as winner. From any finished game (won, drawn, resigned, or out of sync), either player can start a rematch, which begins a brand-new game bubble in the conversation — the finished board stays in the history as a record.

**Why this priority**: Games need a graceful exit and an easy "again!" loop to feel finished rather than abandoned; but a playable game (US1) is valuable without it.

**Independent Test**: In an ongoing game, one player resigns; both bubbles show the resignation result. Either player taps "Play again" and a fresh, playable game bubble appears for both.

**Acceptance Scenarios**:

1. **Given** an ongoing game, **When** a player resigns from the bubble, **Then** both devices show the game as ended with the resigner having conceded, and the board accepts no further moves.
2. **Given** a finished game bubble, **When** either player chooses "Play again", **Then** a new game bubble starts in the chat (the chooser is the new game's first mover) and the old bubble remains unchanged in the history.
3. **Given** a finished game, **When** either player looks at the old bubble, **Then** its final board and result remain visible as part of the conversation history.

---

### User Story 3 - Know when it's your move (Priority: P3)

A player who has left the chat or the app learns that their opponent has moved: the chat list preview reflects the game activity, and a notification tells them it's their move — with the same privacy protections as every other Ring notification (muted chats stay silent; chats set to generic notifications reveal nothing about the content; hidden chats reveal nothing at all).

**Why this priority**: Keeps slow-paced games alive across hours or days, but the game itself is fully playable without it.

**Acceptance Scenarios**:

1. **Given** a game where the opponent just moved and the app is closed, **When** the move arrives, **Then** the player receives a notification indicating it is their move in that chat.
2. **Given** a chat the player has muted, **When** the opponent moves, **Then** no notification is shown, matching muted behavior for ordinary messages.
3. **Given** notifications set to generic/private mode or a hidden chat, **When** game activity arrives, **Then** the notification reveals no more than it would for an ordinary message in that mode.
4. **Given** a new game or a move in a chat, **When** the user views the chat list, **Then** the preview line indicates game activity rather than showing nothing or stale text.

---

### Edge Cases

- **Duplicate delivery**: the same move may be delivered more than once (reconnects, retries); it must be applied exactly once.
- **Conflicting or invalid incoming move** (a tampering or malfunctioning peer sends an out-of-turn, illegal, or contradictory move): the receiving device marks the game "out of sync", stops play on that bubble, and offers "Play again". There is no repair protocol.
- **Disappearing messages**: in a chat with a message timer, the game bubble and its moves expire like any other message; an active game can vanish mid-play. This is accepted behavior.
- **Message deletion**: if the game bubble is deleted/erased, the game is gone for that participant like any other deleted message.
- **Older app version on one side**: a device that predates this feature receives the game start as an unrecognized message type and cannot play; it must not crash or corrupt the chat. (Same acceptance as every past addition of a new message type.)
- **Group chats**: games are not offered in group chats in v1; the entry point simply does not appear there.
- **Forwarding**: game bubbles cannot be forwarded — a game belongs to the conversation it was started in.
- **Both players race**: if both ends somehow submit a move for the same turn (e.g., during an offline gap), devices resolve deterministically to one agreed state or declare the game out of sync — they never diverge silently.
- **Start race**: if both participants start a game during an offline gap, two ongoing games can exist despite the one-game gate; both stay playable, and no new game can start until every ongoing game finishes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to start a game from the attach menu of a 1:1 chat, choosing from a list of available games (tic-tac-toe is the only entry in v1).
- **FR-001a**: Only one game may be ongoing per chat: while a game is ongoing, the Game entry MUST be unavailable (with a brief explanation) on both participants' devices until that game finishes (won, drawn, resigned, or out of sync). This gate is enforced locally at start time; if a start race across an offline gap produces two ongoing games, both remain playable and the gate stays engaged until every ongoing game finishes.
- **FR-002**: A started game MUST appear as an interactive bubble in the conversation on both participants' devices, playable immediately without an acceptance step.
- **FR-003**: The game starter moves first; devices MUST enforce strict turn alternation and MUST NOT allow a player to move out of turn or make an illegal move locally.
- **FR-004**: Every incoming move MUST be independently validated on the receiving device against the game's rules; devices MUST NOT trust a peer's claimed board state.
- **FR-005**: The bubble MUST always show the current board, whose turn it is, and — when the game ends — the outcome (win/loss/draw/resigned), identically on both devices given the same moves.
- **FR-006**: Duplicate deliveries of the same move MUST have no effect beyond the first application.
- **FR-007**: On receiving an invalid, out-of-turn, or conflicting move, the device MUST mark the game "out of sync", refuse further play on that bubble, and offer to start a new game.
- **FR-008**: Users MUST be able to resign an ongoing game; both sides then see the game ended with the resigner having conceded.
- **FR-009**: Users MUST be able to start a rematch from a finished game; the rematch is a brand-new game bubble and the finished bubble remains in history.
- **FR-010**: All game traffic (game start, moves, resignations) MUST be end-to-end encrypted and indistinguishable to the server from ordinary message traffic; the server MUST NOT gain any new capability, endpoint, or data format for this feature (zero server changes).
- **FR-011**: Game activity MUST respect the chat's existing privacy and attention settings: muted chats produce no notification; generic/private notification modes and hidden chats reveal nothing beyond what an ordinary message would.
- **FR-012**: An opponent's move MUST produce a "your move" notification when the app is closed or the chat is not open, subject to FR-011's gates.
- **FR-013**: The chat list preview MUST reflect game activity (new game, move played) in plain language.
- **FR-014**: Game bubbles MUST be excluded from forwarding.
- **FR-015**: Game bubbles and their moves MUST follow the chat's existing message lifecycle: disappearing-message timers, deletion, and hidden-chat concealment apply to them exactly as to ordinary messages.
- **FR-016**: Games MUST be defined as self-contained, first-party modules behind a single common interface (identity, initial state, move validation, turn tracking, outcome), registered in one catalog, such that adding a future game requires only a new module and its registration — no changes to how games are transmitted, stored, or listed.
- **FR-017**: No game code may ever be downloaded, dynamically loaded, or third-party; all games ship inside the reviewed application build.
- **FR-018**: Moves made while the opponent is offline MUST be delivered when they reconnect and bring their board to the same state, in order, with no user action required.
- **FR-019**: The bubble MUST always show which mark the viewer plays (e.g. "you play ✕"), visually matched to the board, for the whole life of the game.
- **FR-020**: Whose-turn state MUST be glanceable on the bubble: an animated cue (reusing the app's existing animated-emoji capability) distinguishes "your move" from "waiting for them", degrading to plain status text when animation is off or the art is unavailable.
- **FR-021**: Every accepted move or resignation MUST re-surface the game bubble to the newest position in the conversation on BOTH devices identically (derived from the signal's own timestamp, never local receive time), so an active game is never buried by later messages. The bubble's displayed time then reflects its latest activity. Rejected/out-of-sync signals do not re-surface it.

### Key Entities

- **Game definition**: a bundled, first-party description of one game — its name, icon, rules (legal moves, turn order, win/draw conditions), and board presentation. Lives in a single catalog the picker lists.
- **Game session**: one playthrough between the two chat participants, anchored to the message bubble that started it. Holds which game is being played, the ordered log of accepted moves, and its derived status (ongoing, won, drawn, resigned, out of sync). Lives and dies with its message.
- **Move**: one player action within a session — who moved, what the move was, and its position in the sequence. Travels end-to-end encrypted like any message content.

## Zero-Knowledge Impact *(constitution Principle I)*

- **What crosses the wire**: game starts, moves, and resignations travel inside the same
  sealed message envelopes as every other message; rematches are ordinary new game starts.
  No new endpoint, request shape, or server-visible field is introduced — the server-side
  diff for this feature is empty.
- **What is encrypted**: everything game-related — which game is being played, the board,
  every move, whose turn it is, and the outcome are all end-to-end encrypted message
  content, readable only on the two participants' devices.
- **What metadata the server unavoidably sees**: exactly what it sees for ordinary
  messages — that sealed envelopes of some size flowed between the two parties at some
  times. A game produces a burst of small envelopes, which is indistinguishable in kind
  from a quick text exchange; no game-specific pattern is exposed beyond generic
  message-timing metadata that already exists.
- **Why**: games are pure message content between two people who already share an
  encrypted channel. Reusing that channel is what makes the feature possible at all under
  the zero-knowledge boundary; a server that hosted or refereed games would have to read
  game state and is rejected by design (see Assumptions: friendly-opponent threat model).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From an open 1:1 chat, a user can start a game in at most 3 taps.
- **SC-002**: With both players online, a move appears on the opponent's board within 2 seconds of being played.
- **SC-003**: In normal play (no tampering), both devices display identical board state and identical final outcome in 100% of games, including games played across an offline gap.
- **SC-004**: A server operator inspecting the database and traffic can find no plaintext evidence that games exist: no game names, boards, moves, or outcomes, and no game-specific requests — verified by the absence of any server-side change for this feature.
- **SC-005**: A tampered or malformed incoming move never corrupts a board silently: 100% of such cases end in a clearly labeled "out of sync" state with a rematch offer.
- **SC-006**: Adding a second game to the catalog requires writing and registering one new game module only, with zero changes to message handling, storage, or server behavior.
- **SC-007**: Game activity in muted, generic-notification, or hidden chats leaks nothing beyond ordinary-message behavior in 100% of cases.

## Assumptions

- **No acceptance handshake**: starting a game is like sending a poll — the recipient can simply play (or ignore it). Consciously chosen for v1 to keep friction near zero between people who already trust each other enough to chat.
- **Friendly-opponent threat model**: both devices validate every move, so a cheating peer cannot corrupt the honest player's board — but there is no referee and no repair protocol; the honest device declares "out of sync" and offers a fresh game. Proportionate for games between contacts.
- **1:1 chats only in v1**; group play/spectating is a possible future feature, deliberately out of scope.
- **Bubble-only presentation in v1**; no full-screen game view. Tic-tac-toe fits comfortably in a bubble.
- **Games are ephemeral content, not records**: no cross-game score tracking, statistics, or leaderboards in v1; a finished bubble in history is the only record, and disappearing-message timers may erase even that.
- **Version skew accepted**: an older app that doesn't know about games shows its standard unknown-content behavior; both sides need a current version to play.
- **Existing messaging infrastructure is reused as-is**: delivery, ordering, retries, offline queuing, encryption, notification gating, and message lifecycle are inherited from the platform; this feature adds no new transport or storage system.
