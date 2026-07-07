# Feature Specification: Followers Get the Result Push; Group Chats Retire Games

**Feature Branch**: `feat/1036-wall-game-follows`

**Created**: 2026-07-07

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User: (1) with 1:1 and Wall games, group-chat games are redundant —
remove that possibility; (2) the won/draw notification should go ONLY to those
who actually opted in to follow a wall game (e.g. someone who wanted to play
but lost the accept race), it should arrive as a push, and tapping it must
open exactly that game.

## Decisions

- **Follows become server-visible for wall games** (amends spec 0009 FR-006's
  local-only stance, at the user's direction): a push can only be routed to a
  follower the server knows about. Following a wall challenge now ALSO writes
  a content-free `follow` engagement on the post (payload sealed like every
  engagement; the server sees only "user X follows post Y" — the same
  visibility class as reacting to it). Unfollow tombstones it. The device-
  local ledger stays (source of truth for the UI and for old group games).
- **A finished game announces itself with a `gameover` engagement**, submitted
  by the device whose move ended the game (win, draw, or resignation). The
  server cannot read moves, so this is the only zero-knowledge-compatible way
  to fan out exactly one end-of-game push. Leak: the server learns WHEN a
  challenge's game ended — accepted, same class as seeing the engagement
  cadence stop.
- **Spectator result notes (spec 1035 FR-003) are reverted**: results go to
  followers only, per the user's refinement. The settings switch returns to
  its followed-games scope.
- **Group chats lose the game entry point** (amends specs 0008/0009): the
  attach menu offers games in 1:1 chats only. The engine, message kinds, and
  rendering stay — historic group games keep replaying and displaying, and
  the wire contract is untouched. Wall + 1:1 are the two ways to play.

## Requirements

- **FR-001 (server)**: `follow` and `gameover` are valid engagement kinds.
  `follow` never pushes anyone. `gameover` pushes participants ∪ un-tombstoned
  follow actors, minus the actor. `game` keeps its spec-1035 participants-only
  fan-out. The author-only fallback (reactions/comments) explicitly excludes
  the new kinds.
- **FR-002 (client, follow)**: following a WALL game submits the `follow`
  engagement (and remembers its id); unfollowing tombstones it. Both keep the
  local ledger in sync and degrade gracefully (local-only) if the server
  rejects the kind (older server).
- **FR-003 (client, game end)**: after a wall-game submission whose derived
  status is no longer ongoing, the submitting device also posts one `gameover`
  engagement (sealed, content-free). Best-effort: a lost `gameover` costs only
  the followers' push, never game correctness.
- **FR-004 (client, notes)**: follower result notes (SW + in-app) are
  unchanged and deep-link to `/wall/post/<id>`; plain spectators return to
  quiet (mid-game AND at the result).
- **FR-005 (groups)**: no game option in the group attach sheet. Existing
  group games render, play out, and resign-on-leave exactly as before.
- **FR-006**: pull/apply chains and old clients ignore the new kinds
  gracefully (verified: unknown kinds fall through).

## Zero-Knowledge Impact

Two new metadata facts, both user-directed and payload-free: who follows a
challenge post (equivalent class to engagement authorship the server already
stores) and when its game ended. Move/result CONTENT stays sealed; the server
still cannot tell who won or what was played.

## Success Criteria

- **SC-001**: Handler tests: `follow` pushes nobody; a move pushes only the
  opponent (not followers); `gameover` pushes opponent + followers, not
  tombstoned (unfollowed) ones, never the actor.
- **SC-002**: Classifier tests: follower gets the result note; plain spectator
  is quiet at the result (1035 revert).
- **SC-003**: Group chats show no game attach option (1:1 unchanged) —
  verified in the games e2e.
- **SC-004**: All gates green (client build+unit, server build/vet/test, games
  + wall e2e).
