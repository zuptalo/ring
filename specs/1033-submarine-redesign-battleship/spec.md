# Feature Specification: Submarine Redesign of the Battleship Card

**Feature Branch**: `feat/1033-submarine-redesign-battleship`

**Created**: 2026-07-06

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: A high-fidelity design handoff (vendored at
[design/handoff.md](design/handoff.md), with the interactive prototype beside
it) redesigning the in-chat Battleship experience: submarine vector art, a
full-width shared game card, manual fleet placement, a sonar radar sweep, and
custom shot/result iconography. The handoff is the authoritative pixel spec;
this document fixes its scope, contracts, and acceptance.

**Depends on**: spec 0011 (Battleship). **Changes NO game rules**: the
commit-and-reveal protocol, engine, secret store, and wire shapes stay
byte-identical — the handoff itself mandates this ("Keep the real protocol").

## Scope decisions (this repo's reading of the handoff)

- **Full-width neutral card applies to ALL game bubbles** (tic-tac-toe,
  Connect Four, Battleship, challenges): a game is a shared surface, not one
  side's message; per-game full-width would be inconsistent side by side.
- **Submarine art, radar, custom shot icons, manual placement, and the
  medallion overlay are Battleship-only.** Other games keep their emoji
  language (their specs' design), rendered inside the new card shell.
- **Wreck reveal timing follows the protocol**, as the handoff instructs: your
  own sunk sub becomes a wreck immediately (you know your layout); the
  opponent's wrecks appear only at the end-of-game reveal. During battle their
  sunk cells show the charred/sunk tint.
- **Themes**: the three shipped Battleship theme ids stay registered (wire ids
  are frozen); the board's new art supersedes their marks visually. The picker
  keeps offering them (they still tint accents); marks remain for previews.

## User Stories

### US1 — The game card (all games)
A game message renders as a full-width neutral card (light/dark surface per
the handoff tokens), not a right-aligned green bubble.

**Acceptance**: game and challenge bubbles span the message column with the
card surface/border/radius from the handoff in both themes; every other
message kind is untouched; existing game e2e suites pass unchanged.

### US2 — Submarines, shots, and radar (Battleship battle)
The two seas render water-depth gradients with continuous submarine vessels
positioned by the handoff's overlay math. Shots use the custom iconography:
reticle while pending, sonar ripple for a miss, layered flames per hit cell,
charred/sunk tints, and wreck reveals per the protocol timing. A sonar radar
(trailing-fade sweep, range rings, ping) overlays the opponent sea — brighter
on your turn — while never blocking taps.

**Acceptance**: a full game shows every state visually (verified on the live
UI); the radar rotates with the fade trailing the bright edge; observers see
both public seas with no fleet data (unchanged secrecy).

### US3 — Manual fleet placement
During placing, your pre-shuffled submarines can be dragged to new cells
(snap-to-grid, shadow lift, red tint + snap-back when illegal) and tapped to
rotate 90° (declined when it would not fit). Shuffle remains; **Deploy fleet**
commits exactly like today's Ready (same `commitment(layout, salt)` →
`setFleetSecret` → commit move).

**Acceptance**: drag, rotate, invalid-drop snap-back, and deploy all work by
touch and mouse; the committed layout is whatever was authored; the protocol
e2e still passes with the renamed button.

### US4 — Result medallion (Battleship)
The finished Battleship board shows the gold/silver medallion overlay with the
result line and Rematch, per the handoff; other games keep their emoji
overlay. Observer endgame rules (spec 0009) are preserved: named winner, no
peek, "Start your own challenge".

## Zero-Knowledge Impact

None on the wire or server: presentation and local placement only. The
authored layout feeds the SAME sealed commitment; no new data crosses.
`git diff develop -- server/ src/games/battleship/logic.ts src/games/battleship/secret.ts src/services/crypto/` must be empty.

## Success Criteria

- **SC-001**: Protocol untouched by diff (files above) and the full Battleship
  e2e suite passes (with only the Ready→Deploy label updated in tests).
- **SC-002**: All game e2e suites pass; no engine/challenge-layer changes.
- **SC-003**: The handoff's states verified visually on the live UI: placing
  (drag + rotate + invalid), battle (reticle/ripple/fire/sunk/radar, both
  turn states), own-wreck, end-of-game their-wreck, medallion, dark mode.
- **SC-004**: The card shell renders all four bubble kinds full-width without
  regressing non-game messages (visual pass).
