// Battleship GameModule (spec 0011) — the third catalog entry and the first
// with hidden information. `id` is frozen (contracts/battleship-protocol.md);
// the module's replayed state is the PUBLIC game only. Themes style the SHIP
// marks on your own grid; shot results use the fixed 💦💥🔥 language.

import { boatOutline } from 'ionicons/icons'
import type { GameModule } from '../types'
import { applyMove, createInitialState, status, turn, type BsMove, type BsState } from './logic'

const battleship: GameModule<BsState, BsMove> = {
  id: 'battleship',
  displayName: 'Battleship',
  icon: boatOutline,
  players: 2,
  createInitialState,
  applyMove,
  turn,
  status,
  // ONE look (spec 1033): the submarine design from the handoff IS Battleship's
  // identity — no theme choice. The id stays 'classic' (frozen default), and
  // ids from games started on older builds ('pirates', 'sea-monsters') fall
  // back here gracefully per the 0008 theme contract.
  themes: [{ id: 'classic', name: 'Submarine' }],
}

export default battleship
