# Implementation Plan: Armada — Fullscreen Naval Duel Replaces Battleship

**Branch**: `feat/1038-armada-fullscreen-naval` | **Date**: 2026-07-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/1038-armada-fullscreen-naval/spec.md`

## Summary

Two deliverables in one spec. (1) A fourth game module, `armada` — battleship's
commit-and-reveal protocol re-cut for a 10×10 board and the classic five-ship
fleet, with the design handoff's warship look (`design/`). (2) The first
fullscreen game presentation: an app-global overlay (launch surface stays
mounted underneath), a challenge card in place of the inline board, banners
rendering above the game with own-game suppression, a floating return pill
derived from session state, and — the correctness centerpiece — a
mount-independent "duty officer" that emits the defender's owed answers and
reveals, fixing the both-players-waiting stall class at its root (today the
auto-answer lives inside the board component and dies with it). Battleship
retires from the picker; its shipped contract is untouched. Server: zero
changes, verified by diff.

## Technical Context

**Language/Version**: TypeScript 5, Vue 3 `<script setup>` + Ionic 8; no
server work

**Primary Dependencies**: the 0008 game engine (unchanged: `src/games/
session.ts`, `challenge.ts`, wire kinds); libsodium SHA-256 + randomBytes via
`src/services/crypto/primitives.ts` (Principle IV — nothing bespoke); the
unified notification surface (`src/services/notify.ts` +
`NotificationBanners.vue`); the minimized-call widget pattern
(`MinimizedCall.vue`) for the floating pill

**Storage**: the shared session rides `Message.game` (1:1) / wall `game`
engagement rows exactly as today. Device-local fleet secret moves to a
namespaced generalization of battleship's helper (`armada.secret.<commitment>`
in the `settings` store, idb-direct, never synced, cleared at terminal).
No new object stores, no `DB_VERSION` bump.

**Testing**: vitest — full protocol suite (placement, phase machine, every
cheat class, convergence under reordered delivery), duty-officer re-emit
(kill-between-judge-and-send), ongoing-games query, suppression rules; e2e —
1:1 fullscreen duel + toast-over-game + pill round-trip, wall accept race,
battleship-retirement smoke; drive screenshots for the design review

**Target Platform / Project Type**: the PWA, client only

**Performance Goals**: sunk-ship smoke strictly time-boxed (~6.5 s, ≤3 puffs,
then unmounted — handoff perf rule); overlay animations GPU-friendly
(transform/opacity only); pill appears/disappears within 1 s of state change
(SC-005)

**Constraints**: wire id `armada` + move shapes frozen at ship
(contracts/armada-protocol.md); module functions synchronous (sodium ready
before game code — 0011 precedent); no new wire kinds/payload fields (FR-004);
banner overlay (z 19000) must stay above the game overlay; fullscreen via the
app root with promise-guarded calls; 1:1 + Wall only (groups have no game
entry since 1036)

**Scale/Scope**: one new game directory + one generic presentation layer
(overlay, card, pill, duty officer ≈ 5 new components/composables) + picker/
rematch retirement wiring + tests

## Constitution Check

- **I. Zero-Knowledge**: PASS — empty server diff; secrets never leave the
  device pre-reveal; the wire carries the same sealed kinds as 0008/0009; the
  new UI surfaces (overlay/pill/toasts) are entirely device-derived. Spec
  §FR-002 + checklists/zero-knowledge.md state the full model; the wall
  `gameover`/`follow` metadata surface is 1036's, unchanged.
- **II. Spec-Driven**: PASS — this plan follows specify → clarify (clean) →
  plan; checklist (zero-knowledge) opened at spec stage with plan-gated items
  CHK006/007/012 satisfied by `contracts/armada-protocol.md` in this phase.
- **III. TDD**: PASS — protocol suite red first (incl. every cheat class and
  the reorder/convergence + duty-officer re-emit scenarios per SC-002/003);
  e2e extends the games suite for the fullscreen flows.
- **IV. Crypto Discipline**: PASS — commitments reuse the exported libsodium
  SHA-256; 32-byte salts via existing `randomBytes`; pure functions, no idb in
  the game module (secret helper uses the idb wrapper directly, 0011
  precedent).
- **V. Offline-First**: PASS — no schema change; pill/badge read via
  `useLiveQuery` over existing stores.
- **VI. Stateless Server**: PASS — no server diff.
- **VII. Gates**: PASS — all four CI gates in scope; user-facing commit
  subjects will be release-note copy.
- **X/XI. A11y & Ionic-First**: PASS with reasoned deviations — the overlay
  chrome (header/buttons/log) composes stock Ionic (`ion-button`, `ion-icon`,
  `ion-badge`); the board itself is bespoke SVG/CSS-grid like every existing
  game board (no Ionic primitive draws a battle grid — same justification as
  0008/0011). Exit/rotate/fire controls get labels + focus states; board
  colors ride `--ring-*`/`--ion-color-*` tokens mapped from the handoff.

## Project Structure

### Documentation (this feature)

```text
specs/1038-armada-fullscreen-naval/
├── spec.md
├── plan.md                       # this file
├── research.md                   # phase 0 — decisions + rationale
├── data-model.md                 # phase 1 — entities & state
├── quickstart.md                 # phase 1 — dev/verify walkthrough
├── contracts/armada-protocol.md  # phase 1 — FROZEN wire/verification rules
├── checklists/                   # requirements.md, zero-knowledge.md
└── design/                       # vendored handoff (README + Armada.dc.html)
```

### Source Code (repository root)

```text
src/games/types.ts                    # +3 optional GameModule fields:
                                      #   presentation?: 'fullscreen'; retired?: true;
                                      #   successor?: string  (additive, all games unchanged)
