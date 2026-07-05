# Contract: Wall game engagement records

**Spec**: [../spec.md](../spec.md) | **Date**: 2026-07-05

A Wall challenge is an ordinary audience-sealed post whose sealed payload adds
`game: { gameType, theme? }` (post kind stays `'text'`; the body carries
fallback copy so pre-0009 audiences see a harmless text post).

## Engagement kind `game`

Accepts and moves are engagement records exactly like reactions/comments:
sealed under K_post, actor attested by the server, pull-synced per post, plus
the existing content-free `post-engagement` WS nudge to the online audience.

```jsonc
// sealed payloads (kind: "game")
// An accept may carry the acceptor's own display name + a small avatar
// thumbnail: the audience are the AUTHOR's friends, not necessarily the
// acceptor's, and a game readable by them names its players for them too.
// (The challenger's equivalents ride in the post payload: game.hostName /
// game.hostAvatar.) Sealed under K_post like everything else.
{ "t": "accept", "at": 1751712000000, "name": "Bob", "avatar": "data:image/..." }
{ "t": "move", "seq": 1, "action": "move", "move": { "cell": 4 }, "at": ..., "opponent": "<userId>" }
{ "t": "move", "seq": 6, "action": "resign", "at": ... }
```

- Cancel = the author deletes the post (existing revoke flow).
- Replay: `buildWallSession` — dedupe by engagement id; accepts → the
  challenge-payload seat rule; moves sorted `(seq, at, actorId, id)` through the
  0008 engine. Same pulled set ⇒ same session on every device; forks render the
  0008 out-of-sync terminal.
- Post lifetime bounds the game; game `at`s feed the keep-alive bump.

## Server surface (two minimal changes)

1. `validEngagementKind` (server/internal/api/posts_handlers.go:222) gains
   `game`. No SQL migration (`post_engagement.kind` is free text); the payload
   stays an opaque sealed blob.
2. For `kind == 'game'` engagement, the existing CONTENT-FREE wall push fans to
   the post's full audience (author-only today, spec 1031): the push carries no
   game data; each woken device pulls, decrypts under K_post, and decides
   locally (turn/follow settings) whether to show anything.

The server learns only that a post has game-type engagement — the same class of
metadata as its existing reaction-vs-comment distinction.
