# Contract: Armada protocol (spec 1038)

**Frozen once shipped.** All shapes ride the EXISTING sealed `gameMove` move
log (1:1) and wall `game` engagement rows — nothing new at the payload level.
Game id `armada`; theme id `classic`. Mixed-version safety: clients without
this module drop its signals and render the unknown-game fallback (spec 0008
contract), so nothing here may ever change behind the id.

## Layout (device-local until the reveal)

`layout` = array of exactly 5 ships in canonical CLASS order — Carrier(5),
Battleship(4), Cruiser(3), Submarine(3), Destroyer(2) — each
`{ r, c, len, dir }` (`dir` 'h'|'v') on the 10×10 grid (`cell = r*10 + c`,
0–99). `len` at index i MUST equal `[5,4,3,3,2][i]` (the two 3-cell classes
are distinguished by position, Cruiser before Submarine). Ships stay in
bounds and never overlap; touching is allowed.

`salt` = 32 random bytes, b64url (existing `randomBytes`).

Canonical serialization:

```
10x10|5,4,3,3,2|r.c.len.dir;r.c.len.dir;r.c.len.dir;r.c.len.dir;r.c.len.dir|<salt>
```

Commitment = SHA-256 of the serialization's UTF-8 bytes, b64url (existing
libsodium export via `src/services/crypto/primitives.ts`). The geometry
header (`10x10|5,4,3,3,2|`) is part of the preimage, so an armada commitment
can never verify under another game's rules (and battleship's `8x8|4,3,3,2|`
commitments can never verify here).

## Moves (inside `GameMoveSignal.move` / wall move records)

| Phase | Move | By | Rules |
|-------|------|----|-------|
| placing | `{ t:'commit', h }` | P0 then P1 (seq 1, 2) — SEQUENTIAL on the wire | `h` = the commitment. A second commit from the same seat, or any other move type, is illegal. Deployment still FEELS parallel: both players author their fleets simultaneously; P1's Engage STAGES the commit device-locally and the duty officer emits it the moment P0's commit lands. (Deliberate divergence from battleship-1033's parallel `mayMove` commits, whose seq race is a proven fork: two simultaneous seq-1 commits trip the engine's same-seq/different-content rule and kill the session as out-of-sync.) |
| battle | `{ t:'shot', cell }` | alternating attacker, P0 first | `cell` 0–99, never previously shot by this attacker. Strict alternation: the turn ALWAYS passes after the answer, hit or miss. |
| battle | `{ t:'answer', r }` | the defender, immediately after each shot | `r` ∈ miss/hit/sunk, judged against the defender's SECRET layout by their device. The FINAL answer (the 17th declared hit cell) MUST instead be `{ t:'answer', r:'sunk', reveal:{ layout, salt } }` — a final answer without the reveal is illegal. |
| verify | `{ t:'reveal', layout, salt }` | the WINNER, as the single legal next move | emitted automatically by the winner's device (duty officer). |

`turn()`/`mayMove()` encode all of the above; the 0008 engine's
ordering/turn/legality rules (`applySignal`) enforce them unchanged —
duplicates drop as `dup`, gaps/out-of-turn/illegal land on the labeled
out-of-sync terminal.

## Duty & re-emission (anti-stall, FR-009)

The defender's answer, the winner's reveal, and a STAGED commit whose slot has
opened are OWED moves: any device holding the seat's fleet secret MUST emit
the owed move whenever it observes the state (app open, live update, overlay
open) — not only while a board is rendered. Because the engine drops duplicate seqs, re-emission after an app
kill between judging and sending is idempotent and REQUIRED. A device without
the secret (a second own-device) owes nothing and stays silent.

## Status & verification (pure, identical on every device)

- `ongoing` through placing/battle/verify.
- After the winner's reveal, verify BOTH reveals: (a) commitment recomputes
  from the reveal, (b) layout is legal per this contract, (c) every answer
  that side gave matches the layout (miss/hit per cell; 'sunk' exactly on
  each ship's last hit cell).
- Both honest → `won` by the attacker of the final sunk. WINNER's reveal
  invalid → the win flips to the loser. LOSER's reveal invalid → verdict
  stands (the cheater lost anyway). Both invalid → `draw`. The proven cheater
  can never profit.
- Resign at any point → the engine's native resigned status; no reveals.

## What each party ever learns

Opponent + wall spectators, pre-terminal: commitments, shots, answers —
nothing about un-shot cells. Post-terminal: both layouts (the game's own
rule). The server: nothing beyond the already-accepted sealed-envelope
metadata (payload sizes/timing; on the Wall, the 1036 engagement cadence
incl. `gameover`). The fullscreen presentation adds ZERO wire traffic: the
overlay, floating pill, and banner suppression are entirely device-local.
