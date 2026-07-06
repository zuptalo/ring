// Battleship GameModule (spec 0011) — the third catalog entry and the first
// with hidden information. `id` is frozen (contracts/battleship-protocol.md);
// the module's replayed state is the PUBLIC game only. Themes style the SHIP
// marks on your own grid; shot results use the fixed 💦💥🔥 language.

import { boatOutline } from 'ionicons/icons'
import type { GameModule } from '../types'
import { applyMove, createInitialState, mayMove as bsMayMove, status, turn, type BsMove, type BsState } from './logic'

/** The foley a just-applied move deserves (spec 1033): torpedo, splash,
 *  impact, or the groan of a sinking boat. Terminal moves fall back to the
 *  platform's win/lose fanfare; commits and reveals are silent bookkeeping. */
function moveCue(move: unknown, st: { state: string }, _me: 0 | 1): string | null {
  const m = move as BsMove | null
  if (!m || typeof m !== 'object') return null
  if (st.state !== 'ongoing') return null // the result fanfare owns the ending
  if (m.t === 'shot') return 'bs-fire'
  if (m.t === 'answer') return m.r === 'miss' ? 'bs-splash' : m.r === 'sunk' ? 'bs-sunk' : 'bs-hit'
  return null
}

const battleship: GameModule<BsState, BsMove> = {
  id: 'battleship',
  displayName: 'Battleship',
  icon: boatOutline,
  players: 2,
  createInitialState,
  applyMove,
  turn,
  status,
  moveCue,
  mayMove: (state, player) => bsMayMove(state as BsState, player),
  // ONE look (spec 1033): the submarine design from the handoff IS Battleship's
  // identity — no theme choice. The id stays 'classic' (frozen default), and
  // ids from games started on older builds ('pirates', 'sea-monsters') fall
  // back here gracefully per the 0008 theme contract.
  themes: [{ id: 'classic', name: 'Submarine' }],
}

export default battleship
