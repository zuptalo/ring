# Tasks: Armada — Fullscreen Naval Duel Replaces Battleship

**Input**: Design documents from `/specs/1038-armada-fullscreen-naval/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/armada-protocol.md, design/ (handoff)

**Tests**: REQUIRED — constitution Principle III (Red → Green). Every RED task
must be committed failing before its GREEN counterpart lands.

**Organization**: grouped by user story; US1+US2 together are the shippable
MVP (US2 carries FR-007/008, without which fullscreen play traps the user).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

**Purpose**: additive contracts everything else compiles against

- [ ] T001 Add optional `presentation?: 'fullscreen'`, `retired?: true`, `successor?: string` fields to `GameModule` in `src/games/types.ts` (doc comments explaining each; no game changes yet — typecheck stays green)

---

## Phase 2: Foundational (protocol core + shared queries — blocks all stories)

**Purpose**: the pure armada protocol, the duty resolver, the secret helper,
the ongoing-games query, and module registration — everything both the
overlay (US1/US3) and the pill (US2) consume

- [ ] T002 [P] RED: author the failing protocol suite in `src/games/armada/logic.test.ts` — placement legality (canonical class order, bounds, overlap, both 3-ship classes), parallel commits (either order, second commit illegal), strict alternation + repeat-shot rejection, defender-answer interleave, forced reveal on the 17th declared hit, winner-reveal-only verify phase, full verification math, EVERY cheat class (bad salt, illegal layout, moved ship, lied answer → flip; both cheat → draw), geometry binding (a battleship-serialized reveal never verifies), duplicate/reordered signal convergence via `applySignal`
- [ ] T003 [P] RED: author the failing duty suite in `src/games/duty.test.ts` — owed answer for a pending enemy shot; owed FINAL answer carries the reveal; owed winner reveal; null when no secret (second device), when nothing pending, and when the answer is already in the log (idempotent re-emit — the user-reported stall regression test per FR-009/SC-003)
- [ ] T004 GREEN: implement `src/games/armada/logic.ts` — fork of `src/games/battleship/logic.ts` per contract: `SIZE=10`, `FLEET=[5,4,3,3,2]`, `SHIP_CLASSES`, canonical serialization `10x10|5,4,3,3,2|…|salt`, `commitment` (existing sha256), `randomSalt`, `layoutLegal`, `randomLayout(rng)`, `judgeShot`, `turn`/`mayMove` (parallel placement, strict alternation), `applyMove`, `answersHonest`, `status` incl. cheat flip, `fleetView()` UI recs — T002 passes
- [ ] T005 GREEN: implement pure `owedMove()` in `src/games/duty.ts` (no Vue, no idb) — T003 passes
- [ ] T006 [P] Create namespaced `src/games/fleet-secret.ts` (`getFleetSecret/setFleetSecret/clearFleetSecret` with a `ns` param, `@/db/idb` direct, keys `${ns}.secret.${commitment}`) + unit test `src/games/fleet-secret.test.ts` (roundtrip, namespace isolation from `battleship.secret.*`); leave `src/games/battleship/secret.ts` byte-untouched
- [ ] T007 Create `src/games/armada/index.ts` (GameModule: id `'armada'` FROZEN, displayName, icon, one `classic` theme, `presentation:'fullscreen'`, `mayMove`, `moveCue` mapping shot/answer results to existing `bs-*` cues) and register: +1 line in `src/games/registry.ts`, +1 line in `src/games/boards.ts` pointing at the (US1) `ArmadaBoard.vue` — create the SFC as a compiling grid-only skeleton so typecheck passes
- [ ] T008 Add `ongoingOverlayGames()` to `src/db/queries.ts` (chat `kind==='game'` messages ∪ wall `Post.game` posts via `wallGameSession`; filter `presentation==='fullscreen'` + derived `ongoing` + local seat; return `{ref, awaitingMe, lastActivityAt}` per data-model.md) + RED-first unit test `src/db/queries.games.test.ts` covering chat/wall union, spectator exclusion, awaitingMe truth table
- [ ] T009 [P] Add `useOngoingGames()` composable in `src/composables/useOngoingGames.ts` (`useLiveQuery` over `['messages','posts','postEngagement']` → `ongoingOverlayGames()`)

**Checkpoint**: `npx vitest run src/games src/db/queries.games.test.ts` green;
`npm run build` green; no UI yet

---

## Phase 3: User Story 1 — A fullscreen naval duel in a 1:1 chat (P1) 🎯 MVP core

**Goal**: picker → challenge card → fullscreen deploy/battle/medal, honest by
verification, stall-proof by duty officer

**Independent test**: two dev accounts play a complete duel picker→medal on a
phone viewport; kill the defender's app between shot and answer, reopen
without entering the chat — the answer still goes out (quickstart.md checks)

- [ ] T010 [US1] RED: author `e2e/games-armada.spec.ts` (failing) — start armada in a 1:1, both cards render (no inline board), open overlay, deploy both sides, exchange fire to a win, medal shows on both, reveal verifies (SC-001); include the duty re-emit scenario: defender's page closed at shot time, reopened on the chats tab → answer arrives (SC-003)
- [ ] T011 [P] [US1] Implement `src/games/armada/ShipSvg.vue` — parametric top-down silhouettes for the 5 classes + wreck variants + insignia badge (port `shipTopSVG` from `design/Armada.dc.html`; `preserveAspectRatio:none`, rotates for vertical)
- [ ] T012 [P] [US1] Implement `src/games/armada/MedalSvg.vue` — gold win / iron loss medal with ribbon, star, shine sweep (port `medalSVG`)
- [ ] T013 [US1] Implement `ArmadaBoard.vue` deployment face in `src/games/armada/ArmadaBoard.vue` — 10×10 labeled grid (handoff cell-size clamp, two-column ≥760px container), tap-to-place in fixed class order, drag with 6px threshold (pointer events, `touch-action:none`), tap-to-rotate with inward nudge, green/red placement preview, Auto-deploy / Clear / Engage controls, fleet roster with Ready/Placing/Standby chips; Engage → `setFleetSecret('armada', …)` then emit `{t:'commit'}`
- [ ] T014 [US1] Implement `ArmadaBoard.vue` battle face — ENEMY WATERS + YOUR FLEET boards, radar layer (dim on your turn / bright on enemy's), aim reticle, tap-to-fire gated on `canMove`, miss splash / hit explosion→flame / sunk wreck markers, per-ship rosters (Active/hit-count/Sunk), battle log (last 6), status line always naming who owes what (FR-009 visibility); your-turn `bs-sonar` ping (battleship precedent, FR-013); sunk smoke strictly time-boxed ~6.5s ≤3 puffs then unmounted (`smoking` map + timers, SC-006); NO auto-answer logic in the board
- [ ] T015 [US1] Implement `ArmadaBoard.vue` result face — dimmed backdrop card with eyebrow/medal/VICTORY–DEFEAT/rank/citation/stats row (shots, accuracy, sunk, survivors), New battle / Review board / Leave buttons, `resultDismissed` + View-result reopen; terminal → `clearFleetSecret`
- [ ] T016 [US1] Implement `src/composables/useGameOverlay.ts` — module-scoped `{active, open}`, `openGame()/minimize()/close()`, `document.documentElement.requestFullscreen().catch(()=>{})` + guarded exit, `fullscreenchange` observer (never closes overlay), pushed history entry + Ionic back-button priority handler → minimize
- [ ] T017 [US1] Implement `src/components/GameOverlay.vue` mounted in `src/App.vue` — fixed inset-0 host at z 16000 (above MinimizedCall 15000, below banners 19000), header per handoff (exit chevron / ARMADA + context subtitle / context pill), live session via `useLiveQuery` on the message row, board from `GAME_BOARDS`, move emit → `playGameMove`
- [ ] T018 [US1] Implement `src/components/GameChallengeCard.vue` — handoff card (≤320px, navy gradient, glyph, context subtitle, one full-width button) with states challenged / awaiting-fleet / your-move / their-turn / finished (mini medal + View result) / out-of-sync / cancelled, copy always naming who's owed (data-model.md CardState; UI copy voice: warm, plain, "you", no em-dashes/semicolons)
- [ ] T019 [US1] Wire the chat surface: `src/components/GameBubble.vue` renders `GameChallengeCard` instead of the board when `GAMES[gameType]?.presentation === 'fullscreen'`; card tap → `openGame({surface:'chat',…})`; `src/views/detail/ChatDetailPage.vue` opens the overlay for the sender right after `sendGame('armada')`; confirm `hasOngoingGame` gate covers armada (it's a known type — assert in the T008 test if not)
- [ ] T020 [US1] Implement `src/composables/useGameDuty.ts` started from `src/App.vue` — for each `useOngoingGames()` entry where a fleet secret exists, compute `owedMove()` and emit via `playGameMove`/`playWallGameMove` with an in-flight guard; runs on app start, live-query change, and overlay open (FR-009)
- [ ] T021 [US1] GREEN: make `e2e/games-armada.spec.ts` (T010) pass end-to-end against the dev stack

**Checkpoint**: US1 fully playable; SC-001/002/003/006 verifiable

---

## Phase 4: User Story 2 — Leave the game and come back to it (P1) 🎯 MVP completion

**Goal**: banners over the game (others' shown, own suppressed), minimize on
back/banner-tap, floating derived pill with awaiting-me badge

**Independent test**: with an ongoing game, message the player from a third
account → banner over the game → tap → lands in that chat, pill visible with
badge; reload the app → pill still there; finish the game → pill gone

- [ ] T022 [US2] RED: unit tests for suppression in `src/services/notify.games.test.ts` (or extend the existing notify tests) — `setActiveGame/isGameActive` semantics; wall classifier (`notifyWallGameActivity`) and the chat game-move note path stay silent for the ACTIVE game, still fire for another game, and always fire when no overlay is open
- [ ] T023 [US2] Implement `setActiveGame(key|null)` / `isGameActive(key)` in `src/services/notify.ts` (mirror of `setActiveChat`); `useGameOverlay` sets/clears on open/minimize/close; add the suppression checks in `src/db/queries.ts` (`notifyWallGameActivity` + the chat gamemove notification path) — T022 green; sound cues unaffected
- [ ] T024 [US2] Overlay self-minimizes on route change in `src/composables/useGameOverlay.ts` (watch `router.currentRoute`; banner taps already `router.push` in `src/components/NotificationBanners.vue`) — banners render above the overlay by existing z-order, verify no CSS/stacking regression with the overlay open
- [ ] T025 [US2] Implement `src/components/FloatingGameButton.vue` mounted in `src/App.vue` — visible when `useOngoingGames()` non-empty AND overlay closed; drag/clamp per `src/components/MinimizedCall.vue` with a different default dock so they never collide; `ion-badge` = count of `awaitingMe`; ×N hint when >1 ongoing; tap → most urgent (awaiting-me first, then newest activity) → `openGame`
- [ ] T026 [US2] RED→GREEN: extend `e2e/games-armada.spec.ts` — banner-over-game tap lands in the other chat with the game minimized (SC-004); pill appears ≤1s after minimize, badge correct across a reload, gone ≤1s after the game ends (SC-005); own-game move while overlay open shows NO banner

**Checkpoint**: MVP complete — fullscreen play is safe to ship

---

## Phase 5: User Story 3 — An open challenge on the Wall (P2)

**Goal**: wall posts carry the armada challenge card; accept → fullscreen
deployment; seat-race loser handled in-overlay; spectators stay on the card

- [ ] T027 [US3] RED: extend `e2e/games-armada.spec.ts` (or `e2e/games.spec.ts` wall section) — wall challenge: post from A, near-simultaneous accepts from B+C, exactly one seat, loser sees seat-taken, spectator sees card-only with status (SC-007 wall leg)
- [ ] T028 [US3] Wire the wall surface: `src/components/WallGameCard.vue` renders `GameChallengeCard` for `presentation:'fullscreen'` modules (open/accepted/finished states incl. player names/avatars); Accept → `acceptWallChallenge` then `openGame({surface:'wall',…})` immediately; overlay session via the wall live query; moves via `playWallGameMove`; ensure the wall compose game option offers armada
- [ ] T029 [US3] Seat-race loss handling in `src/components/GameOverlay.vue` + `useGameOverlay.ts` — when the derived session locks seats to someone else mid-deployment: show the seat-taken notice, discard the uncommitted preview fleet, close; also handle carrying post/message deleted mid-game (overlay closes with notice, `clearFleetSecret`) — T027 green

**Checkpoint**: both surfaces live; spectators card-only (existing Follow
alerts untouched)

---

## Phase 6: User Story 4 — Battleship retires gracefully (P3)

**Goal**: picker offers armada not battleship; legacy sessions play out
inline; rematch maps forward

- [ ] T030 [US4] RED: extend `e2e/games.spec.ts` — picker lists armada and NOT battleship; a pre-seeded battleship session still renders its inline board and accepts a move; rematch from a finished battleship produces an armada card (SC-007)
- [ ] T031 [US4] Mark `src/games/battleship/index.ts` with `retired: true, successor: 'armada'` (ONLY these fields — logic/board/secret stay byte-identical); filter retired modules in `src/components/GamePicker.vue`
- [ ] T032 [US4] Rematch successor mapping: `onGameRematch` in `src/views/detail/ChatDetailPage.vue` resolves `GAMES[gt]?.successor ?? gt`; same resolution in the wall rematch path in `src/components/WallGameCard.vue` — T030 green

**Checkpoint**: migration complete, no stranded games

---

## Phase 7: Polish & Cross-Cutting

- [ ] T033 [P] Author `drive/scenarios/armada.mjs` and capture deploy / battle / medal / card / pill screenshots to `.tmp/drive/` for the design-fidelity review against `design/README.md` tokens
- [ ] T034 [P] A11y pass per constitution X/XI: labels + focus states on exit/fire/rotate/pill controls, board colors via `--ring-*`/`--ion-color-*` tokens, overlay chrome is stock Ionic (`ion-button`/`ion-icon`/`ion-badge`)
- [ ] T035 Re-validate `specs/1038-armada-fullscreen-naval/checklists/zero-knowledge.md` CHK017 (tests-first mapping now real) and tick it; confirm server diff is EMPTY (`git diff develop -- server/` shows nothing)
- [ ] T036 Full gates: `npm run test:unit` (coverage floors), `npm run build`, `cd server && go build ./... && go vet ./... && go test ./...`, `npm run test:e2e` — all green; flip spec `Status` to in-progress→in-review as the work moves and run `make roadmap`

---

## Dependencies & Execution Order

- **Phase 1 → 2**: T001 unblocks T007 (module fields) — everything else in
  Phase 2 only needs the repo as-is
- **Phase 2 → all stories**: T004/T005 (protocol+duty) block T010+; T007
  (registration) blocks T013+; T008/T009 block T020 (duty wiring) and T025
  (pill)
- **US1 → US2**: T016/T017 (overlay) block T023/T024/T025 semantics; suppression
  (T023) needs the overlay's active-key
- **US1 → US3**: overlay + card are reused; only wall wiring is new
- **US4** depends only on Phase 2 (registration) — can run parallel with US2/US3
- **RED before GREEN** within every phase: T002/T003 before T004/T005; T010
  before T011–T021; T022 before T023; T027 before T028/T029; T030 before
  T031/T032

### Parallel opportunities

- T002 ∥ T003 (different test files); then T004 ∥ T005 ∥ T006
- T011 ∥ T012 (SVG components) while T013–T015 proceed sequentially in the board
- T025 (pill) ∥ T022–T024 (suppression) — different files
- US4 (T030–T032) ∥ US3 (T027–T029)
- T033 ∥ T034 in polish

## Implementation Strategy

MVP = Phases 1–4 (US1+US2): the game is not shippable fullscreen without the
return/notification story, so treat them as one increment. US3 (wall) and US4
(retirement) are independent follow-on increments; US4 is safe to land any
time after Phase 2. Suggested commit cadence: one commit per checkpoint,
red-test commits explicitly labeled `test(games): …` before their green
counterparts.
