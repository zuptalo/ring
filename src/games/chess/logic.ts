// Chess GameModule logic (the wire/replay wrapper around engine.ts).
//
// The pure rules engine (engine.ts) knows nothing about players, seats, or
// draw offers — it speaks colours ('w'/'b') and board mechanics. This file
// adapts it to the game-plugin contract: player indices (0 = White, 1 = Black),
// a replayable state, and a move union that the generic session engine treats
// as opaque `action:'move'` payloads.
//
// Draw offers are the one thing chess needs that the wire protocol
// (action: 'move' | 'resign') doesn't model directly. Rather than touch the
// shared protocol, an offer/accept/decline is just another chess MOVE: it
// flows over the same append-only, strictly-alternating move log. turn() names
// the player who must act next (the offer's recipient must accept or decline
// before play resumes), so seq alternation stays perfectly consistent on both
// devices — no special-casing in session.ts.

import {
  initialState,
  legalMoves,
  applyMove as engineApply,
  status as engineStatus,
  type GameState,
  type Move as EngineMove,
  type Color,
  type PieceType,
  type Square,
} from './engine'

/** Player 0 is White (the game starter, who moves first), player 1 is Black. */
export function colorOf(player: 0 | 1): Color {
  return player === 0 ? 'w' : 'b'
}
export function playerOf(col: Color): 0 | 1 {
  return col === 'w' ? 0 : 1
}

/** A wire move. A real chess move, or one of the three draw-negotiation actions. */
export type ChessMove =
  | { t: 'move'; from: Square; to: Square; promoteTo?: PieceType }
  | { t: 'offer' }
  | { t: 'accept' }
  | { t: 'decline' }

export interface ChessState {
  /** The pure engine position. */
  game: GameState
  /** The player who has a draw offer outstanding, or null. */
  drawOffer: 0 | 1 | null
  /** True once a draw was mutually agreed — a terminal state. */
  agreed: boolean
  /** The last real move's squares, for the board's last-move highlight. Derived
   *  and carried in state so the board reads it without a separate prop (the
   *  overlay passes last-move as null for every game). */
  lastMove: { from: Square; to: Square } | null
}

export function createInitialState(): ChessState {
  return { game: initialState(), drawOffer: null, agreed: false, lastMove: null }
}

/** Is the engine position itself already finished (mate/stalemate/50-move)? */
function engineTerminal(state: ChessState): boolean {
  const st = engineStatus(state.game)
  return st === 'checkmate' || st === 'stalemate' || st === 'draw50'
}

/**
 * Who must act next. Normally the side to move; but while a draw offer is
 * outstanding the RECIPIENT must respond first, so we name them instead — that
 * is what keeps wire seq strictly alternating through an offer/decline exchange.
 */
export function turn(state: ChessState): 0 | 1 {
  if (state.drawOffer !== null && !state.agreed && !engineTerminal(state)) {
    return (1 - state.drawOffer) as 0 | 1
  }
  return playerOf(state.game.turn)
}

export function status(state: ChessState): { state: 'ongoing' | 'won' | 'draw'; winner?: 0 | 1 } {
  if (state.agreed) return { state: 'draw' }
  const st = engineStatus(state.game)
  if (st === 'checkmate') {
    // The side to move has been mated; the other side wins.
    return { state: 'won', winner: state.game.turn === 'w' ? 1 : 0 }
  }
  if (st === 'stalemate' || st === 'draw50') return { state: 'draw' }
  return { state: 'ongoing' }
}

const PROMOTABLE: PieceType[] = ['q', 'r', 'b', 'n']

/**
 * Apply a wire move for `player`, or return null for anything illegal (never
 * throws — an honest client never sends an illegal move, so a null inbound is
 * by definition tampering and the session engine flags it out-of-sync).
 */
export function applyMove(state: ChessState, move: ChessMove, player: 0 | 1): ChessState | null {
  if (state.agreed || engineTerminal(state)) return null
  if (!move || typeof move !== 'object') return null
  // The acting player must be the one it's this player's turn to act as.
  if (turn(state) !== player) return null

  switch (move.t) {
    case 'offer': {
      // Offer only on your own move, and only one at a time. (turn(state) ===
      // player with no pending offer already means the mover is on turn.)
      if (state.drawOffer !== null) return null
      return { ...state, drawOffer: player }
    }
    case 'accept': {
      if (state.drawOffer === null || player !== 1 - state.drawOffer) return null
      return { ...state, agreed: true }
    }
    case 'decline': {
      if (state.drawOffer === null || player !== 1 - state.drawOffer) return null
      return { ...state, drawOffer: null }
    }
    case 'move': {
      // A pending draw must be resolved (accept/decline) before play resumes.
      if (state.drawOffer !== null) return null
      const from = move.from
      const to = move.to
      if (!validSquare(from) || !validSquare(to)) return null
      // legalMoves already restricts to the side to move (== colorOf(player)
      // since turn===player with no pending offer) and filters self-check.
      const options = legalMoves(state.game, from[0], from[1])
      const chosen = options.find((m) => m.to[0] === to[0] && m.to[1] === to[1])
      if (!chosen) return null
      let engMove: EngineMove = chosen
      if (chosen.promotion) {
        const pt = PROMOTABLE.includes(move.promoteTo as PieceType) ? (move.promoteTo as PieceType) : 'q'
        engMove = { ...chosen, promoteTo: pt }
      }
      const nextGame = engineApply(state.game, engMove)
      return { ...state, game: nextGame, drawOffer: null, lastMove: { from, to } }
    }
    default:
      return null
  }
}

function validSquare(sq: unknown): sq is Square {
  return (
    Array.isArray(sq) &&
    sq.length === 2 &&
    Number.isInteger(sq[0]) &&
    Number.isInteger(sq[1]) &&
    sq[0] >= 0 &&
    sq[0] < 8 &&
    sq[1] >= 0 &&
    sq[1] < 8
  )
}
