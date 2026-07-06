# Feature Specification: Battleship with Hidden Fleets

**Feature Branch**: `feat/0011-battleship-hidden-fleets`

**Created**: 2026-07-06

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User description: "Add Battleship as the third built-in game before
shipping: secret ship placements, playable like the other games in 1:1 chats,
group challenges, and Wall challenges."

**Depends on**: specs 0008/0009/0010 (platform + challenges + the two-game
catalog). First game with HIDDEN information — the secrets stay on-device and
honesty is enforced by commitments, still with zero platform or server changes.

## Clarifications

### Session 2026-07-06

- Q: Board and fleet? → A: Compact 8×8 with four ships (4, 3, 3, 2 = 12 cells) —
  phone-bubble-sized cells and chat-length games.
- Q: Ship placement UX? → A: Shuffle then Ready: the fleet starts randomly
  placed; Shuffle re-rolls until happy, Ready locks it in. Manual placement is a
  possible later enhancement, not in scope.
- Q: How do hidden boards stay honest without a referee? → A: Commit-and-reveal:
  each side's first move is a hash commitment to their salted layout; shots and
  answers ride the ordinary move log; at the end BOTH layouts are revealed and
  every answer is re-checked against them — a proven lie loses the game,
  labeled. During play answers are trusted (the friendly-opponent stance the
  platform has always taken: containment and detection, not prevention).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Battleship in a 1:1 chat (Priority: P1)

Pick Battleship from the (now three-game) picker. Your fleet appears randomly
placed on your 8×8 sea; Shuffle re-rolls it, Ready locks it. Once both players
are ready, the starter fires first: tap a cell on the opponent grid, see 💦
miss / 💥 hit / 🔥 sunk. Turns alternate shots. When a fleet is fully sunk the
result overlay lands, the boards are revealed to each other, and the win is
confirmed as honest — all the platform trimmings (turn cues + notifications,
re-surfacing, sounds, stats, resign, Play again, the one-game gate) unchanged.

**Independent Test**: Two accounts place (shuffle/ready), exchange shots to a
win; both devices converge on the identical verified result; neither device
ever received the other's layout before the end.

**Acceptance Scenarios**:

1. **Given** a fresh Battleship bubble, **When** it opens, **Then** each player
   sees their own randomly placed fleet with Shuffle and Ready, and CANNOT see
   or infer the opponent's placement from anything their device received.
2. **Given** one player Ready and the other still shuffling, **Then** the ready
   side shows "waiting"; shots are impossible until both are ready.
3. **Given** both ready, **When** the starter taps an opponent cell, **Then**
   both devices record the shot and the defender's device answers miss/hit/sunk
   automatically from its own secret layout.
4. **Given** an answered shot, **Then** the attacker's grid marks it (miss/hit/
   sunk) identically on both devices, and the turn passes.
5. **Given** the 12th hit cell (a whole fleet), **Then** the game ends with the
   winner named, both layouts are revealed and checked, and the standard result
   overlay + stats show.
6. **Given** a revealed layout that does not match its commitment or its
   answers, **Then** BOTH devices flip the result: the cheater loses, and the
   result line says the win was by forfeit.
7. **Given** an ongoing game, **When** a player resigns, **Then** it ends as a
   concession with no reveal required.

---

### User Story 2 - Battleship challenges in groups and on the Wall (Priority: P2)

The challenge loop (spec 0009) carries Battleship unchanged: first to accept
plays, and observers/followers watch the PUBLIC battle — shots landing as
miss/hit/sunk on both grids — while both fleets stay secret from everyone,
observers included, until the end-of-game reveal.

**Acceptance Scenarios**:

1. **Given** a group Battleship challenge, **When** it is played, **Then**
   observers see shots and results in real time but no ship positions until the
   game ends.
2. **Given** a Wall Battleship challenge, **Then** the same holds over the
   sealed engagement records, with stats on the post page.

---

### User Story 3 - It reads like Battleship (Priority: P3)

Two grids in the bubble: the opponent's sea on top (your targeting grid — tap
to fire), your own fleet below at a glance with incoming shots marked. Placing
shows your sea large with Shuffle/Ready. Miss/hit/sunk use the standard emoji
language; the last shot carries the attention animation; themes follow the
established pattern.

**Acceptance Scenarios**:

1. **Given** the battle phase, **Then** the attacker taps the OPPONENT grid;
   your own grid is informational (your ships + their shots).
