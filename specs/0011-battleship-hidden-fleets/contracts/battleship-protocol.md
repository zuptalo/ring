# Contract: Battleship protocol (spec 0011)

**Frozen once shipped.** All shapes ride the EXISTING sealed `gameMove` move
log (1:1/groups) and wall `game` engagement — nothing new at the payload level.

## Layout (device-local until the reveal)

`layout` = array of 4 ships, each `{ r, c, len, dir }` (dir 'h'|'v'), on the
8×8 grid, in canonical order (descending len, then r, then c). Ships stay in
bounds and never overlap; touching is allowed. `salt` = 32 random bytes
(b64url). Canonical serialization: `8x8|4,3,3,2|` + ships as `r.c.len.dir`
joined by `;` + `|` + salt. Commitment = SHA-256 of its UTF-8 bytes (b64url).

## Moves (inside GameMoveSignal.move / wall move records)

| Phase | Move | By | Rules |
|-------|------|----|-------|
| placing | `{ t:'commit', h }` | P0 then P1 (seq 1, 2) | h = the commitment. A second commit from the same side, or any other move type, is illegal. |
| battle | `{ t:'shot', cell }` | alternating attacker, P0 first | cell 0–63, never previously shot by this attacker. |
| battle | `{ t:'answer', r }` | the defender, immediately after each shot | r ∈ miss/hit/sunk, judged against the defender's SECRET layout by their device. The FINAL answer (12th hit cell) MUST instead be `{ t:'answer', r:'sunk', reveal:{ layout, salt } }` — a final answer without the reveal is illegal. |
| verify | `{ t:'reveal', layout, salt }` | the WINNER, as the single legal next move | auto-sent by the winner's device. |

`turn()` encodes all of the above; the 0008 engine's ordering/turn/legality
rules enforce it unchanged.

## Status & verification (pure, identical on every device)

- `ongoing` through placing/battle/verify.
- After the winner's reveal: verify BOTH reveals — (a) commitment matches,
  (b) layout is legal, (c) every answer that side gave matches the layout
  (miss/hit per cell; 'sunk' exactly on each ship's last hit cell).
- Both honest → `won` by the attacker of the final sunk. Either reveal
  invalid → `won` by the OTHER side (the cheat flip). Both invalid →
  `out-of-sync` (a broken game, not a winner).
- Resign at any point → the engine's native resigned status; no reveals.

## What each party ever learns

Opponent + observers, pre-terminal: commitments, shots, answers. Nothing about
un-shot cells. Post-terminal: both layouts (the game's own rule). The server:
nothing, ever.
