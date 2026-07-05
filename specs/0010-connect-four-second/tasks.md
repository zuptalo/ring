# Tasks: Connect Four, the Second Built-in Game

**Input**: Design documents from `/specs/0010-connect-four-second/`

**Tests**: REQUIRED — constitution Principle III (red before green).

## Phase 1: Foundational

- [ ] T001 [P] Write FAILING pure-logic tests in src/games/connect4/logic.test.ts: gravity stacking per column; wins in all four directions (incl. both diagonals at edges); full-column move = null; out-of-range col = null; 42-move draw; turn alternation
- [ ] T002 Implement src/games/connect4/logic.ts (pure; no imports beyond types) until T001 is green

## Phase 2: US1 — the game, playable in 1:1 chats

- [ ] T003 [US1] Module + registration: src/games/connect4/index.ts (id 'connect4' FROZEN, displayName, Ionicon data icon, ≥3 themes: classic discs + emoji pairs vetted against docs/ANIMATED-EMOJI.md), entries in src/games/registry.ts and src/games/boards.ts
- [ ] T004 [US1] Write FAILING e2e e2e/games-connect4.spec.ts (precedent games.spec.ts): picker lists both games; 1:1 game to a vertical win with convergence on both devices; full-column tap refused; draw path; gate shared with tic-tac-toe
- [ ] T005 [US1] Board component src/games/connect4/ConnectFourBoard.vue: 7×6 slots, per-COLUMN tap, lowest-free-cell placement, last-move highlight, theme marks + accent, fits the existing bubble/card width (same props contract as TicTacToeBoard.vue)

## Phase 3: US2 — challenges (groups + Wall)

- [ ] T006 [US2] Extend the e2e with a 3-account group challenge playing Connect Four to a diagonal win (A challenges, B accepts, C observes) and a Wall challenge pass (accept + a few moves + convergence) — asserting NO challenge-layer behavior change

## Phase 4: Polish

- [ ] T007 [P] Drive scenario drive/scenarios/connect4.mjs + screenshots reviewed (both themes, mid-game, result overlay, group observer)
- [ ] T008 Docs + gates: ANIMATED-EMOJI.md theme rows; verify SC-003 (no engine/challenge/crypto/notification diffs) and SC-004 (empty server diff); full unit + games e2e suites; `make roadmap` after status bumps

## Dependencies

T001→T002→T003; T004 red after T003 (needs the picker entry); T005 greens T004's board interactions; T006 after T005; polish last.

## GitHub Issues

One issue per task (created 2026-07-06; the feature → develop PR must list Closes #N for each):
T001 #832 · T002 #833 · T003 #834 · T004 #835 · T005 #836 · T006 #837 · T007 #838 · T008 #839 · 
