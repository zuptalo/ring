// Game stats (spec 0008 FR-024) — the game's story in numbers, derived PURELY
// from the session's own timestamps. No extra tracking crosses the wire and no
// per-move receipts exist, so a player's "reply time" is approximated as the
// gap between the previous move's `at` and their move's `at` (the first move
// measures from the game's startedAt). Honest, cheap, and deterministic on
// both devices, since move timestamps are shared sealed content.

import { deriveStatus } from './session'
import type { GameModule, GameSession } from './types'

export interface PlayerGameStats {
  moves: number
  avgReplyMs: number | null
  fastestReplyMs: number | null
}

export interface GameStats {
  startedAt: number | null
  /** When the game reached a final state (won/draw at the last move, resigned
   *  at the resignation); null while ongoing or out of sync. */
  endedAt: number | null
  durationMs: number | null
  moveCount: number
  players: [PlayerGameStats, PlayerGameStats]
}

export function computeGameStats(module: GameModule | null, session: GameSession): GameStats {
  const startedAt = session.startedAt ?? null

  // Per-player reply gaps. A move with no base (first move on a legacy session
  // without startedAt) is simply excluded rather than guessed.
  const replies: [number[], number[]] = [[], []]
  const counts: [number, number] = [0, 0]
  let prevAt = startedAt
  for (const rec of session.moves) {
    counts[rec.player] += 1
    if (prevAt != null && rec.at >= prevAt) replies[rec.player].push(rec.at - prevAt)
    prevAt = rec.at
  }

  const status = deriveStatus(module, session)
  const lastMoveAt = session.moves.length ? session.moves[session.moves.length - 1].at : null
  const endedAt =
    status.state === 'resigned'
      ? (session.resignedAt ?? lastMoveAt)
      : status.state === 'won' || status.state === 'draw'
        ? lastMoveAt
        : null

  const player = (p: 0 | 1): PlayerGameStats => ({
    moves: counts[p],
    avgReplyMs: replies[p].length ? replies[p].reduce((a, b) => a + b, 0) / replies[p].length : null,
    fastestReplyMs: replies[p].length ? Math.min(...replies[p]) : null,
  })

  return {
    startedAt,
    endedAt,
    durationMs: startedAt != null && endedAt != null ? endedAt - startedAt : null,
    moveCount: session.moves.length,
    players: [player(0), player(1)],
  }
}
