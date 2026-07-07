# Feature Specification: Armada — Fullscreen Naval Duel Replaces Battleship

**Feature Branch**: `feat/1038-armada-fullscreen-naval`

**Created**: 2026-07-07

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Replace the existing battleship game with the
Armada design handoff (fullscreen 10×10 naval duel, 5 named warships). The
game is played fullscreen; other in-app notifications appear as tappable
toasts over the game and tapping one leaves the game for that chat; an
ongoing game shows a floating return button across the app with an unread
badge when it is your turn or there is game interaction. Design reference
versioned at `specs/1038-armada-fullscreen-naval/design/` (README.md +
Armada.dc.html)."

## Decisions

Product decisions confirmed with the user before this spec was written:

- **New game id `armada`, battleship retires.** Game ids are frozen once
  shipped and Armada changes the rules geometry (10×10 board; Carrier 5,
  Battleship 4, Cruiser 3, Submarine 3, Destroyer 2 — 17 fleet cells), so it
  ships as a NEW id. Battleship leaves the game picker; existing battleship
  sessions still render and can be finished inline; rematch on a finished
  battleship starts Armada (successor mapping).
- **PvP only.** The handoff prototype's AI opponent is ignored. Armada rides
  the existing E2EE transport with the same commit-and-reveal anti-cheat
  protocol as battleship. No new wire kinds.
- **1:1 and Wall only.** Group chats no longer offer games (spec 1036); Armada
  adds no group entry point.
- **Generic fullscreen infrastructure, Armada first.** The overlay, floating
  return button, and toast behavior are driven by a module-level presentation
  flag any game can adopt; tic-tac-toe and Connect Four keep inline bubbles.
- **Strict alternation.** Turn always passes after each shot, hit or miss
  (matches both the handoff and the existing protocol). The spec carries
  explicit anti-stall requirements because the user has personally hit a
  "both players waiting for each other" bug in the current game.
- **Spectators stay on the card.** Wall observers keep the challenge card and
  the existing Follow alerts; read-only fullscreen spectating is out of scope.
- **Multi-game return button opens the most urgent session** (awaiting your
  move first, then most recent activity); no chooser sheet in v1.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A fullscreen naval duel in a 1:1 chat (Priority: P1)

