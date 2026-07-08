// Chess rules engine — the regression suite for the TS port of the design
// handoff's engine.js. These lock in the rules that are easy to break when
// refactoring: self-check filtering (pins), castling legality + rook bookkeeping,
// en passant, promotion, and the three game-ending verdicts (mate/stalemate/50).
import { describe, it, expect } from 'vitest';
import {
  initialState,
  legalMoves,
  allLegalMoves,
  applyMove,
  status,
  inCheck,
  toSAN,
  color,
  type,
  type GameState,
  type Board,
  type Move,
} from './engine';

/** Build a state from a sparse piece map, e.g. { 'e1': 'wk', 'e8': 'bk' }. */
function position(
  pieces: Record<string, string>,
  turn: 'w' | 'b' = 'w',
  extra: Partial<GameState> = {},
): GameState {
  const board: Board = [];
  for (let r = 0; r < 8; r++) board.push([null, null, null, null, null, null, null, null]);
  for (const sq in pieces) {
    const [r, c] = fromName(sq);
    board[r][c] = pieces[sq];
  }
  return {
    board,
    turn,
    castling: { wK: false, wQ: false, bK: false, bQ: false },
    ep: null,
    history: [],
    halfmove: 0,
    ...extra,
  };
}

/** 'e1' -> [row, col] with row 0 = rank 8. */
function fromName(sq: string): [number, number] {
  const c = 'abcdefgh'.indexOf(sq[0]);
  const r = 8 - Number(sq[1]);
  return [r, c];
}

/** Does the piece at `from` have a legal move landing on `to`? */
function canReach(state: GameState, from: string, to: string): boolean {
  const [fr, fc] = fromName(from);
  const [tr, tc] = fromName(to);
  return legalMoves(state, fr, fc).some((m) => m.to[0] === tr && m.to[1] === tc);
}

function moveTo(state: GameState, from: string, to: string): Move {
  const [fr, fc] = fromName(from);
  const [tr, tc] = fromName(to);
  const m = legalMoves(state, fr, fc).find((x) => x.to[0] === tr && x.to[1] === tc);
  if (!m) throw new Error(`no legal move ${from}->${to}`);
  return m;
}

describe('initial position', () => {
  it('sets up 32 pieces with White to move', () => {
    const s = initialState();
    expect(s.turn).toBe('w');
    let count = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (s.board[r][c]) count++;
    expect(count).toBe(32);
    expect(s.board[7][4]).toBe('wk');
    expect(s.board[0][4]).toBe('bk');
  });

  it('offers White 20 opening moves', () => {
    expect(allLegalMoves(initialState()).length).toBe(20);
  });

  it('lets a pawn push one or two squares from its start', () => {
    const s = initialState();
    expect(canReach(s, 'e2', 'e3')).toBe(true);
    expect(canReach(s, 'e2', 'e4')).toBe(true);
    expect(canReach(s, 'e2', 'e5')).toBe(false);
  });
});

describe('pins and self-check', () => {
  it('forbids moving a pinned piece off the pin line', () => {
    // White king e1, White bishop e2, Black rook e8 — bishop is pinned.
    const s = position({ e1: 'wk', e2: 'wb', e8: 'br' });
    expect(canReach(s, 'e2', 'd3')).toBe(false); // would expose the king
    expect(inCheck(s.board, 'w')).toBe(false);
  });

  it('a move that leaves the king in check is illegal', () => {
    const s = position({ e1: 'wk', a1: 'wr', e8: 'br' }, 'w');
    // King is in check from the rook; only responses that block/escape are legal.
    expect(canReach(s, 'a1', 'a2')).toBe(false); // ignoring check is illegal
    expect(canReach(s, 'a1', 'e1')).toBe(false); // own king square, nonsense
  });
});

