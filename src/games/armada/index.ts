// Armada GameModule (spec 1038) — the fourth catalog entry and the first
// FULLSCREEN-presentation game: chat/wall surfaces render its challenge card
// and the board lives in the app-global game overlay. `id` is frozen
// (contracts/armada-protocol.md); the module's replayed state is the PUBLIC
// game only — layouts stay device-local until the reveal.

import { locateOutline } from 'ionicons/icons'
import type { GameModule } from '../types'
import { applyMove, createInitialState, mayMove as armadaMayMove, status, turn, type ArmadaMove, type ArmadaState } from './logic'

/** The foley a just-applied move deserves — armada reuses the naval FX layer
 *  battleship established (cue names are device-local, not wire): torpedo,
 *  splash, impact, or the groan of a sinking ship. Terminal moves fall back
 *  to the platform's win/lose fanfare; commits and reveals are silent
 *  bookkeeping. */
function moveCue(move: unknown, st: { state: string }, _me: 0 | 1): string | null {
  const m = move as ArmadaMove | null
  if (!m || typeof m !== 'object') return null
  if (st.state !== 'ongoing') return null // the result fanfare owns the ending
  if (m.t === 'shot') return 'bs-fire'
  if (m.t === 'answer') return m.r === 'miss' ? 'bs-splash' : m.r === 'sunk' ? 'bs-sunk' : 'bs-hit'
  return null
}

const armada: GameModule<ArmadaState, ArmadaMove> = {
  id: 'armada',
  displayName: 'Armada',
  icon: locateOutline,
  players: 2,
  createInitialState,
  applyMove,
  turn,
  status,
  moveCue,
  // Strict turn order EVERYWHERE, including sequential deployment commits —
  // the parallel-deploy feel lives in the staged commit + duty officer, never
  // in the rules (contract §Moves). The hook exists so the gate is explicit.
  mayMove: (state, player) => armadaMayMove(state as ArmadaState, player),
  // The whole point of spec 1038: played fullscreen, carded in the chat.
  presentation: 'fullscreen',
  // ONE look — the handoff's warship design IS Armada's identity.
  themes: [{ id: 'classic', name: 'Armada' }],
}

export default armada
