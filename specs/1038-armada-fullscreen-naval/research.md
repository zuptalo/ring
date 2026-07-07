# Research: Armada — Fullscreen Naval Duel (spec 1038)

Phase 0 output. Each decision below was resolved against the codebase (file
references verified 2026-07-07 on develop @ `7046f1c`) and, where product-
level, confirmed with the user (spec §Decisions). No NEEDS CLARIFICATION
remain.

## D1 — Fork battleship's logic; do not extract a shared naval core

**Decision**: `src/games/armada/logic.ts` is a self-contained fork of
`src/games/battleship/logic.ts` with the new geometry; battleship's files stay
byte-untouched (except `index.ts` gaining `retired`/`successor`).

**Rationale**: battleship's behavior is frozen by the id contract
(`src/games/types.ts:17-21`) and the module is retiring. Extracting a shared
core would couple a dead module to a live one, force re-review of shipped
crypto logic, and buy ~250 lines of deduplication in pure, heavily-tested
code. The 0011 protocol suite pattern transfers verbatim, so the fork's test
cost is near zero.

**Alternatives considered**: parameterized `naval-core.ts` consumed by both
(rejected: touches frozen code paths for no user value); armada as a
battleship "theme" (rejected outright: geometry change = rules change = new id
per the frozen-id contract).

## D2 — Geometry, serialization, and commitment binding

**Decision**: `SIZE = 10`, `FLEET = [5,4,3,3,2]` (`FLEET_CELLS = 17`) in fixed
class order Carrier → Battleship → Cruiser → Submarine → Destroyer. Canonical
serialization `10x10|5,4,3,3,2|r.c.len.dir;…|salt`; commitment = SHA-256
(b64url) of the UTF-8 bytes via `src/services/crypto/primitives.ts` exports;
salt = 32 random bytes (b64url) via existing `randomBytes`. Cells are
`0–99` (`index = r*10 + c`).

**Rationale**: identical scheme to battleship's proven one
(`battleship/logic.ts:129-149`), with the geometry header making an armada
commitment structurally incapable of validating under battleship's
`8x8|4,3,3,2|` header (checklist CHK005). The 10×10 five-ship layout space is
vastly larger than 8×8's, so the 32-byte salt's hiding margin only improves.
Sunk detection stays per-ship via hit-cell coverage; the final (17th declared
hit) answer must carry the loser's reveal, exactly as 0011's 12th.

**Alternatives considered**: embedding ship names in the serialization
(rejected: index in the fixed class order already names the class; shorter
canonical form, nothing user-identifying in the hash preimage).

## D3 — Strict alternation + the parallel-placement gate carry over

**Decision**: port `turn()`/`mayMove()` semantics unchanged: commits are
parallel (each side owes exactly its own commit, any order), battle is strict
alternation with the defender's answer interleaved (`pending`), verify phase
waits on the winner's reveal.

**Rationale**: verified in `battleship/logic.ts:171-200`; matches the
handoff's deliberate no-bonus-shot rule and the user's confirmation. Zero new
turn logic = zero new divergence surface.

## D4 — The stall fix: a mount-independent duty officer (FR-009)

**Decision**: the defender's automatic answers and the winner's automatic
reveal move OUT of the board component into two pieces: a pure resolver
`src/games/duty.ts` (`owedMove(state, myPlayer, secret) → move | null`) and an
app-level watcher `src/composables/useGameDuty.ts` started from `App.vue`,
which walks ongoing armada sessions (chat + wall), loads the device-local
secret, and emits any owed move through the existing `playGameMove` /
`playWallGameMove` paths (which already dedupe/validate via `applySignal`).
It runs on app start, on live-query change for the involved stores, and on
overlay open. `ArmadaBoard.vue` contains NO auto-send logic.

**Rationale**: root cause verified — 0011's `autoActions` lives in
`BattleshipBoard.vue:398-445` and only runs while the bubble is mounted; a
defender who never opens that chat never answers, which is precisely the
user-reported both-players-waiting stall. A fullscreen-presentation game has
no inline board at all, so board-mounted auto-answer is not merely fragile
here, it is impossible. The engine's existing seq/dedup rules make re-emission
idempotent (a duplicate answer is dropped as `dup`, never `outOfSync`), so
"re-emit on open if unsent" is safe by construction. The 0011 plan rejected a
platform-level hook to keep that spec's zero-platform-change promise; 1038
explicitly changes the platform, so the objection no longer applies.

**Alternatives considered**: keep board-local autoActions and also mount a
hidden board (rejected: a rendering component as a protocol actor is the bug
we're fixing); answer from the service worker on push (rejected: the fleet
secret must not be readable by push-time code paths and the SW must stay out
of game protocol); a server nudge (rejected: server stays blind and
stateless). Battleship's own board-local autoActions are left as-is —
retiring, frozen, and out of scope.

## D5 — Overlay architecture: global component + root-element fullscreen