describe('castling', () => {
  it('allows kingside castling and moves the rook', () => {
    const s = position(
      { e1: 'wk', h1: 'wr', e8: 'bk' },
      'w',
      { castling: { wK: true, wQ: false, bK: false, bQ: false } },
    );
    expect(canReach(s, 'e1', 'g1')).toBe(true);
    const ns = applyMove(s, moveTo(s, 'e1', 'g1'));
    const [kr, kc] = fromName('g1');
    const [rr, rc] = fromName('f1');
    expect(ns.board[kr][kc]).toBe('wk');
    expect(ns.board[rr][rc]).toBe('wr'); // rook jumped to f1
    expect(ns.castling.wK).toBe(false); // right consumed
  });

  it('forbids castling through an attacked square', () => {
    // Black rook on f8 attacks f1 — the king would pass through check.
    const s = position(
      { e1: 'wk', h1: 'wr', f8: 'br', e7: 'bk' },
      'w',
      { castling: { wK: true, wQ: false, bK: false, bQ: false } },
    );
    expect(canReach(s, 'e1', 'g1')).toBe(false);
  });

  it('voids the castling right when the rook is captured on its home square', () => {
    const s = position(
      { e1: 'wk', h1: 'wr', a8: 'bq', e8: 'bk' },
      'b',
      { castling: { wK: true, wQ: false, bK: false, bQ: false } },
    );
    // Black queen takes the h1 rook: White loses kingside castling.
    const ns = applyMove(s, moveTo(s, 'a8', 'h1'));
    expect(ns.castling.wK).toBe(false);
  });
});

describe('en passant', () => {
  it('captures a pawn that just double-pushed alongside', () => {
    // White pawn e5, Black plays d7-d5; White can take en passant on d6.
    let s = position({ e5: 'wp', d7: 'bp', e1: 'wk', e8: 'bk' }, 'b');
    s = applyMove(s, moveTo(s, 'd7', 'd5'));
    expect(s.ep).not.toBeNull();
    expect(canReach(s, 'e5', 'd6')).toBe(true);
    const ns = applyMove(s, moveTo(s, 'e5', 'd6'));
    const [cr, cc] = fromName('d5');
    expect(ns.board[cr][cc]).toBeNull(); // the double-pushed pawn is gone
  });
});

describe('promotion', () => {
  it('flags the move and promotes to the chosen piece', () => {
    const s = position({ a7: 'wp', e1: 'wk', e8: 'bk' }, 'w');
    const m = moveTo(s, 'a7', 'a8');
    expect(m.promotion).toBe(true);
    const ns = applyMove(s, { ...m, promoteTo: 'q' });
    const [r, c] = fromName('a8');
    expect(ns.board[r][c]).toBe('wq');
  });
});

describe('game-ending verdicts', () => {
  it("detects Fool's Mate (checkmate)", () => {
    // 1. f3 e5 2. g4 Qh4#
    let s = initialState();
    s = applyMove(s, moveTo(s, 'f2', 'f3'));
    s = applyMove(s, moveTo(s, 'e7', 'e5'));
    s = applyMove(s, moveTo(s, 'g2', 'g4'));
    s = applyMove(s, moveTo(s, 'd8', 'h4'));
    expect(status(s)).toBe('checkmate');
    expect(inCheck(s.board, 'w')).toBe(true);
  });

  it('detects stalemate (no legal move, not in check)', () => {
    // Classic: Black king a8, White king c7, White queen b6 — Black to move, stalemate.
    const s = position({ a8: 'bk', c7: 'wk', b6: 'wq' }, 'b');
    expect(allLegalMoves(s).length).toBe(0);
    expect(inCheck(s.board, 'b')).toBe(false);
    expect(status(s)).toBe('stalemate');
  });

  it('reports the 50-move draw at 100 half-moves', () => {
    const s = position({ e1: 'wk', e8: 'bk', a1: 'wr' }, 'w', { halfmove: 100 });
    expect(status(s)).toBe('draw50');
  });
});

describe('SAN notation', () => {
  it('writes pawn pushes, piece moves, castling and mate', () => {
    const s = initialState();
    expect(toSAN(s, moveTo(s, 'e2', 'e4'))).toBe('e4');
    expect(toSAN(s, moveTo(s, 'g1', 'f3'))).toBe('Nf3');

    let fools = initialState();
    fools = applyMove(fools, moveTo(fools, 'f2', 'f3'));
    fools = applyMove(fools, moveTo(fools, 'e7', 'e5'));
    fools = applyMove(fools, moveTo(fools, 'g2', 'g4'));
    expect(toSAN(fools, moveTo(fools, 'd8', 'h4'))).toBe('Qh4#');
  });

  it('marks a capture with x', () => {
    const s = position({ e4: 'wp', d5: 'bp', e1: 'wk', e8: 'bk' }, 'w');
    expect(toSAN(s, moveTo(s, 'e4', 'd5'))).toBe('exd5');
  });
});

describe('helpers', () => {
  it('reads colour and type off a piece string', () => {
    expect(color('wq')).toBe('w');
    expect(type('wq')).toBe('q');
    expect(color(null)).toBeNull();
  });
});
