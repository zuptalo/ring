// Chess GameModule wrapper — the player/seat + draw-negotiation layer over the
// pure engine. These lock in the two things the wrapper adds beyond engine.ts:
// the 0=White / 1=Black seat mapping the wire depends on, and the draw
// offer/accept/decline state machine that rides the generic move channel with
// strict turn alternation (so session.ts needs no chess-specific code).
import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  applyMove,
  turn,
  status,
  colorOf,
  playerOf,
  type ChessState,
  type ChessMove,
} from './logic';

/** 'e2' -> [row, col], row 0 = rank 8. */
function sq(name: string): [number, number] {
  return [8 - Number(name[1]), 'abcdefgh'.indexOf(name[0])];
}
function move(from: string, to: string, promoteTo?: 'q' | 'r' | 'b' | 'n'): ChessMove {
  return { t: 'move', from: sq(from), to: sq(to), ...(promoteTo ? { promoteTo } : {}) };
}
/** Apply through the wrapper, asserting the move was legal (non-null). */
function apply(s: ChessState, m: ChessMove, player: 0 | 1): ChessState {
  const ns = applyMove(s, m, player);
  expect(ns).not.toBeNull();
  return ns as ChessState;
}

describe('seat mapping', () => {
  it('maps player 0 to White and 1 to Black', () => {
    expect(colorOf(0)).toBe('w');
    expect(colorOf(1)).toBe('b');
    expect(playerOf('w')).toBe(0);
    expect(playerOf('b')).toBe(1);
  });

  it('starts with White (player 0) to move', () => {
    expect(turn(createInitialState())).toBe(0);
    expect(status(createInitialState())).toEqual({ state: 'ongoing' });
  });
});

describe('moves and turn alternation', () => {
  it('alternates the seat to move and records the last move', () => {
    let s = createInitialState();
    s = apply(s, move('e2', 'e4'), 0);
    expect(turn(s)).toBe(1);
    expect(s.lastMove).toEqual({ from: sq('e2'), to: sq('e4') });
    s = apply(s, move('e7', 'e5'), 1);
    expect(turn(s)).toBe(0);
  });

  it('rejects a move by the player not on turn', () => {
    const s = createInitialState();
    expect(applyMove(s, move('e7', 'e5'), 1)).toBeNull(); // Black can't open
    expect(applyMove(s, move('e2', 'e5'), 0)).toBeNull(); // not a legal pawn move
  });
});

describe('draw negotiation over the move channel', () => {
  it('offer → the recipient must respond (turn flips to them)', () => {
    let s = createInitialState();
    // White offers a draw on their move.
    s = apply(s, { t: 'offer' }, 0);
    expect(s.drawOffer).toBe(0);
    expect(turn(s)).toBe(1); // Black must now accept or decline
    // Black cannot just move while an offer is pending.
    expect(applyMove(s, move('e7', 'e5'), 1)).toBeNull();
  });

  it('accept ends the game as a draw', () => {
    let s = createInitialState();
    s = apply(s, { t: 'offer' }, 0);
    s = apply(s, { t: 'accept' }, 1);
    expect(s.agreed).toBe(true);
    expect(status(s)).toEqual({ state: 'draw' });
    // Terminal: nothing else applies.
    expect(applyMove(s, move('e2', 'e4'), 0)).toBeNull();
  });

  it('decline clears the offer and returns the move to the offerer', () => {
    let s = createInitialState();
    s = apply(s, { t: 'offer' }, 0);
    s = apply(s, { t: 'decline' }, 1);
    expect(s.drawOffer).toBeNull();
    expect(turn(s)).toBe(0); // back to White to actually move
    s = apply(s, move('e2', 'e4'), 0);
    expect(turn(s)).toBe(1);
  });

  it('rejects an offer when it is not your turn, and a stray accept', () => {
    const s = createInitialState();
    expect(applyMove(s, { t: 'offer' }, 1)).toBeNull(); // Black, not on move
    expect(applyMove(s, { t: 'accept' }, 1)).toBeNull(); // nothing to accept
    expect(applyMove(s, { t: 'decline' }, 0)).toBeNull(); // nothing to decline
  });

  it('lets only the recipient accept/decline, not the offerer', () => {
    let s = createInitialState();
    s = apply(s, { t: 'offer' }, 0);
    expect(applyMove(s, { t: 'accept' }, 0)).toBeNull(); // offerer can't self-accept
    expect(applyMove(s, { t: 'decline' }, 0)).toBeNull();
  });
});

describe("Fool's Mate through the wrapper", () => {
  it('reports the winner by player index', () => {
    let s = createInitialState();
    s = apply(s, move('f2', 'f3'), 0);
    s = apply(s, move('e7', 'e5'), 1);
    s = apply(s, move('g2', 'g4'), 0);
    s = apply(s, move('d8', 'h4'), 1); // Qh4#
    expect(status(s)).toEqual({ state: 'won', winner: 1 }); // Black mates
    expect(applyMove(s, move('a2', 'a3'), 0)).toBeNull(); // game is over
  });
});
