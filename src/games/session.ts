// Game-agnostic session engine (spec 0008).
//
// Implements data-model.md validation rules 2–7 over a GameSession's
// append-only move log (rule 1, "does the target bubble exist", lives in
// queries.ts where the Message row is at hand). Everything here is pure:
// applySignal returns a fresh session, never mutates, and classifies every
// inbound signal deterministically so both devices reach the same verdict on
// the same input — the property that lets a tampering peer force only a
// labeled out-of-sync state, never a silently corrupted board (FR-004/FR-007).

import type { GameModule, GameSession, GameSessionStatus } from './types'

export type ApplyOutcome = 'applied' | 'dropped' | 'out-of-sync'

/** A gameMove signal as seen by the engine (messageId already resolved). */
export interface SessionSignal {
  seq: number
  action: 'move' | 'resign'
  move?: unknown
  at: number
}

/**
 * Replay the accepted log into the game's derived state. Accepted logs are
 * valid by construction; if replay ever hits an illegal move (corrupted
 * storage), we stop at the last consistent state rather than throw.
 */
export function replayState(module: GameModule, session: GameSession): unknown {
  let state = module.createInitialState()
  for (const rec of session.moves) {
    const next = module.applyMove(state, rec.move, rec.player)
    if (next === null) break
    state = next
  }
  return state
}

/**
 * Derive the user-facing status. Session-level terminals (out-of-sync,
 * resigned) take priority over the game's own verdict. A null module means
 * the gameType isn't in this build's registry (an older app seeing a future
 * game): report a bland "ongoing" and let the bubble render its
 * update-to-play fallback — never throw.
 */
export function deriveStatus(module: GameModule | null, session: GameSession): GameSessionStatus {
  if (!module) return { state: 'ongoing', turn: 0 }
  if (session.outOfSync) return { state: 'out-of-sync' }
  if (session.resignedBy !== undefined) {
    return { state: 'resigned', winner: (1 - session.resignedBy) as 0 | 1 }
  }
  const state = replayState(module, session)
  const verdict = module.status(state)
  if (verdict.state === 'won') return { state: 'won', winner: verdict.winner as 0 | 1 }
  if (verdict.state === 'draw') return { state: 'draw' }
  return { state: 'ongoing', turn: module.turn(state) }
}

/** May this player make a move right now? (Honest-sender gate, FR-003.) */
export function localMoveAllowed(
  module: GameModule | null,
  session: GameSession,
  player: 0 | 1,
): boolean {
  if (!module) return false
  const status = deriveStatus(module, session)
  return status.state === 'ongoing' && status.turn === player
}

function broken(session: GameSession): { session: GameSession; outcome: ApplyOutcome } {
  return { session: { ...session, outOfSync: true }, outcome: 'out-of-sync' }
}

/**
 * Validate and apply one signal (local or inbound — both run through the same
 * path so the two devices stay in lockstep). Rules, in order (data-model.md):
 *
 *   2. terminal session        → drop (a late move after a win/resign is not
 *                                 a conflict; the game was simply over)
 *      unknown action          → drop (forward compatibility, contract §3)
 *   3. duplicate seq, same     → drop (relay redelivery, FR-006)
 *   4. duplicate seq, differs  → out-of-sync
 *   5. seq gap                 → out-of-sync (relay is FIFO per sender; a gap
 *                                 means tampering or loss, not reordering)
 *   6. out-of-turn sender      → out-of-sync (moves only; resign is valid
 *                                 from either player)
 *   7. illegal move            → out-of-sync
 */
export function applySignal(
  module: GameModule | null,
  session: GameSession,
  signal: SessionSignal,
  sender: 0 | 1,
): { session: GameSession; outcome: ApplyOutcome } {
  // Unknown game in this build: we cannot validate, so we must not judge.
  if (!module) return { session, outcome: 'dropped' }

  // Rule 2 — terminal states absorb everything silently.
  if (deriveStatus(module, session).state !== 'ongoing') {
    return { session, outcome: 'dropped' }
  }

  // Forward compatibility: an action this build doesn't know is ignored,
  // never punished — a future client may legitimately send it.
  if (signal.action !== 'move' && signal.action !== 'resign') {
    return { session, outcome: 'dropped' }
  }

  const len = session.moves.length
  const { seq } = signal

  if (Number.isInteger(seq) && seq >= 1 && seq <= len) {
    // Rules 3/4 — the slot is already filled; identical content is a
    // redelivery, anything else is a fork.
    const existing = session.moves[seq - 1]
    const identical =
      signal.action === 'move' &&
      existing.player === sender &&
      JSON.stringify(existing.move) === JSON.stringify(signal.move)
    return identical ? { session, outcome: 'dropped' } : broken(session)
  }

  // Rule 5 — only the next contiguous slot is acceptable.
  if (seq !== len + 1) return broken(session)

  if (signal.action === 'resign') {
    return {
      session: { ...session, resignedBy: sender },
      outcome: 'applied',
    }
  }

  // Rules 6/7 — turn order, then legality, judged on the replayed state.
  const state = replayState(module, session)
  if (module.turn(state) !== sender) return broken(session)
  if (module.applyMove(state, signal.move, sender) === null) return broken(session)

  return {
    session: {
      ...session,
      moves: [...session.moves, { seq, player: sender, move: signal.move, at: signal.at }],
    },
    outcome: 'applied',
  }
}