**Decision**: `GameOverlay.vue` is mounted once in `App.vue` (alongside
`MinimizedCall`, `NotificationBanners`), `position: fixed; inset: 0`,
`z-index` between the minimized-call widget (15000, `MinimizedCall.vue:134`)
and the banner stack (19000, `NotificationBanners.vue:312`) — banners render
above the game with zero teleporting. True fullscreen is requested as
`document.documentElement.requestFullscreen().catch(() => {})` (the APP ROOT,
so everything inside the DOM — including banners — stays in the fullscreen
top layer) and exited with the same promise guard; `fullscreenchange` is
observed but never closes the overlay. Back handling: a pushed history entry +
Ionic back-button priority handler → minimize. State lives in
`useGameOverlay.ts` as module-scoped refs `{ active, open }` where `active`
identifies the session (`{surface:'chat'|'wall', chatId?/postId?, messageId?,
gameType}`); minimized = `active && !open`. Memory-only by design — after a
reload the pill (D7) is the re-entry point.

**Rationale**: the launch surface staying mounted makes exit trivially correct
(remove overlay, no navigation restore); a route would unmount the chat/wall
page and fight the back stack; `ion-modal` puts itself above other overlays
and its dismiss lifecycle conflicts with minimize-vs-close. The z-order fact
was verified in code (15000 / 19000). The `.catch` requirement comes from the
handoff (promise rejection under permissions policy is not catchable
synchronously) and matches how iPhone Safari (no element fullscreen for
non-video) degrades: the fixed overlay simply IS the experience.

**Alternatives considered**: route `/game/:id` (rejected above);
`ion-modal` fullscreen (rejected above); requesting fullscreen on the overlay
element itself (rejected: would lift the overlay into the top layer ABOVE the
banner stack, hiding notifications — the exact opposite of FR-007).

## D6 — Fleet-secret storage: generalized namespaced helper

