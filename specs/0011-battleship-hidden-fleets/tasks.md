# Tasks: Battleship with Hidden Fleets

**Input**: Design documents from `/specs/0011-battleship-hidden-fleets/`

**Tests**: REQUIRED — constitution Principle III (red before green), doubly so
for the protocol: every cheat class is a test before the verifier exists.

## Phase 1: Foundational — the protocol, pure

- [X] T001 [P] Write FAILING protocol tests in src/games/battleship/logic.test.ts: placement generator legality (bounds/overlap over many seeded rolls); canonical serialization stability; commitment round-trip; phase machine (commit order, shots alternate, answer follows shot, repeat-shot illegal, final answer must carry the reveal, winner reveal is the only verify-phase move); verification (honest game → won; bad salt → flip; moved ship → flip; lied 'miss' on a hit → flip; both invalid → out-of-sync); resign skips reveals
- [X] T002 Implement src/games/battleship/logic.ts (pure; sha256 injected; seeded-RNG shuffle) until T001 greens

## Phase 2: US1 — the game in 1:1 chats

- [X] T003 [US1] src/games/battleship/secret.ts (device-local layout+salt per gameId in the settings store; create/read/clear) + module index.ts (id 'battleship' FROZEN, ≥3 themes vetted in the ledger) + registry/boards entries
- [X] T004 [US1] Write FAILING e2e e2e/games-battleship.spec.ts: shuffle/ready both sides; shots to a win with convergence; SC-002 secrecy assertion (no layout in any stored pre-terminal session on the opponent device); the reveal + verified result; offline-gap convergence; repeat-shot refusal
- [X] T005 [US1] BattleshipBoard.vue: placing view (your sea, Shuffle/Ready), battle view (opponent grid tap-to-fire + own mini grid), 💦💥🔥 marks with last-shot attention, AUTO-answer/AUTO-reveal watchers driven by replayed state vs the local secret, observer mode (two public grids, no secrets)
- [X] T006 [US1] Testhooks for placement/ready and grid reads (battleshipReady, battleshipShot via playGameMove, secrecy probe)

## Phase 3: US2 — challenges

- [X] T007 [US2] Extend the e2e: a 3-account group challenge where C observes shots/answers but provably holds no layout data until the reveal; a Wall pass (accept + a few shots converging over engagement records)

## Phase 4: Polish

- [X] T008 [P] drive/scenarios/battleship.mjs + screenshots (placing, mid-battle both views, observer, result)
- [X] T009 Docs + gates: ANIMATED-EMOJI rows (themes + 💦💥🔥 language); SC-005 diff verification; full unit + all game e2e suites; roadmap

## Dependencies

T001→T002→T003; T004 red after T003; T005 greens it; T006 with T004; T007 after T005; polish last.

## GitHub Issues

One issue per task (created 2026-07-06; the shipping PR must list Closes #N for each):
T001 #840 · T002 #841 · T003 #842 · T004 #843 · T005 #844 · T006 #845 · T007 #846 · T008 #847 · T009 #848 · 
