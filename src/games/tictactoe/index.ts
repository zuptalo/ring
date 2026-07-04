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
}

export default tictactoe
