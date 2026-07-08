// Tic-tac-toe GameModule (spec 0008) — the catalog entry wiring the pure
// rules to their wire identity. `id` is frozen: it is serialized into sealed
// payloads, so a rules change means a NEW id, never a change behind this one
// (contracts/game-payload.md §3).

import { gridOutline } from 'ionicons/icons'
import type { GameModule } from '../types'
import {
  applyMove,
  createInitialState,
  status,
  turn,
  type TicTacToeMove,
  type TicTacToeState,
} from './logic'

const tictactoe: GameModule<TicTacToeState, TicTacToeMove> = {
  id: 'tictactoe',
  displayName: 'Tic-tac-toe',
  icon: gridOutline,
  players: 2,
  createInitialState,
  applyMove,
  turn,
  status,
  // Retired for now: the catalog is focused on the two fullscreen games
  // (chess, armada). Hidden from the picker; existing sessions still replay and
  // render forever (the id contract is honored) — only NEW games can't start.
  retired: true,
  // Visual themes (FR-022). Ids are frozen once shipped. Marks are pairs from
  // the ANIMATED emoji set (docs/ANIMATED-EMOJI.md) so the last-move pulse
  // plays; 'classic' has no marks and renders the color-coded SVG X/O.
  // Accents are soft "r, g, b" board tints.
  themes: [
    { id: 'classic', name: 'Classic' },
    { id: 'fire-ice', name: 'Fire & Ice', marks: ['🔥', '❄️'], accent: '234, 88, 12' },
    { id: 'space', name: 'Space', marks: ['🚀', '👽'], accent: '99, 102, 241' },
    { id: 'mythic', name: 'Mythic', marks: ['🦄', '🐉'], accent: '168, 85, 247' },
    { id: 'arcade', name: 'Arcade', marks: ['👾', '🤖'], accent: '16, 185, 129' },
    { id: 'snacks', name: 'Snacks', marks: ['🍕', '🍔'], accent: '245, 158, 11' },
  ],
}

export default tictactoe
