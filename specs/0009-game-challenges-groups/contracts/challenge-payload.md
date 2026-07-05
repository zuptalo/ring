# Contract: Challenge signals on the sealed message channel (groups)

**Spec**: [../spec.md](../spec.md) | **Date**: 2026-07-05

Additive fields on `MessagePayload` (sealed, opaque to the server), extending
spec 0008's `contracts/game-payload.md`. Frozen once shipped.

## 1. Challenge start (visible message)

```jsonc
{ "kind": "gamechallenge", "gameChallenge": { "gameType": "tictactoe", "theme": "space" } }
```
- Sender = challenger = player 0. Session begins `players:[sender]`,
  `challenge:{accepts:[]}` on every member's device.
- DELIBERATELY a new kind: 0008-era clients would render `kind:'game'` as a
  playable board with direction-derived (garbage) roles in a group; the new kind
  gets the safe unknown-kind fallback instead.

## 2. Accept (side effect)

```jsonc
{ "gameAccept": { "messageId": "<challenge bubble id>", "at": 1751712000000 } }
```
- Receiver appends `{sender, at}` to `challenge.accepts` (dedupe by user; drop
  the creator's own accept, non-members, and anything after the seat locks or a
  clean cancel). **`at` is ORDERING-BEARING**: the seat is `min(accepts)` by
  `(at asc, userId asc)` — pure data ordering, never arrival order.

## 3. Seat lock (rides the first move)

`GameMoveSignal` gains additive `opponent?: string`, REQUIRED on seq 1 of an
explicit-players session: the challenger stamps the resolved seat, receivers pin
`players[1] = opponent`, and every later accept drops. This closes the race
identically everywhere — an accept still in transit at lock time loses even
with an earlier stamp (the only closure that never invalidates played moves).

## 4. Cancel (side effect, creator only)

```jsonc
{ "gameCancel": { "messageId": "<challenge bubble id>", "at": 1751712000000 } }
```
Valid only from `players[0]`. Withdrawn iff `cancelledAt` set AND no moves —
accepts never override a cancel; a cancelling challenger never plays seq 1.

## 5. Tolerance rules

- Signals from non-players on a locked session → DROP, never out-of-sync.
- Unknown fields/kinds ignorable by older clients (payload-level additivity).
  Known skew debris: pre-0009 members store one stray fallback bubble per
  accept/cancel — bounded, documented, accepted.
- Sender-claimed `at` can win the seat with a skewed clock — contained (a
  different friend gets the seat; all devices still converge), same
  tamper-containment stance as 0008.
