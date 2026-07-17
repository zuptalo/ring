import { describe, it, expect } from 'vitest';
import { createInitialState, applyMove, turn, status, type TicTacToeState } from './logic';

// Spec 0008 T002 — rules-engine unit tests (constitution III: written failing first).
// The module must be pure and deterministic: both devices replay the same move
// log and must derive the identical board (FR-004/FR-005, SC-003).

/** Play a sequence of cells, alternating players starting with player 0. */
function play(cells: number[]): TicTacToeState {
  let s = createInitialState();
  cells.forEach((cell, i) => {
    const next = applyMove(s, { cell }, (i % 2) as 0 | 1);
    if (next === null) throw new Error(`test setup: illegal move ${cell} at index ${i}`);
    s = next;
  });
  return s;
}

describe('tictactoe rules (spec 0008 US1)', () => {
  it('starts with 9 empty cells and player 0 to move', () => {
    const s = createInitialState();
    expect(s.cells).toHaveLength(9);
    expect(s.cells.every((c) => c === null)).toBe(true);
    expect(turn(s)).toBe(0);
    expect(status(s)).toEqual({ state: 'ongoing' });
  });

  it('a legal move fills the cell and flips the turn', () => {
    const s0 = createInitialState();
    const s1 = applyMove(s0, { cell: 4 }, 0);
    expect(s1).not.toBeNull();
    expect(s1!.cells[4]).toBe(0);
    expect(turn(s1!)).toBe(1);
    expect(s0.cells[4]).toBeNull(); // pure: input state untouched
  });

  it('rejects a move onto an occupied cell', () => {
    const s = play([4]);
    expect(applyMove(s, { cell: 4 }, 1)).toBeNull();
  });

  it('rejects out-of-range and malformed cells', () => {
    const s = createInitialState();
    expect(applyMove(s, { cell: 9 }, 0)).toBeNull();
    expect(applyMove(s, { cell: -1 }, 0)).toBeNull();
    expect(applyMove(s, { cell: 1.5 }, 0)).toBeNull();
    expect(applyMove(s, {} as never, 0)).toBeNull();
  });

  it('detects every winning line with the correct winner', () => {
    // For each of the 8 lines, player 0 takes the line while player 1 plays
    // three cells off the line (tic-tac-toe: X's 3rd move can win before O's).
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
      [0, 4, 8], [2, 4, 6], // diagonals
    ];
    for (const line of lines) {
      const others = [...Array(9).keys()].filter((c) => !line.includes(c));
      const s = play([line[0], others[0], line[1], others[1], line[2]]);
      expect(status(s)).toEqual({ state: 'won', winner: 0 });
    }
  });

  it('player 1 can win too', () => {
    // 0 plays 0,1,5 ; 1 plays 3,4,5-line... use column 2,5,8 for player 1
    const s = play([0, 2, 1, 5, 6, 8]);
    expect(status(s)).toEqual({ state: 'won', winner: 1 });
  });

  it('a full board with no line is a draw', () => {
    // 0:0 1:1 0:2 1:4 0:3 1:5 0:7 1:6 0:8 → no three-in-a-row
    const s = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(s.cells.every((c) => c !== null)).toBe(true);
    expect(status(s)).toEqual({ state: 'draw' });
  });

  it('reports ongoing mid-game', () => {
    const s = play([0, 4, 8]);
    expect(status(s)).toEqual({ state: 'ongoing' });
    expect(turn(s)).toBe(1);
  });

  it('is deterministic: the same moves always derive the same state', () => {
    const a = play([4, 0, 8, 2, 6]);
    const b = play([4, 0, 8, 2, 6]);
    expect(a).toEqual(b);
  });
});
