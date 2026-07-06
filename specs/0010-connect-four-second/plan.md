# Implementation Plan: Connect Four, the Second Built-in Game

**Branch**: `feat/0010-connect-four-second` | **Date**: 2026-07-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/0010-connect-four-second/spec.md`

## Summary

One new bundled game module (`connect4`) + one board component + one registry
entry. The engine, wire contract, challenge layer, notifications, stats, and
server are deliberately untouched — this spec exists to prove spec 0008's
plugin claim: a new game is a directory and two registry lines.

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 + Ionic); no server work

**Primary Dependencies**: spec 0008's `GameModule` interface + session engine;
spec 0009's challenge layer (consumed, not modified)

**Storage**: none new — the existing `Message.game` / engagement replay carries
the new gameType and `{ col }` moves inside the same sealed structures

**Testing**: vitest for the pure logic (win directions, gravity, full column,
draw); one Playwright e2e for 1:1 + a group/Wall pass; drive screenshots

**Target Platform / Project Type**: the existing PWA, client only

**Performance Goals**: none new (42-cell replay is trivial)

**Constraints**: wire id `connect4` and move shape `{ col: 0-6 }` frozen once
shipped; the 7×6 board must fit the existing bubble width

**Scale/Scope**: ~4 new files + 2 registry lines + docs rows

## Constitution Check

- **I. Zero-Knowledge**: PASS — empty server diff (SC-004); nothing new on the
  wire beyond a string value and `{col}` inside existing sealed payloads.
- **II. Spec-driven**: PASS — this pipeline.
- **III. TDD**: PASS — failing logic tests and e2e precede implementation.
- **IV. Crypto Discipline**: PASS — untouched.
- **V. Offline-first**: PASS — same move-log replay; no migrations.
- **VI. Stateless server**: PASS — no server changes at all.
- **VII–XI**: PASS — release-note subject; no telemetry; Ionic-first board;
  design-ledger rows for the new themes (Principle X copy voice).

## Project Structure

### Documentation (this feature)

```text
specs/0010-connect-four-second/
├── spec.md, plan.md, tasks.md
└── checklists/requirements.md   # ZK impact is nil; the 0008 wire contract governs
```

### Source Code

```text
src/games/connect4/logic.ts            # NEW — pure rules: C4State { cells: (0|1|null)[] (42, row-major),
                                       #   } · move { col } · gravity, 4-in-a-row (H/V/2 diagonals), draw at 42
src/games/connect4/logic.test.ts       # NEW — the red suite: every win direction, gravity stacking,
                                       #   full-column illegal, draw board, out-of-range col
src/games/connect4/index.ts            # NEW — GameModule wrapper: id 'connect4', displayName 'Connect Four',
                                       #   icon (Ionicon DATA import, 0008 convention), themes (≥3: classic
                                       #   red/yellow discs + emoji pairs from the design ledger)
src/games/connect4/ConnectFourBoard.vue# NEW — 7×6 board, tap-a-COLUMN input, lowest-free-cell render,
                                       #   last-move highlight, theme marks/accent (same props as TicTacToeBoard)
src/games/registry.ts                  # +1 entry
src/games/boards.ts                    # +1 entry (the only Vue-importing map)
e2e/games-connect4.spec.ts             # NEW — 1:1 win+draw+full-column; a group challenge pass
docs/ANIMATED-EMOJI.md                 # theme rows for the new marks
drive/scenarios/connect4.mjs           # screenshots for review
```

**Structure Decision**: exactly the layout spec 0008 prescribed for new games.
No research.md/data-model.md/contracts: the 0008 documents govern; the module's
state shape is internal to the module (never on the wire — only `{col}` moves).

## Complexity Tracking

None — the feature's success criterion is the absence of platform changes.