src/games/armada/logic.ts             # NEW — pure protocol fork of battleship/logic.ts:
                                      #   SIZE=10, FLEET=[5,4,3,3,2], FLEET_CELLS=17,
                                      #   SHIP_CLASSES (carrier…destroyer), canonical
                                      #   serialization '10x10|5,4,3,3,2|…|salt', commitment,
                                      #   judgeShot, turn/mayMove (parallel placement,
                                      #   strict alternation), status incl. cheat flip,
                                      #   fleetView() (UI ship recs), randomLayout(rng)
src/games/armada/logic.test.ts        # NEW — red protocol suite (mirrors battleship's +
                                      #   reorder-convergence + geometry-binding cases)
src/games/armada/index.ts             # NEW — GameModule: id 'armada' FROZEN, one theme,
                                      #   presentation:'fullscreen', moveCue → existing bs-* cues
src/games/armada/ArmadaBoard.vue      # NEW — the handoff UI: deploy / battle / result faces,
                                      #   radar, reticle, fire/smoke (time-boxed), medal overlay;
                                      #   same :state/:my-player/:can-move/@move contract;
                                      #   NO auto-answer logic here (duty officer owns it)
src/games/armada/ShipSvg.vue          # NEW — parametric top-down silhouettes + wrecks
                                      #   (port of handoff shipTopSVG; stretch + rotate)
src/games/armada/MedalSvg.vue         # NEW — gold/iron medal (handoff medalSVG)
src/games/fleet-secret.ts             # NEW — namespaced device-local {layout,salt} helper
                                      #   (generalizes battleship/secret.ts; battleship's file
                                      #   becomes a thin forwarder or stays byte-identical —
                                      #   research.md D6)
src/games/duty.ts                     # NEW — pure "what do I owe?" resolver: given state +
                                      #   secret → owed answer/reveal move (unit-testable)
src/composables/useGameDuty.ts        # NEW — app-level watcher: for every ongoing armada
                                      #   session where I hold the secret, emit owed
                                      #   answers/reveals via playGameMove/playWallGameMove;
                                      #   runs on app open + live-query changes (FR-009)
src/composables/useGameOverlay.ts     # NEW — module-scoped overlay state {ref, open};
                                      #   openGame()/minimize()/close(); root requestFullscreen
                                      #   with .catch; fullscreenchange + ionBackButton wiring;
                                      #   notify.setActiveGame hand-off