2. **Given** any phase, **Then** the bubble fits the standard width with
   column/row tap targets usable on a phone.
3. **Given** the themes, **Then** at least three ship (~non-classic mark) styles
   ship, recorded in the design ledger.

---

### Edge Cases

- **Shot at an already-shot cell**: refused locally (illegal), like any taken
  cell in the other games.
- **Answer that contradicts an earlier answer** (same cell answered twice
  differently) is impossible by construction (cells are shot once); an answer
  from the wrong side or out of order is dropped by the engine's existing rules.
- **The loser's device must reveal with its final answer** — a final "sunk"
  without the reveal attached is an illegal move (dropped), so the game cannot
  end unverified; the winner's device auto-reveals immediately after. A winner
  who never comes back online leaves the game "finishing" — the same open-ended
  wait any unfinished game has.
- **Old app versions**: the shipped unknown-game fallback, as with Connect Four.
- **TTL / deletion**: the bubble and its on-device secret die together.
- **Draws**: none — Battleship always has a winner (or a resignation).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A third bundled module `battleship` MUST implement the existing
  GameModule interface with NO changes to the engine, wire contract, challenge
  layer, or server (the platform's hidden-information proof point).
- **FR-002**: The sea is 8×8 with ships of length 4, 3, 3, 2 placed
  horizontally/vertically without overlap; placement is random with Shuffle,
  locked by Ready; a game is won when all 12 of one side's ship cells are hit.
- **FR-003**: A player's layout MUST never leave their device before the
  end-of-game reveal: the shared move log carries only (a) a salted-hash
  COMMITMENT per player, (b) shots, (c) miss/hit/sunk answers, (d) the final
  reveals. Observers learn exactly what the players' public grids show.
- **FR-004**: The defender's device MUST answer incoming shots automatically
  from its secret layout (no manual honesty step); answers and reveals are
  ordinary moves in the log so every device replays the identical public state.
- **FR-005**: At game end both layouts MUST be revealed (the loser's riding the
  final answer, the winner's immediately after) and verified by every device
  against the commitments and the complete answer history; a mismatch flips the
  result against the cheater, deterministically everywhere.
- **FR-006**: All platform behaviors apply unchanged: notifications + settings,
  follows, sounds, stats, re-surfacing, resign, rematch, the one-game gate,
  sealed player identity on the Wall.
- **FR-007**: The wire id `battleship` and its move shapes MUST be frozen once
  shipped. The commitment MUST use the app's existing hashing (libsodium
  SHA-256) over a canonical serialization with a 32-byte random salt.

### Zero-Knowledge Impact *(mandatory here — hidden state + commitments)*

- **What crosses the wire**: the existing sealed structures carrying the new
  gameType and its move shapes (commitment hashes, shot cells, answers,
  end-of-game reveals). Layouts cross ONLY as the final reveal, sealed
  end-to-end like every move.
- **What the server sees**: nothing new; the server diff is EMPTY.
- **What the OPPONENT (and observers) learn during play**: commitments (opaque),
  shots, and answers — nothing about un-shot cells; the reveal at the end is
  the game's own rule, visible exactly to those who could watch the game.
- **Trust model**: friendly-opponent with detection — in-play answers are
  trusted, end-of-game verification is mandatory and deterministic, cheating
  costs the game. No referee, no server involvement.

### Success Criteria *(mandatory)*

- **SC-001**: A full 1:1 game (shuffle/ready, shots to a win, reveal + verify)
  converges identically on both devices, including across an offline gap.
- **SC-002**: A device is provably never sent the opponent layout before the
  reveal (asserted from the stored session in e2e: no layout data in any
  pre-terminal state).
- **SC-003**: A tampered reveal (wrong salt/layout) flips the result against
  the cheater on BOTH devices (unit-proven against the pure module).
- **SC-004**: Group and Wall challenges play Battleship with observers seeing
  only public grids; zero challenge-layer diffs.
- **SC-005**: `git diff --stat server/` stays empty; engine/crypto/notification
  files stay untouched (by diff, as spec 0010 established).
- **SC-006**: Existing game suites pass unchanged.

### Assumptions

- Ships may touch (no adjacency rule) — keeps placement simple; standard in
  many digital versions.
- The starter (player 0 / challenger) fires first.
- One shot per turn (no salvo variant).
- Auto-answering requires the defender's app to open the game at least
  momentarily; turn notifications already drive exactly that.
