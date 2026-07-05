// Connect Four rules (spec 0010) — pure functions, no imports beyond types,
// mirroring tictactoe/logic.ts. 7 columns × 6 rows, row-major cells with row 0
// at the TOP (so rendering reads top-to-bottom); a move names a COLUMN and the
// disc takes the lowest free cell. Four in a row in any direction wins; 42
// moves without one is a draw. Everything a peer could get wrong is validated
// here, on both ends — the platform turns any violation into the labeled
// out-of-sync terminal, never a corrupted board.

export const COLS = 7;
export const ROWS = 6;

export interface C4State {
  /** 42 cells, row-major, row 0 at the top: index = row * COLS + col. */
  cells: (0 | 1 | null)[];
  /** Total discs played (drives turn + the draw-at-42 check cheaply). */
  moves: number;
}

export interface C4Move {
  col: number;
}

export type C4Status = { state: 'ongoing' | 'draw' } | { state: 'won'; winner: 0 | 1 };

export function createInitialState(): C4State {
  return { cells: Array<0 | 1 | null>(COLS * ROWS).fill(null), moves: 0 };
}

export function turn(s: C4State): 0 | 1 {
  return (s.moves % 2) as 0 | 1;
}

/** The row a disc dropped into `col` would land on, or -1 when full. */
function landingRow(s: C4State, col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (s.cells[row * COLS + col] === null) return row;
  }
  return -1;
}

/** Apply `move` for `player`. Null = illegal (wrong turn, finished game,
 *  malformed/out-of-range column, or a full column). Pure: returns a new state. */
export function applyMove(s: C4State, move: C4Move, player: 0 | 1): C4State | null {
  if (status(s).state !== 'ongoing') return null;
  if (player !== turn(s)) return null;
  const col = move?.col;
  if (typeof col !== 'number' || !Number.isInteger(col) || col < 0 || col >= COLS) return null;
  const row = landingRow(s, col);
  if (row < 0) return null;
  const cells = s.cells.slice();
  cells[row * COLS + col] = player;
  return { cells, moves: s.moves + 1 };
}

// The four line directions (right, down, down-right, down-left); each cell
// only needs to look FORWARD along each, so every 4-line is checked once.
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export function status(s: C4State): C4Status {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const p = s.cells[row * COLS + col];
      if (p === null) continue;
      for (const [dr, dc] of DIRS) {
        const er = row + 3 * dr;
        const ec = col + 3 * dc;
        if (er >= ROWS || ec < 0 || ec >= COLS) continue;
        if (
          s.cells[(row + dr) * COLS + col + dc] === p &&
          s.cells[(row + 2 * dr) * COLS + col + 2 * dc] === p &&
          s.cells[er * COLS + ec] === p
        ) {
          return { state: 'won', winner: p };
        }
      }
    }
  }
  return s.moves >= COLS * ROWS ? { state: 'draw' } : { state: 'ongoing' };
}
