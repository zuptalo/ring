// Tic-tac-toe rules (spec 0008) — pure and deterministic, never throws.
//
// Both devices replay the same move log through these functions and must land
// on the identical board (FR-004/FR-005), so there is no randomness, no clock,
// and no mutation: applyMove returns a fresh state or null for anything
// illegal (occupied/out-of-range/malformed). Turn order is derived from the
// board itself (cell counts), keeping state minimal and replay trivially
// consistent.

export interface TicTacToeState {
  /** 9 cells, row-major; null = empty, 0/1 = the player occupying it. */
  cells: (0 | 1 | null)[]
}

export interface TicTacToeMove {
  /** 0-8, row-major. */
  cell: number
}

const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6], // diagonals
]

export function createInitialState(): TicTacToeState {
  return { cells: Array(9).fill(null) }
}

export function turn(state: TicTacToeState): 0 | 1 {
  // Player 0 (the game starter) moves first, so 0 is on move whenever both
  // players have played equally often.
  const placed = state.cells.filter((c) => c !== null).length
  return (placed % 2) as 0 | 1
}

export function status(state: TicTacToeState): { state: 'ongoing' | 'won' | 'draw'; winner?: 0 | 1 } {
  for (const [a, b, c] of LINES) {
    const v = state.cells[a]
    if (v !== null && v === state.cells[b] && v === state.cells[c]) {
      return { state: 'won', winner: v }
    }
  }
  if (state.cells.every((c) => c !== null)) return { state: 'draw' }
  return { state: 'ongoing' }
}

export function applyMove(
  state: TicTacToeState,
  move: TicTacToeMove,
  player: 0 | 1,
): TicTacToeState | null {
  const cell = move?.cell
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return null
  if (state.cells[cell] !== null) return null
  if (status(state).state !== 'ongoing') return null
  if (turn(state) !== player) return null
  const cells = state.cells.slice()
  cells[cell] = player
  return { cells }
}
