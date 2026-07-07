# Data Model: Armada — Fullscreen Naval Duel (spec 1038)

Phase 1 output. Everything below is client-side; nothing here crosses the wire
except inside the existing sealed game payloads (see
[contracts/armada-protocol.md](contracts/armada-protocol.md)).

## Game rules state (pure, replayed — `src/games/armada/logic.ts`)

Derived by replaying the validated move log; never stored, never transmitted.

```ts
SIZE = 10                        // 10×10 board, cell index = r*10 + c (0–99)
FLEET = [5, 4, 3, 3, 2]          // cells per class, fixed order
FLEET_CELLS = 17
SHIP_CLASSES = [                 // index-aligned with FLEET
  { key: 'carrier',    name: 'Carrier',    size: 5 },
  { key: 'battleship', name: 'Battleship', size: 4 },
  { key: 'cruiser',    name: 'Cruiser',    size: 3 },
  { key: 'submarine',  name: 'Submarine',  size: 3 },
  { key: 'destroyer',  name: 'Destroyer',  size: 2 },
]

Ship    = { r: number, c: number, len: number, dir: 'h' | 'v' }
Layout  = Ship[5]                // canonical class order (index i has len FLEET[i])
Reveal  = { layout: Layout, salt: string }

ShotRec = { cell: number, r: 'miss' | 'hit' | 'sunk' }

ArmadaState = {
  commits:  [string | null, string | null]   // commitment hashes, per seat
  shots:    [ShotRec[], ShotRec[]]           // answered shots BY each attacker
  pending:  { by: 0 | 1, cell: number } | null  // shot awaiting the defender's answer
  reveals:  [Reveal | null, Reveal | null]
  finalBy:  0 | 1 | null                     // attacker of the 17th declared hit
}
```

**Validation rules** (inside `applyMove`, returns `null` for illegal):
`layoutLegal` = exactly the five classes in canonical order, in bounds, no
overlap (touching allowed). A shot must be on an un-shot cell by that
attacker, only on their turn. An answer must come from the defender of the
pending shot. The 17th declared hit's answer MUST carry the loser's reveal;
the winner's reveal is the only legal move afterwards.

**State transitions** (same phase machine as battleship):
`placing` (either side may commit, once each — parallel) → `battle`
(strict alternation: shot → answer → other side) → `verify` (winner owes the
reveal) → terminal. Terminals from `status()`: `won` (honest), flipped `won`
(winner cheated, loser honest), `draw` (both cheated), plus the session-level
`resigned` and `out-of-sync` (engine-level, unchanged).

**UI derivation helpers** (pure): `fleetView(layout)` expands a `Layout` into
the handoff's ship recs `{ key, name, size, orient, cells[] }`;
`enemyWrecks(shots)` derives sunk-run rendering pre-reveal; both feed
`ArmadaBoard.vue`/`ShipSvg.vue` and are never serialized.

## Device-local secret (`src/games/fleet-secret.ts`)

```ts
FleetSecret = { layout: Layout, salt: string }   // salt: 32 bytes, b64url
// settings store, key `${ns}.secret.${commitment}`, ns = 'armada'
```

Lifecycle: created at Deploy (commit emit), read by the duty officer and the
board, cleared when the session reaches any terminal, when the carrying
message/post is deleted, and by the full local wipe (logout/app-lock). Never
in `SYNCED_PREF_KEYS`; battleship's existing `battleship.secret.*` namespace
is untouched and coexists.

## Module contract additions (`src/games/types.ts`, additive)

```ts
GameModule {
  …existing…
  presentation?: 'fullscreen'   // card + overlay instead of inline board
  retired?: true                // hidden from the picker; sessions still render
  successor?: string            // rematch on a finished game starts this id
}
// armada:     { id: 'armada', presentation: 'fullscreen', … }
// battleship: { …existing…, retired: true, successor: 'armada' }
```

## Overlay state (`src/composables/useGameOverlay.ts`, memory-only)

```ts
ActiveGame =
  | { surface: 'chat', chatId: string, messageId: string, gameType: string }
  | { surface: 'wall', postId: string, gameType: string }

overlay = { active: Ref<ActiveGame | null>, open: Ref<boolean> }
// open=false with active set == minimized; reload resets both (pill re-enters)
```

Invariants: `open === true` ⇒ `notify.setActiveGame(sessionKey)` is set;
close/minimize clears it. Session key = messageId (chat) / postId (wall) —
the same ids the notification classifiers already carry.

## Ongoing-game set (`ongoingOverlayGames()` in `src/db/queries.ts`, derived)

```ts
OngoingOverlayGame = {
  ref: ActiveGame            // where to open
  awaitingMe: boolean        // engine localMoveAllowed(me)
  lastActivityAt: number     // last move/accept timestamp
}
```

Source: chat `messages` rows with `kind === 'game'` + wall posts with
`Post.game` (session via `buildWallSession`), filtered to
`presentation === 'fullscreen'` modules, derived status `ongoing`, and a seat
held by the local user. Powers `useOngoingGames` (live query over
`['messages','posts','postEngagement']`) → `FloatingGameButton` visibility,
badge (count of `awaitingMe`), and tap target ordering (awaiting-me first,
then newest `lastActivityAt`).

## Duty resolution (`src/games/duty.ts`, pure)

```ts
owedMove(state: ArmadaState, me: 0|1, secret: FleetSecret | null)
  → { t: 'answer', r, reveal? } | { t: 'reveal', layout, salt } | null
```

Returns the answer for a pending enemy shot (with the reveal attached on the
17th declared hit), or the winner's owed reveal, or null. Consumed by
`useGameDuty` (app-level watcher) and nothing else; emission goes through the
existing `playGameMove`/`playWallGameMove`, whose seq/dedup validation makes
re-emission idempotent.

## Challenge card model (`GameChallengeCard.vue`, derived per render)

```ts
CardState = 'challenged' | 'awaiting-fleet' | 'your-move' | 'their-turn'
          | 'finished' | 'out-of-sync' | 'cancelled'
```

Computed from `deriveStatus` + commits + seat naming (existing
direction-derived seats in 1:1, `players` on wall sessions). Card copy
follows the handoff (context subtitle names the opponent / who's owed);
button label per state (`Play in fullscreen ▸`, `Review fleet ▸`,
`View result ▸`). No persistence.
