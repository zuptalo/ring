# Data Model: Game Challenges in Groups and on the Wall

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-07-05

All additive; 1:1 sessions from spec 0008 are untouched (no `players` field ⇒
direction-derived roles, byte-identical behavior).

## GameSession additions (`src/games/types.ts`)

| Field | Type | Notes |
|-------|------|-------|
| `players` | `[string] \| [string, string]` (optional) | Explicit seats by userId: `[challenger]` while open, `[challenger, acceptor]` once locked. Presence ⇒ "explicit-players mode" (group + wall). |
| `challenge` | `{ accepts: {userId, at}[], cancelledAt?: number }` (optional) | Present ⇒ the bubble/post began as an open challenge. Accepts deduped by userId; creator/non-member accepts never stored. |

### Derived challenge phase (pure, `src/games/challenge.ts`)

```
open       challenge present, no lock, no cancel
accepted   seat resolved (pre-lock: min(accepts) by (at, userId); locked: players[1])
cancelled  cancelledAt set AND moves.length === 0   (accepts never override)
```

### Seat resolution + lock

- Pre-lock derived opponent = `min(challenge.accepts)` ordered `(at asc, userId asc)`.
- LOCK: the challenger's seq-1 `gameMove.opponent` pins `players[1]` as wire
  data; all later accepts drop. Race losers (their accept stored but not chosen)
  get the "got there first" presentation.
- `playerIndexOf(session, userId) → 0 | 1 | null`; null ⇒ caller DROPS the
  signal (never out-of-sync — third parties can't poison the board).

## Wire signals (sealed `MessagePayload`, groups)

| Field | Shape | Semantics |
|-------|-------|-----------|
| kind `'gamechallenge'` + `gameChallenge` | `{ gameType, theme? }` | The visible challenge bubble. Session starts `{ players:[sender], challenge:{accepts:[]} }`. Pre-0009 clients: unknown-kind fallback (deliberate — reusing `kind:'game'` would render a playable board with garbage roles on 0008 clients). |
| `gameAccept` | `{ messageId, at }` | Side effect: append `{from, at}` to accepts (dedupe; drop creator/non-members; drop after lock/cancel-with-no-moves). `at` is ORDERING-BEARING (unlike 0008's display-only `at`s). |
| `gameCancel` | `{ messageId, at }` | Creator-only (validated `from === players[0]`); sets `cancelledAt`. |
| `gameMove.opponent` | `string` (additive, seq 1 only) | The seat lock. Ignored on 1:1 sessions and by pre-0009 clients (unknown field). |

## Wall structures

| Where | Addition |
|-------|----------|
| `PostPayload` (sealed) | `game?: { gameType, theme? }`; post kind stays `'text'`, body = fallback copy for pre-0009 audiences. |
| `Post` row | `game?: { gameType, theme? }` persisted on create/receive. |
| `PostEngagement` union | `'game'` type; sealed payloads (under K_post): `{t:'accept',at}` \| `{t:'move',seq,action,move?,at,opponent?}`. Actor = server-attested engagement actor (same trust anchor as reactions). |
| Server | `validEngagementKind` gains `game` (one line, `posts_handlers.go:222`); `post_engagement.kind` column already free text — NO migration. Payload stays opaque to the server. |

### Wall session derivation (pure)

`buildWallSession(authorId, gameInfo, rows) → GameSession`: dedupe by engagement
id → accepts through the seat rule → moves sorted `(seq, at, actorId, id)`
through the 0008 engine with `playerIndexOf`. Derived live per render (the
replay-not-store doctrine); every device that pulls the same rows derives the
same session. Game `at`s feed the post keep-alive; post expiry deletes the game.

## Follow (device-local only)

`games.follows: Record<gameId, followedAt>` in settings — gameId is the bubble's
messageId (groups) or postId (wall). NEVER own-data-synced, never on the wire
(FR-006). Pruned when the target row/post is gone.

## Notification preferences (synced like other notifications.*)

`notifications.games.turn | .challenges | .followMoves | .followResults` — all
default true; consumed by the page path (`handleGameMove` group branch,
challenge/accept handlers) and the SW (`previewPending` passes them + the follow
set into the gameMove/gameAccept note branches).

## Group lifecycle interactions

- One-game gate: an OPEN challenge counts as ongoing for `hasOngoingGame`
  (creator's Cancel is the release — surfaced prominently when the gate blocks).
- Player leaves group: every member applies a local synthetic resign at the
  roster card's `at` — identical inputs, identical outcome, no wire signal.
- Rematch: always a fresh `'gamechallenge'` (never a locked rematch).
