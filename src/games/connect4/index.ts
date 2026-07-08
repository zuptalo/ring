// Connect Four GameModule (spec 0010) — the second catalog entry, proving the
// registry: this file + two registry lines are ALL the platform needs. `id` is
// frozen: it is serialized into sealed payloads, so a rules change means a NEW
// id, never a change behind this one (contracts/game-payload.md §3).

import { ellipseOutline } from 'ionicons/icons'
import type { GameModule } from '../types'
import { applyMove, createInitialState, status, turn, type C4Move, type C4State } from './logic'

const connect4: GameModule<C4State, C4Move> = {
  id: 'connect4',
  displayName: 'Connect Four',
  icon: ellipseOutline,
  players: 2,
  createInitialState,
  applyMove,
  turn,
  status,
  // Retired for now: the catalog is focused on the two fullscreen games
  // (chess, armada). Hidden from the picker; existing sessions still replay and
  // render forever (the id contract is honored) — only NEW games can't start.
  retired: true,
  // Visual themes (0008 FR-022 pattern). 'classic' is the canonical red-vs-
  // yellow disc look (geometric emoji — static by nature) on the blue frame;
  // the others pair ANIMATED marks from docs/ANIMATED-EMOJI.md so the
  // last-dropped disc plays. Accents are soft "r, g, b" board tints.
  themes: [
    { id: 'classic', name: 'Classic', marks: ['🔴', '🟡'], accent: '37, 99, 235' },
    { id: 'fruits', name: 'Fruits', marks: ['🍎', '🍋'], accent: '132, 204, 22' },
    { id: 'day-night', name: 'Day & Night', marks: ['🌞', '🌝'], accent: '14, 165, 233' },
  ],
}

export default connect4
