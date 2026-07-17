# Data Model: In-Chat Turn-Based Games

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-07-05

All types are client-side TypeScript. Nothing here exists server-side (Principle I).

## Entities

### GameModule (static catalog entry — `src/games/types.ts`)

The internal plugin interface every bundled game implements. Registered in
`src/games/registry.ts`; board component registered separately in `src/games/boards.ts`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Wire identifier (`'tictactoe'`). Immutable once shipped — it is serialized into sealed payloads. |
| `displayName` | `string` | Picker + bubble title ("Tic-tac-toe"). |
| `icon` | `string` | Ionicon name for picker/preview. |
| `players` | `2` | v1 is strictly two-player; the literal type documents that. |
| `createInitialState()` | `() => S` | Pure. |
| `applyMove(state, move, player)` | `(S, M, 0\|1) => S \| null` | Pure; `null` = illegal (occupied cell, out of turn handled by session engine, malformed move). Never throws. |
| `turn(state)` | `(S) => 0 \| 1` | Whose move it is. |
| `status(state)` | `(S) => GameStatusResult` | `{ state: 'ongoing' \| 'won' \| 'draw', winner?: 0 \| 1 }`. Resignation is session-level, not game-level. |

Tic-tac-toe concretely: `S = { cells: (0 | 1 | null)[9] }`, `M = { cell: 0–8 }`.

### GameSession (persisted — `Message.game`, `src/db/types.ts`)

Lives on the game-start bubble's `Message` row, like `poll`. Never a separate store.

| Field | Type | Notes |
|-------|------|-------|
| `gameType` | `string` | `GameModule.id`. Unknown id (future game, old app) → bubble renders an "update to play" fallback. |
| `theme` | `string` (optional) | Visual theme id from the module's bundled list (FR-022); unknown/absent → classic. |
| `startedAt` | `number` (optional) | The bubble's original compose time, kept here because FR-021 re-purposes `Message.timestamp` as last-activity time. Drives the stats' "started" and first reply time. |
| `moves` | `GameMoveRec[]` | Accepted moves only, ascending `seq`, contiguous from 1. Board/turn/outcome are always **derived** by replay — never stored. |
| `resignedBy` | `0 \| 1` (optional) | Set when a resign was accepted; terminal. |
| `resignedAt` | `number` (optional) | The resign signal's `at` — the game's end time for stats (FR-024). |
| `outOfSync` | `true` (optional) | Set on invalid/conflicting inbound; terminal (D9). |

**GameMoveRec**: `{ seq: number, player: 0 | 1, move: M, at: number }`.

Derived status (computed, in priority order): `outOfSync` → out of sync; `resignedBy` →
resigned; else `module.status(replay(moves))`. "Ongoing" is what the one-game-per-chat
gate (FR-001a) scans for.

### Wire signals (inside the sealed `MessagePayload` — `src/services/crypto/message.ts`)

**GameStart** — new message kind `'game'`, field `game?: GameStart`:

| Field | Type | Notes |
|-------|------|-------|
| `gameType` | `string` | Registry id. |

That is the whole start — initial state is derived on both ends from
`createInitialState()`; sender = player 0 (D5).

**GameMoveSignal** — side-effect field `gameMove?: GameMoveSignal` (mirrors
`PollVoteSignal`):

| Field | Type | Notes |
|-------|------|-------|
| `messageId` | `string` | The game bubble's id (sender-side id; receiver resolves via `remoteId`, D4). |
| `seq` | `number` | 1-based, strictly increasing per session. |
| `action` | `'move' \| 'resign'` | |
| `move` | `M` (optional) | Present iff `action === 'move'`. |
| `at` | `number` | Sender's ms timestamp (display only; never used for ordering). |

`lastKind`/preview additions: `'game'` (new bubble → "🎮 Tic-tac-toe"; move → "Your move").

## Validation rules (session engine — `src/games/session.ts`, pure)

Applied to every inbound `gameMove`, in order:

1. **Target exists** and `Message.game` present, else drop (bubble may have expired
   under TTL — accepted, FR-015).
2. **Terminal check**: session already won/draw/resigned/out-of-sync → drop (late move
   after resign is not a conflict; the game was over).
3. **Duplicate**: `seq <= moves.length` and identical `(player, move)` at that seq →
   drop silently (FR-006).
4. **Conflict**: `seq <= moves.length` but different content → `outOfSync` (FR-007).
5. **Gap**: `seq > moves.length + 1` → `outOfSync` (contiguity broken; the relay is FIFO
   per sender, so a gap means tampering or loss, not reordering).
6. **Turn**: signal sender must equal `module.turn(replayedState)` → else `outOfSync`.
7. **Legality**: `applyMove(...) === null` → `outOfSync`; otherwise append and persist.

Local sends run rules 2, 6, 7 *before* sending (FR-003) — an honest device never emits an
invalid move; the UI simply doesn't allow it.

Resign: valid from either player while ongoing; sets `resignedBy`; carries the next `seq`
so it dedupes/conflicts like any move.

## State transitions (derived session status)

```
            ┌────────── move (applyMove ok, no winner) ──────────┐
            ▼                                                    │
  [ongoing] ──── winning/final move ────────────────▶ [won | draw]      (terminal)
      │
      ├───── resign accepted ───────────────────────▶ [resigned]        (terminal)
      │
      └───── invalid / conflicting / gapped inbound ▶ [out of sync]     (terminal)
```

All terminal states render the final board, disable input, and offer "Play again"
(= send a fresh GameStart bubble; chooser becomes player 0 of the new session, FR-009).

## Lifecycle inheritance (why no new store)

Because the session is a field on the `Message` row, these behave correctly with zero
game-specific code: disappearing-message sweep, message erase/delete, chat delete,
hidden-chat concealment, and sync exclusion — the exact set FR-015 requires. See D3.
