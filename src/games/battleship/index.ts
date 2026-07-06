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
  // Marks are the SHIP glyphs (your fleet's look); results are always 💦💥🔥.
  themes: [
    { id: 'classic', name: 'Classic', marks: ['🚢', '🚢'], accent: '30, 64, 175' },
    { id: 'pirates', name: 'Pirates', marks: ['🏴‍☠️', '🏴‍☠️'], accent: '120, 53, 15' },
    { id: 'sea-monsters', name: 'Sea Monsters', marks: ['🐙', '🐙'], accent: '13, 148, 136' },
  ],
}

export default battleship