**Decision**: new `src/games/fleet-secret.ts` exposing
`getFleetSecret(ns, commitment)` / `setFleetSecret` / `clearFleetSecret`,
storing at `` `${ns}.secret.${commitment}` `` in the `settings` store via
`@/db/idb` directly (no queries import — 0011's no-cycle rule). Armada uses
`ns = 'armada'`. `src/games/battleship/secret.ts` remains byte-identical
(its keys and behavior are shipped); armada simply does not import it.

**Rationale**: two live namespaces must not collide while legacy battleship
games finish; keeping battleship's file untouched honors "retire without
touching frozen code". Keys stay out of `SYNCED_PREF_KEYS` (never synced), and
the PIN-wipe path clears the whole settings store, covering logout/app-lock
(spec §Edge Cases).

**Alternatives considered**: rewriting battleship's helper to delegate to the
new one (rejected: churn in frozen code for zero behavior change); a new idb
object store (rejected: needless `DB_VERSION` bump — Principle V — for data
the settings store already models).

## D7 — Floating pill: fully derived from a new query

**Decision**: `ongoingOverlayGames()` in `src/db/queries.ts` scans chat
messages with `kind === 'game'` and wall posts with `Post.game` (session via
the existing `wallGameSession`/`buildWallSession`), filters to
`GAMES[gameType]?.presentation === 'fullscreen'` AND derived status `ongoing`
AND the local user holding a seat, and returns
`{ ref, awaitingMe, lastActivityAt }[]` (`awaitingMe` via the engine's
`localMoveAllowed`). `useOngoingGames.ts` wraps it in `useLiveQuery` over
`['messages','posts','postEngagement']`. `FloatingGameButton.vue` shows when
the list is non-empty and the overlay is not open; badge = count of
`awaitingMe`; tap opens the most urgent (awaiting-me first, then newest
`lastActivityAt`); drag/clamp code follows `MinimizedCall.vue`, docked at a
different default corner so the two widgets never overlap.

**Rationale**: deriving instead of tracking "minimized" makes the pill correct
across reloads, self-clearing at game end, and immune to missed events —
the same reactive pattern as `useBadges`/`wallUnreadCount`. Verified
precedent: `MinimizedCall.vue` is shown by state + route condition and
re-expands on tap via a composable call.

**Alternatives considered**: an explicit minimized-sessions list in memory or
settings (rejected: a second source of truth that can go stale); counting
"interactions" into the badge (rejected: challenge-accepted/finished stay with
the existing notification classifiers — one unread ledger, spec FR-008).

## D8 — Suppression: `setActiveGame` mirroring `setActiveChat`

**Decision**: `notify.ts` gains `setActiveGame(key | null)` /
`isGameActive(key)` where key identifies the session (message id or post id).
`useGameOverlay` sets it on open/minimize/close. The two game-note producers
check it: the chat game-move note path and `notifyWallGameActivity`
(`queries.ts:3245`, which already implements the analogous wall "watching"
suppression). Banner taps for OTHER surfaces need no new code — the overlay
watches `route` and minimizes itself on any navigation, which covers
banner-tap navigation (`NotificationBanners.vue` `open()` does
`router.push`).

**Rationale**: exact mirror of the shipped active-chat rule
(`notify.ts:276,337`) — same semantics, same place, easy parity with the SW
classifier if ever needed (the SW never fires for a visible client per spec
1034, so no SW change is required). Sound cues intentionally keep playing
(`moveCue` path is independent of banner suppression).

**Alternatives considered**: suppressing by route (rejected: the overlay is
not a route); marking the whole app "in game" and muting all banners
(rejected: FR-007's entire point is that other chats' banners DO show).

## D9 — Presentation switch + retirement mechanics

**Decision**: three additive optional `GameModule` fields —
`presentation?: 'fullscreen'`, `retired?: true`, `successor?: string`.
`GameBubble.vue` and `WallGameCard.vue` branch on `presentation` to render the
generic `GameChallengeCard.vue` (handoff card design; state text from
`deriveStatus` + seat naming) instead of the board; the board component from
`GAME_BOARDS` renders only inside `GameOverlay`. `GamePicker.vue` filters
`retired` (verified: it lists `Object.values(GAMES)`, `GamePicker.vue:60`).
Rematch: `ChatDetailPage.onGameRematch(gt)` resolves
`GAMES[gt]?.successor ?? gt` before starting (rematch emit carries the
gameType — `GameBubble.vue:69,78,120`); the wall rematch path composes a new
post the same way.

**Rationale**: presentation is a rendering concern, so it belongs on the
module (the registry is already the single source the picker, bubble, and
engine consult); retirement via a flag keeps battleship rendering/replaying
legacy sessions with zero behavior change behind its frozen id (FR-010/011).

**Alternatives considered**: a separate "fullscreen games" registry
(rejected: second registry to drift); deleting battleship from the registry
(rejected: existing sessions would hit the unknown-type fallback and become
unplayable — exactly what FR-010 forbids).

## D10 — Board fidelity, effects budget, and foley

**Decision**: `ArmadaBoard.vue` recreates the handoff faithfully with Ring
idioms: CSS-grid cells sized by the handoff's clamp formula, two-column at
≥760 px container width; `ShipSvg.vue` ports the parametric `shipTopSVG`
(afloat + wrecked palettes, insignia badge); radar sweep behind enemy cells
(dim on your turn, bright on theirs); reticle/splash/impact/flame/ember
animations per the handoff table; smoke strictly time-boxed (~6.5 s, ≤3
puffs, unmounted after — enforced by a timer that clears a `smoking` map, as
the prototype does). Result modal = `MedalSvg.vue` + stats + rank strings from
the handoff. Foley reuses the existing cues (`bs-fire`/`bs-splash`/`bs-hit`/
`bs-sunk`/`bs-sonar` in `src/services/game-sounds.ts:16`) via armada's
`moveCue`; cue names are device-local, not wire, so reuse is free.

**Rationale**: the handoff is hifi ("colors, typography, spacing, animations,
and interactions are final"); the smoke time-box is its explicit perf
requirement (SC-006). The existing foley was purpose-built naval FX
(`sound.ts:359-395`) — new audio is out of scope per spec §Assumptions.

**Alternatives considered**: porting the prototype's `createElement` rendering
(rejected by the handoff itself); new armada-specific cues (rejected: scope,
and the existing set already covers fire/splash/hit/sunk/turn-ping).

## D11 — Testing strategy (maps to SC-001…008)

**Decision**:
- **Unit (red first)**: `armada/logic.test.ts` mirrors battleship's suite
  plus: geometry-binding (battleship-shaped reveal never verifies), full
  17-hit game, every cheat class → flip/draw, reorder/duplicate convergence
  (SC-003a); `duty.test.ts` — owed-move resolution incl. the
  judged-but-unsent re-emit case (simulate: state has pending shot, secret
  present, no answer in log → duty emits; answer already in log → duty
  silent) (SC-003b); `ongoingOverlayGames` fixtures (chat + wall, seat vs
  spectator, awaitingMe) (SC-005); suppression unit for `isGameActive`
  branches.
- **e2e** (`games-armada.spec.ts`): full 1:1 duel to medal on phone viewport
  (SC-001); toast-over-game → tap → lands in other chat, pill visible with
  badge → tap → back in game (SC-004/005); wall challenge accept race
  (SC-007 wall leg). Retirement assertions ride the existing games e2e
  (picker contents + legacy battleship fixture) (SC-007).
- **drive** (`armada.mjs`): screenshots of deploy/battle/medal/card/pill for
  the design review.

**Rationale**: same split that carried 0008–0011; the duty-officer unit test
is the regression test for the user-reported stall (Principle III's
failing-test-first for bug classes).

## D12 — What explicitly does NOT change

Server (zero diff), wire kinds/payloads (`crypto/message.ts` untouched),
`session.ts`/`challenge.ts` engine, battleship's logic/board/secret files,
settings schema (no new toggles — FR-013), SW classifiers (visible-client
wakes never notify per 1034; wall parity classifier already handles game
kinds), notification fan-out policy (1035/1036).
