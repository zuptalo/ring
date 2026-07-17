// Chess GameModule — the fifth catalog entry and the second FULLSCREEN game
// (after Armada): chat/wall surfaces render its challenge card and the board
// lives in the app-global game overlay. `id` is frozen once shipped (it rides
// sealed payloads), so a rules change would mean a NEW id, never a change
// behind this one.
//
// Chess is a perfect-information, strictly-alternating game — so unlike Armada
// it needs no commit-and-reveal, no device-local secrets, and no duty officer:
// every move is a direct wire move over the generic session engine. The one
// nicety beyond raw moves, the draw offer, is modeled as a move too (see logic).

import { appsOutline } from 'ionicons/icons'
import type { GameModule } from '../types'
import {
  applyMove,
  createInitialState,
  status,
  turn,
  type ChessMove,
  type ChessState,
} from './logic'

const chess: GameModule<ChessState, ChessMove> = {
  id: 'chess',
  displayName: 'Chess',
  icon: appsOutline,
  players: 2,
  createInitialState,
  applyMove,
  turn,
  status,
  // Played fullscreen, carded in the chat/wall like Armada.
  presentation: 'fullscreen',
  // The card + overlay copy, in chess's own voice (no naval flavor). Chess
  // alternates from move 1, so parallelOpening stays false — no "deployment".
  card: {
    tagline: 'Chess match',
    emoji: '♟️', // unmistakably chess at a glance

    win: 'Checkmate — you win',
    loss: 'Checkmate — you were mated',
    resignWin: 'They resigned. The win is yours',
    resignLoss: 'You resigned',
    spectateFinished: 'Game decided',
    theirTurn: (name) => `${name} to move`,
    spectateOngoing: 'Game in progress',
  },
  // ONE look — a real chessboard. The board's own square palette is fixed
  // (a board is its own object), so there are no color themes to pick.
  themes: [{ id: 'classic', name: 'Chess' }],
}

export default chess