src/composables/useOngoingGames.ts    # NEW — useLiveQuery over ongoingOverlayGames()
src/components/GameOverlay.vue        # NEW — app-global fullscreen host (App.vue mount),
                                      #   header (exit/title/context pill) + board slot;
                                      #   z between MinimizedCall (15000) and banners (19000)
src/components/GameChallengeCard.vue  # NEW — generic challenge card for
                                      #   presentation:'fullscreen' modules (handoff card
                                      #   design; states from deriveStatus + who's-next)
src/components/FloatingGameButton.vue # NEW — draggable pill (MinimizedCall drag/clamp
                                      #   pattern), awaiting-me ion-badge, ×N hint,
                                      #   offset from MinimizedCall
src/components/GameBubble.vue         # renders GameChallengeCard instead of the board when
                                      #   module.presentation === 'fullscreen'
src/components/WallGameCard.vue       # same presentation switch for wall posts; accept →
                                      #   openGame() into deployment
src/components/GamePicker.vue         # filters retired modules
src/views/detail/ChatDetailPage.vue   # onGameRematch resolves GAMES[gt].successor;
                                      #   armada card tap → openGame()
src/App.vue                           # mounts GameOverlay + FloatingGameButton; starts
                                      #   useGameDuty
src/services/notify.ts                # setActiveGame()/isGameActive() (mirror of
                                      #   setActiveChat); suppression checks in the game
                                      #   banner paths (queries.ts notifyWallGameActivity +
                                      #   chat gamemove note path)
src/db/queries.ts                     # ongoingOverlayGames() (chat messages ∪ wall posts,
                                      #   seat-held, ongoing, awaitingMe/lastActivityAt);
                                      #   rematch successor helper if needed
src/games/registry.ts / boards.ts     # +1 line each (armada); battleship gains
                                      #   retired:true + successor:'armada' in its index.ts
e2e/games-armada.spec.ts              # NEW — SC-001/003/004/005 flows
e2e/games.spec.ts                     # retirement assertions (picker, legacy battleship)
drive/scenarios/armada.mjs            # screenshots for design review
```

**Structure Decision**: the game itself follows the 0008-prescribed module
layout exactly (fork, not shared core — research.md D1). The presentation
layer is deliberately OUTSIDE `src/games/` (components/composables/services)
because it is app chrome, not game rules; `boards.ts` stays the only
Vue-importing file under `src/games/`. The one rules-adjacent addition,
`src/games/duty.ts`, stays pure (no Vue, no idb) so the stall fix is
unit-testable like the rest of the protocol.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|-----------|------------|--------------------------------------|
| App-level duty officer (`useGameDuty`) instead of board-mounted auto-answer | The defender's honesty step must run even when no board is mounted — with a fullscreen presentation there IS no inline board, and the mounted-board approach is the proven root cause of the both-waiting stall (spec FR-009) | Keeping 0011's board-local `autoActions` would make Armada stall whenever the defender doesn't open the overlay; a push-side answerer would need the secret in the SW (violates the device-local secret model) |
| Second fleet-secret namespace via a generalized helper | Armada secrets must never collide with battleship's while both games coexist | Reusing `battleship.secret.*` keys for armada would mix frozen and live namespaces; duplicating the helper wholesale adds a third copy to maintain |
| Overlay is a global component, not a route or `ion-modal` | The launch surface must stay mounted (exit = simply remove overlay), the game must survive navigation while minimized, and banners must render above it | A route unmounts the surface and fights the back stack; `ion-modal` traps focus/z-order above the banner stack and its dismiss lifecycle conflicts with minimize-vs-close semantics |
| Bespoke board rendering (SVG grid, ships, effects) | No Ionic primitive draws a naval battle grid; identical justification accepted for specs 0008/0010/0011 boards | Composing hundreds of `ion-*` elements per grid would be slower and less accessible than one SVG scene; the chrome around the board IS stock Ionic |
