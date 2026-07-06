# Implementation Plan: Battleship with Hidden Fleets

**Branch**: `feat/0011-battleship-hidden-fleets` | **Date**: 2026-07-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/0011-battleship-hidden-fleets/spec.md`

## Summary

The third game module, and the first with hidden information — fitted entirely
inside the existing GameModule contract. The module's replayed state is the
PUBLIC game (commitments, shots, answers, reveals, phase machine); each
player's secret layout+salt lives only on their device. Honesty is
commit-and-reveal: verification is a pure function of the shared log, so every
device (players and observers alike) flips a cheated result identically.
Platform, challenge layer, and server: zero changes, verified by diff.

## Technical Context

**Language/Version**: TypeScript 5; no server work

**Primary Dependencies**: the 0008 engine (unchanged); libsodium SHA-256 via
`src/services/crypto/primitives.ts` (already exported — no new primitives,
Principle IV)

**Storage**: the shared session rides `Message.game` / wall engagement as
usual. NEW device-local secret: `{ layout, salt }` per game, stored under a
namespaced key in the existing `settings` store by a tiny module-local helper
(`src/games/battleship/secret.ts` using `@/db/idb` directly — no queries
import, no cycles, never own-synced). Removed when the game ends.

**Testing**: vitest for the full protocol (placement generator, state machine,
answer validation, reveal verification incl. every cheat class); e2e for the
1:1 game with offline gap + a group pass with observer-blindness assertions;
drive screenshots

**Target Platform / Project Type**: the PWA, client only

**Constraints**: wire id `battleship` + move shapes frozen; all module
functions stay synchronous (sodium is initialized before any game runs —
tests await `ready()` in beforeAll); the bubble fits two 8×8 grids stacked

**Scale/Scope**: one game directory (logic + module + board + secret helper) +
2 registry lines + tests + docs

## Constitution Check

- **I. Zero-Knowledge**: PASS — empty server diff; secrets never leave the
  device pre-reveal; the reveal is sealed E2EE like every move and visible only
  to the game's audience. Spec's ZK section states the full trust model.
- **III. TDD**: PASS — the protocol suite (incl. all cheat classes) is red
  first; e2e asserts SC-002 device-never-received-layout from stored state.
- **IV. Crypto Discipline**: PASS — commitments use the existing libsodium
  SHA-256 export; 32-byte salts via the existing randomBytes; nothing bespoke.
- **V/VI**: PASS — no migrations (settings-store key), no server changes.
- Others: PASS as in spec 0010.

## Project Structure

```text
src/games/battleship/logic.ts           # NEW — pure protocol: BsPublicState replay
                                        #   (phase: placing→battle→verify→done), placement
                                        #   generator+validator (8×8; 4,3,3,2; shuffle from
                                        #   injected RNG), turn(), applyMove() per phase,
                                        #   status() incl. reveal verification + cheat flip,
                                        #   canonical layout serialization + commitment hash
src/games/battleship/logic.test.ts      # NEW — red protocol suite: placement legality,
                                        #   phase machine, shot/answer ordering, repeat-shot
                                        #   rejection, forced final reveal, verification math,
                                        #   EVERY cheat class (bad salt, moved ship, lied
                                        #   answer→flip), resign-skips-reveal
src/games/battleship/secret.ts          # NEW — device-local {layout,salt} per gameId in the
                                        #   settings store (idb direct); create/read/clear
src/games/battleship/index.ts           # NEW — GameModule wrapper (id 'battleship' FROZEN,
                                        #   themes ≥3), sha256 injected from crypto/primitives
src/games/battleship/BattleshipBoard.vue# NEW — placing view (your sea + Shuffle/Ready) and
                                        #   battle view (opponent grid = tap-to-fire, own grid
                                        #   mini below); AUTO-sends answers/reveals by watching
                                        #   the replayed state vs the local secret; observers
                                        #   see both public grids
src/games/registry.ts / boards.ts       # +1 line each
e2e/games-battleship.spec.ts            # NEW — SC-001/002/004 flows
docs/ANIMATED-EMOJI.md                  # theme + shot-language rows (💦💥🔥)
drive/scenarios/battleship.mjs          # screenshots
specs/0011-.../contracts/battleship-protocol.md  # the frozen move shapes + verification rules
specs/0011-.../checklists/zero-knowledge.md      # REQUIRED (crypto + hidden state)
```

**Structure Decision**: everything inside the game directory; the ONLY reach
outside the 0008-prescribed layout is the tiny secret helper (still inside the
directory, storage via the existing idb wrapper).

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|-----------|------------|--------------------------------------|
| Device-local secret store (settings-store key per game) | Hidden layouts cannot live in the shared replayed session | Keeping layouts in the session (like other games' state) would hand them to the opponent and observers — the whole game is the secret |
| Board component auto-sends moves (answers/reveals) | The defender's honesty step must be automatic; reveals are protocol bookkeeping | A manual "answer" button would be absurd UX and add a lying affordance; a queries-level hook would touch the platform this spec promises not to touch |
