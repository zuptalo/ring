# Feature Specification: Game Activity Notifies Players, Not the Whole Audience

**Feature Branch**: `feat/1035-game-activity-notifies`

**Created**: 2026-07-07

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User: "are we maybe sending too many notifications around games
played in groups or on the wall to people who are not participating? Audience
should get only the first invitation push if offline, no other game pushes
whatsoever, and only the final result as an in-app notification. Players should
always get a push when it's their turn if offline, and in-app notifications
that take them directly to the game when online."

## Today's behavior (audited)

- **Wall, server**: EVERY game engagement (each accept, each move) fans a
  content-free push to the ENTIRE post audience. A full Battleship game =
  dozens of wakes per spectator device — and since spec 1034, every one of
  those wakes surfaces at least the quiet generic. This is the noise.
- **Wall, client**: the classifier is already selective about what it SAYS
  (players: accept/turn/result; followers: moves/results behind switches;
  everyone else: quiet) — but a quiet classification no longer means an
  invisible wake, and a non-follower spectator never hears the result at all.
- **Groups**: moves are sealed messages, indistinguishable from chat on the
  server — fan-out is inherent. Observers are already told nothing per move
  in-app; offline they receive collapsed, silent quiet-generics.
- The initial challenge invitation is the POST-creation push — a separate
  path, already audience-wide and urgent-copy. Unchanged.

## Requirements

- **FR-001 (server)**: A `game` engagement pushes ONLY the participants —
  post author ∪ distinct actors of prior `game` engagements on that post —
  minus the current actor. Uses exclusively metadata the server already holds
  (engagement kind + actor); nothing new crosses the zero-knowledge boundary.
  Non-participant audience devices get ZERO game wakes; their one game-related
  push remains the challenge-post invitation itself.
- **FR-002 (players)**: unchanged semantics, now precise: the seated opponent
  is woken per activity and told "your turn" (or accept/result) with the note
  deep-linking to `/wall/post/<id>` — both the system notification and the
  in-app banner already navigate on tap.
- **FR-003 (audience, in-app)**: spectators (followed or not) get the FINAL
  RESULT as an in-app notification ("X won the game 🏆" / draw), behind the
  existing results switch, deduped per engagement as today. Followers keep
  their opt-in per-move notes. The switch is relabeled "Game results" since it
  no longer only covers followed games.
- **FR-004 (SW parity)**: the wake classifier mirrors FR-003 (a result can
  ride a wake caused by other activity), so page and SW tell the same story.
- **FR-005 (groups)**: explicitly unchanged — sealed moves cannot be
  selectively pushed without teaching the server who plays (a metadata leak),
  observers already get no per-move alerts, and the game-end state is visible
  in the chat itself. Accepted and documented.

## Zero-Knowledge Impact

Server routing uses only `kind` + `actor` on engagements it already stores;
identical information class to spec 0009's justified `game` kind. No payload
inspection, no new columns, no group changes.

## Success Criteria

- **SC-001**: Handler test proves: for a `game` engagement, pushes go to
  exactly (author ∪ prior game actors) − actor; a plain audience member is NOT
  pushed; the author is pushed on the opponent's accept.
- **SC-002**: Unit coverage for the classifier's new non-follower result note.
- **SC-003**: Full client + server gates green (`build`, vitest, `go test`,
  wall-activity e2e).