Maya picks Armada from the game menu in her chat with Alex. Both of them see a
compact challenge card in the chat ("Naval duel · Maya challenged you" on
Alex's side) with a "Play in fullscreen ▸" button instead of an inline board.
Tapping it fills the screen with the game: each player privately positions
five warships on a 10×10 grid (tap to place in fixed order, drag to move, tap
to rotate, auto-deploy and clear available), then they trade salvos in strict
alternation — radar sweep and aim reticle on the enemy waters, splashes for
misses, fire for hits, charred wrecks with a brief smoke column for sunk
ships. When one fleet is destroyed, a medal ceremony announces victory or
defeat with battle stats and a rank, and offers a new battle, reviewing the
final board, or leaving. Neither player can learn the other's layout early,
and a dishonest player loses by verification, exactly as in battleship today.

**Why this priority**: This is the product: the redesigned game and its
fullscreen home. Everything else supports it.

**Independent Test**: Two test accounts in a 1:1 chat play a complete duel
from picker to medal on phone-sized and tablet-sized viewports; the reveal
exchange verifies honest play and both devices derive the identical result.

**Acceptance Scenarios**:

1. **Given** a 1:1 chat, **When** Maya starts Armada, **Then** both sides see
   the challenge card (not a playable board) and tapping its button opens the
   fullscreen game; Maya lands directly in deployment.
2. **Given** both players have deployed (authored in either order,
   independently — the second commitment is staged on-device and sent
   automatically the moment the first one lands, so simultaneous deploys can
   never corrupt the game), **When** both commitments are in, **Then** battle
   begins and only the player whose turn it is can fire; fired cells cannot
   be fired again.
3. **Given** a shot lands, **Then** the shooter's board marks hit/miss/sunk
   exactly as the defender's device judged it, the turn passes, and the
   matching sound cue plays on both devices.
4. **Given** every cell of a ship is hit, **Then** the ship renders as a wreck
   with a smoke column that stops animating after a short window (the static
   wreck and embers remain).
5. **Given** all cells of one fleet are hit, **Then** both devices show the
   medal result overlay (gold/victory for the winner, iron/defeat for the
   loser) with shots, accuracy, ships sunk, and survivors; the reveal exchange
   proves the boards were honest, and a cheated result flips to the honest
   player exactly as in battleship.
6. **Given** a player already has an ongoing game in this chat, **When** they
   open the game menu, **Then** starting a second game is blocked (existing
   one-game-per-chat rule).

---

### User Story 2 - Leave the game and come back to it (Priority: P1)

While Alex is mid-battle, a message from his sister arrives in another chat: a
toast slides over the game. He taps it, the game shrinks away, and he lands in
her chat. A floating Armada button now follows him around the app with a badge
because it is his turn. Whenever he is ready, he taps it and is back on his
board, exactly where the battle stood. Had he pressed the system back gesture
instead, the same thing would happen: the game minimizes, never lost.

**Why this priority**: Fullscreen play is only viable if the messenger stays a
messenger — notifications must reach the player, and the game must be
effortless to re-enter. Ships with US1.

**Independent Test**: With an ongoing game, send messages from a third
account, tap the toast, verify navigation + floating button + badge, re-enter
and finish the game.

**Acceptance Scenarios**:

1. **Given** the fullscreen game is open, **When** a message arrives in
   another chat, **Then** a tappable notification banner appears over the game
   and tapping it minimizes the game and navigates to that chat.
2. **Given** the fullscreen game is open, **When** the opponent moves in THIS
   game, **Then** no banner for that move appears (the board updates live);
   the move's sound cue still plays.
3. **Given** an ongoing game the user holds a seat in and the overlay closed,
   **Then** a floating draggable button is visible everywhere in the app, and
   it disappears on its own when the game ends (including after an app
   reload — it derives from stored game state, not from having minimized).
4. **Given** it is the user's move in N ongoing games, **Then** the floating
   button shows a badge of N that clears as they move; tapping it opens the
   game awaiting them (most recent activity breaks ties), and a small count
   hint marks multiple ongoing games.
5. **Given** the user presses hardware/gesture back (or an OS-level fullscreen
   exit) while in the game, **Then** the overlay minimizes (or stays open with
   fullscreen dropped, respectively) and app navigation is never stranded.
6. **Given** the game finishes while minimized, **Then** the floating button
   vanishes, the result arrives through the normal game notification, and the
   chat/Wall card offers "View result ▸".

---

### User Story 3 - An open challenge on the Wall (Priority: P2)

Maya posts an Armada challenge to her Wall. Friends see the challenge card on
the post; the first to accept takes the opponent seat and lands in fullscreen
deployment. Everyone else keeps seeing the card with the game's public
progress and can follow the game for the result push, exactly like today's
wall games.

**Why this priority**: The Wall is the second (and only other) surface games
live on; the accept race and seat locking already exist and must keep working
under the new presentation.

**Independent Test**: Post a wall challenge from one account, accept from two
others near-simultaneously, verify exactly one gets the seat, the other sees
"Seat taken", and spectators keep the card.

**Acceptance Scenarios**:

1. **Given** a wall post with an Armada challenge, **When** a friend taps
   "Accept challenge ▸", **Then** they enter fullscreen deployment immediately
   while the seat race settles.
2. **Given** two friends accept near-simultaneously, **Then** exactly one
   deterministically wins the seat; the other's overlay shows a clear "seat
   taken" notice and exits, discarding their un-committed fleet.
3. **Given** a spectator (including followers), **Then** the post shows the
   challenge card with status only — no fullscreen entry — and Follow alerts
   behave as before.

---

### User Story 4 - Battleship retires gracefully (Priority: P3)

The game picker now offers Armada instead of Battleship. A half-finished
battleship game from last week still renders its inline submarine board and
can be played to its end; tapping rematch on a finished battleship starts an
Armada duel.

**Why this priority**: Migration hygiene — no stranded games, no dead picker
entries — but it does not block shipping the new game.

**Independent Test**: With a pre-existing battleship session in a chat,
verify the picker offers only Armada, the old game still plays inline, and
rematch starts Armada.

**Acceptance Scenarios**:

1. **Given** the game picker in a 1:1 chat, **Then** Armada is offered and
   Battleship is not.
2. **Given** an existing battleship session (ongoing or finished), **Then** it
   renders and plays inline exactly as before this feature.
3. **Given** a finished battleship game, **When** a player taps rematch,
   **Then** a new Armada game starts.

---

### Edge Cases

- **Opponent on an old app version**: their device renders the existing
  "Update Ring to play" fallback for the unknown game type and drops its
  signals without corrupting anything; on the new device the card honestly
  shows whom the game is waiting for. Ongoing-game gates ignore unknown types
  (existing behavior, restated here as a requirement).
- **Fullscreen request blocked or unsupported** (e.g. iPhone): the
  app-covering overlay IS the experience; every feature works identically.
- **Both players report "waiting for the other"** (the user-reported stall
  class): must be impossible to reach silently — see FR-009.
- **Chat message or wall post carrying the game is deleted mid-game**: the
  overlay closes with a notice and the device-local fleet secret is cleared.
- **Logout or app lock mid-game**: the overlay closes; secrets are wiped with
  the local data wipe; the game itself survives on the opponent's copy of the
  shared log.
- **Second own device**: only the device that committed the fleet can judge
  incoming shots (the layout secret is deliberately device-local — battleship
  precedent). Documented behavior, not a defect: the game continues on the
  committing device.
- **Multiple ongoing games**: the floating button aggregates (badge = games
  awaiting me), opens the most urgent, and hints at the count.
- **Out-of-sync move logs** (duplicate/gap/out-of-turn/illegal): the session
  lands on the existing labeled out-of-sync terminal, shown in both the card
  and the overlay — never a silent hang.
- **Result overlay dismissed to review the board**: a "View result" control
  reopens it (per the handoff).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (new game, frozen contract)**: Armada is a new game id with a
  10×10 board and the fixed five-ship fleet (5/4/3/3/2 cells, placed in fixed
  class order Carrier → Battleship → Cruiser → Submarine → Destroyer). Its
  id, rules, and serialization are frozen once shipped; the protocol contract
  is documented alongside the plan (mirroring battleship's contract doc).
- **FR-002 (commit-and-reveal, zero-knowledge)**: Armada uses battleship's
  protocol unchanged in shape: both players commit a hash of their layout
  before battle; the defender's device judges each shot; the loser's reveal
  rides the final answer and the winner then reveals; both devices re-verify
  every answer against the reveals and a cheated result flips to the honest
  player (both cheat = draw). The commitment binds the new geometry (board
  size + fleet roster + placements + salt), so an Armada commitment can never
  validate as another game's. The layout and salt never leave the device
  before reveal, are never synced to other own-devices or the server, and are
  cleared when the session reaches a terminal state.
- **FR-003 (strict alternation, deterministic turn)**: after each shot the
  turn passes, hit or miss. Whose move it is derives purely and
  deterministically from the shared move log, so both devices always agree.
- **FR-004 (surfaces and wire)**: Armada is offered in 1:1 chats and as a Wall
  challenge only; groups get no entry point. No new wire kinds or payload
  fields are introduced: 1:1 keeps the instant-start game message (the
  "challenge" framing is presentational; a player's deployment commit is the
  de-facto accept), and the Wall keeps its post + engagement-row session with
  the existing accept race and deterministic seat locking.
- **FR-005 (challenge card)**: on chat and Wall surfaces, a
  fullscreen-presentation game renders as a compact challenge card (per the
  design handoff: ~320px card, glyph, title, context subtitle, one full-width
  action button) instead of a playable board. Card states: challenged /
  awaiting their fleet / your move / their turn / finished (mini medal +
  "View result ▸") / cancelled (a withdrawn wall challenge) / out-of-sync.
  The card always names who the game is waiting on. A seated player can open the overlay from any state (watching
  their own board while the opponent aims is normal play); non-players never
  get an overlay entry — the card itself is the spectator view.
- **FR-006 (fullscreen overlay)**: the game opens in an app-global overlay
  that covers the app while leaving the launching surface in place
  underneath; it survives navigation while minimized and is independent of
  the router. True fullscreen is requested on the app root with the returned
  promise's rejection handled (a blocked request must be harmless); when
  blocked or unsupported the overlay alone is the experience. An OS-initiated
  fullscreen exit does not close the overlay; hardware/gesture back minimizes
  it. Exiting via the game's own leave control returns to the launching
  surface.
- **FR-007 (notifications over the game)**: in-app notification banners from
  other chats and surfaces render above the fullscreen game and keep their
  tap-to-navigate behavior; tapping one minimizes the game before navigating.
  While a game's overlay is open, that game's own move/turn/result banners
  are suppressed (mirroring the active-chat and wall-watching suppression
  rules); its sound cues still play. All other notification behavior is
  unchanged.
- **FR-008 (floating return button)**: whenever at least one ongoing
  fullscreen-presentation game where the user holds a seat exists and its
  overlay is not open, a draggable floating button is shown app-wide. Its
  visibility and badge are derived entirely from stored session state (they
  survive reload and self-clear when games end). Badge = number of such games
  awaiting the user's move. Tap opens the most urgent session (awaiting-me
  first, then most recent activity); multiple ongoing games show a count
  hint. It must not collide with the minimized-call widget.
- **FR-009 (anti-stall)**: a defender's judged-but-unsent answer — and a
  staged deployment commit whose slot has opened — MUST be re-emitted when
  the app (or the game) is next opened, so closing the app mid-judgement
  cannot strand both players waiting. Deployment commits are SEQUENTIAL on
  the wire (first seat, then second) precisely because simultaneous
  same-sequence commits are a proven session-killing race in the shipped
  battleship; the staging rule keeps deployment feeling parallel. The overlay's status line
  and the card always name who owes the next action. Divergent logs land on
  the labeled out-of-sync terminal. Rapid alternating fire with delayed or
  reordered delivery must converge to identical state on both devices with no
  deadlock.
- **FR-010 (battleship retirement)**: battleship disappears from the game
  picker; existing battleship sessions keep rendering and playing inline to
  completion; rematch from a finished battleship starts Armada.
- **FR-011 (compatibility)**: devices without the Armada module keep the
  existing safe fallbacks — unknown game types render the "update to play"
  bubble, their signals are ignored without corrupting state, and
  ongoing-game gates exclude unknown types.
- **FR-012 (fidelity and performance)**: the board, deployment interactions
  (tap-to-place in fixed order, drag with a small movement threshold to
  distinguish from tap, tap-to-rotate with inward nudge, auto-deploy, clear),
  battle effects (radar sweep dim on your turn / bright on theirs, aim
  reticle, splash, explosion-to-flame, wreck), medal result overlay (rank,
  stats, new battle / review board / leave), and responsive cell sizing
  follow the versioned design handoff. The sunk-ship smoke animation is
  time-boxed (~6.5s per ship, limited puffs) and then stops rendering — it
  must never animate indefinitely.
- **FR-013 (sound and settings)**: Armada reuses the existing naval sound
  cues and the existing game notification toggles and game-sounds setting; no
  new settings are added.

### Key Entities

- **Armada session**: an append-only log of validated moves (commitments,
  shots, answers, reveals) carried on the existing game message (1:1) or
  wall-post engagement rows (Wall). Board state is always re-derived from the
  log, never stored or transmitted.
- **Fleet layout secret**: a player's ship placements + salt, held only on the
  committing device until reveal; its hash is the public commitment.
- **Challenge card**: the compact in-chat/on-post representation of a
  fullscreen-presentation game (state, who's next, entry button).
- **Ongoing-game set**: the derived collection of fullscreen-presentation
  sessions the user holds a seat in — powers the floating button and its
  badge.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Two players complete a full Armada duel (start → deploy →
  battle → medal) entirely in fullscreen on a phone-sized viewport with no
  horizontal scrolling, and on a tablet-sized viewport with boards side by
  side.
- **SC-002**: Cheat verification: a tampered reveal or dishonest answer log
  flips the result to the honest player on both devices; honest games verify
  clean. (Unit-level: the rules engine reaches 100% of its terminal states in
  tests — win, flip, both-cheat draw, out-of-sync.)
- **SC-003**: With signal delivery artificially delayed and reordered during
  rapid alternating fire, both devices converge to the identical board and
  turn within seconds of delivery, and no reachable sequence leaves both
  players' UIs simultaneously claiming "waiting for opponent" (the
  re-emit-on-open rule is exercised by a test that closes the app between
  judging a shot and sending the answer).
- **SC-004**: While in a fullscreen game, a message from another chat surfaces
  as a banner within the same latency budget as outside the game, and one tap
  lands the user in that chat with the game minimized (verified in e2e).
- **SC-005**: The floating button appears within one second of leaving an
  ongoing game, shows the correct awaiting-me count across app reloads, and
  is gone within one second of the terminal state reaching the device.
- **SC-006**: A sunk ship's smoke stops consuming animation work after its
  window (~6.5s); sinking all five ships leaves zero continuously-animating
  smoke layers (perf guard from the handoff).
- **SC-007**: Battleship no longer appears in the picker; a pre-existing
  battleship fixture session still plays to completion; rematch from it
  starts Armada. Existing games e2e stays green alongside a new Armada e2e.
- **SC-008**: All CI gates green (client typecheck+build, client unit, server
  build/vet/test, e2e).

## Assumptions

- The versioned design handoff (`design/README.md`, `design/Armada.dc.html`)
  is the visual/behavioral source of truth; where it references a different
  UI stack, the design is recreated with Ring's own stack and components, and
  where it shows an AI opponent, PvP replaces it per the Decisions section.
- Wall spectators' experience (card + Follow) and the group-game retirement
  are governed by specs 0009/1035/1036 and are not re-specified here beyond
  "the card replaces the inline board for Armada".
- The existing one-game-per-chat rule, out-of-sync handling, seat-locking
  accept race, and device-local-secret precedent from battleship carry over
  unchanged unless explicitly amended above.
- Sound design reuses the existing naval foley set; new bespoke Armada audio
  is out of scope.
- Read-only fullscreen spectating, an AI practice mode, and fullscreen
  presentation for tic-tac-toe/Connect Four are explicitly out of scope (the
  infrastructure merely must not preclude them).
