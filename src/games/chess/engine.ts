/* Ring Chess — self-contained rules engine.
 *
 * Ported verbatim (behaviour-for-behaviour) from the design handoff's
 * dependency-free `engine.js`, then typed. Pure functions only: no IndexedDB,
 * no crypto, no framework ties — the same shape the crypto core follows, so the
 * rules are unit-testable in isolation. The stateful/wire layer lives elsewhere.
 *
 * Board is an 8x8 array, row 0 = rank 8 (top, Black's back rank). A piece is a
 * 2-char string: colour ('w'|'b') + type ('p','n','b','r','q','k'); an empty
 * square is null. Every state-producing function is pure and never mutates its
 * input — callers rely on that to keep the serializable match object immutable
 * between moves.
 */

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
/** e.g. 'wp', 'bk'. Never validated at the type level — trust the engine. */
export type Piece = string;
export type Board = (Piece | null)[][];
/** [row, col] with row 0 = rank 8. */
export type Square = [number, number];

export interface CastlingRights {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
}

export interface GameState {
  board: Board;
  turn: Color;
  castling: CastlingRights;
  /** en-passant target square, or null. */
  ep: Square | null;
  /** SAN-ish move list, newest last. */
  history: string[];
  /** half-move clock for the 50-move rule. */
  halfmove: number;
}

export interface Move {
  from: Square;
  to: Square;
  /** pawn reaches the last rank — caller must pick `promoteTo` (default 'q'). */
  promotion?: boolean;
  promoteTo?: PieceType;
  /** two-square pawn push (sets the ep target). */
  double?: boolean;
  /** this capture is an en-passant. */
  ep?: boolean;
  /** castling side, king-move only. */
  castle?: 'K' | 'Q';
}

export type Status = 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw50';

const FILES = 'abcdefgh';
export const GLYPH: Record<PieceType, string> = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
};
export const VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function inb(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}
export function color(p: Piece | null): Color | null {
  return p ? (p[0] as Color) : null;
}
export function type(p: Piece | null): PieceType | null {
  return p ? (p[1] as PieceType) : null;
}
function cloneBoard(b: Board): Board {
  return b.map((row) => row.slice());
}

export function initialState(): GameState {
  const b: Board = [];
  for (let r = 0; r < 8; r++) b.push([null, null, null, null, null, null, null, null]);
  const back: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let c = 0; c < 8; c++) {
    b[0][c] = 'b' + back[c];
    b[1][c] = 'bp';
    b[6][c] = 'wp';
    b[7][c] = 'w' + back[c];
  }
  return {
    board: b,
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    ep: null,
    history: [],
    halfmove: 0,
  };
}

/** Is square [r,c] attacked by any piece of colour `by`? */
function isAttacked(board: Board, r: number, c: number, by: Color): boolean {
  // pawn attacks: a 'by' pawn sits diagonally toward [r,c] from its side.
  if (by === 'w') {
    if (inb(r + 1, c - 1) && board[r + 1][c - 1] === 'wp') return true;
    if (inb(r + 1, c + 1) && board[r + 1][c + 1] === 'wp') return true;
  } else {
    if (inb(r - 1, c - 1) && board[r - 1][c - 1] === 'bp') return true;
    if (inb(r - 1, c + 1) && board[r - 1][c + 1] === 'bp') return true;
  }
  const kn = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
  ];
  for (let i = 0; i < kn.length; i++) {
    const nr = r + kn[i][0];
    const nc = c + kn[i][1];
    if (inb(nr, nc) && board[nr][nc] === by + 'n') return true;
  }
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const kr = r + dr;
      const kc = c + dc;
      if (inb(kr, kc) && board[kr][kc] === by + 'k') return true;
    }
  const diag = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (let d = 0; d < diag.length; d++) {
    let x = r + diag[d][0];
    let y = c + diag[d][1];
    while (inb(x, y)) {
      const p = board[x][y];
      if (p) {
        if (color(p) === by && (type(p) === 'b' || type(p) === 'q')) return true;
        break;
      }
      x += diag[d][0];
      y += diag[d][1];
    }
  }
  const orth = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let o = 0; o < orth.length; o++) {
    let ox = r + orth[o][0];
    let oy = c + orth[o][1];
    while (inb(ox, oy)) {
      const q = board[ox][oy];
      if (q) {
        if (color(q) === by && (type(q) === 'r' || type(q) === 'q')) return true;
        break;
      }
      ox += orth[o][0];
      oy += orth[o][1];
    }
  }
  return false;
}

export function findKing(board: Board, col: Color): Square | null {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) if (board[r][c] === col + 'k') return [r, c];
  return null;
}

export function inCheck(board: Board, col: Color): boolean {
  const k = findKing(board, col);
  if (!k) return false;
  return isAttacked(board, k[0], k[1], col === 'w' ? 'b' : 'w');
}

/** All moves the piece at [r,c] could make ignoring self-check (and castling). */
function pseudoMoves(state: GameState, r: number, c: number): Move[] {
  const board = state.board;
  const p = board[r][c];
  if (!p) return [];
  const col = color(p)!;
  const t = type(p)!;
  const enemy: Color = col === 'w' ? 'b' : 'w';
  const moves: Move[] = [];
  function add(nr: number, nc: number, extra?: Partial<Move>): void {
    const m: Move = { from: [r, c], to: [nr, nc] };
    if (extra) Object.assign(m, extra);
    moves.push(m);
  }
  if (t === 'p') {
    const dir = col === 'w' ? -1 : 1;
    const startRow = col === 'w' ? 6 : 1;
    const promoRow = col === 'w' ? 0 : 7;
    if (inb(r + dir, c) && !board[r + dir][c]) {
      if (r + dir === promoRow) add(r + dir, c, { promotion: true });
      else add(r + dir, c);
      if (r === startRow && !board[r + 2 * dir][c]) add(r + 2 * dir, c, { double: true });
    }
    for (let s = 0; s < 2; s++) {
      const dc = s === 0 ? -1 : 1;
      const nr = r + dir;
      const nc = c + dc;
      if (!inb(nr, nc)) continue;
      const tp = board[nr][nc];
      if (tp && color(tp) === enemy) {
        if (nr === promoRow) add(nr, nc, { promotion: true });
        else add(nr, nc);
      } else if (state.ep && state.ep[0] === nr && state.ep[1] === nc) {
        add(nr, nc, { ep: true });
      }
    }
  } else if (t === 'n') {
    const kn = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
    ];
    for (let i = 0; i < kn.length; i++) {
      const a = r + kn[i][0];
      const bb = c + kn[i][1];
      if (inb(a, bb) && color(board[a][bb]) !== col) add(a, bb);
    }
  } else if (t === 'k') {
    for (let dr = -1; dr <= 1; dr++)
      for (let dcc = -1; dcc <= 1; dcc++) {
        if (!dr && !dcc) continue;
        const kr = r + dr;
        const kc = c + dcc;
        if (inb(kr, kc) && color(board[kr][kc]) !== col) add(kr, kc);
      }
  } else {
    let dirs: number[][];
    if (t === 'b') dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    else if (t === 'r') dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    else dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let dd = 0; dd < dirs.length; dd++) {
      let x = r + dirs[dd][0];
      let y = c + dirs[dd][1];
      while (inb(x, y)) {
        const occ = board[x][y];
        if (!occ) add(x, y);
        else {
          if (color(occ) === enemy) add(x, y);
          break;
        }
        x += dirs[dd][0];
        y += dirs[dd][1];
      }
    }
  }
  return moves;
}

/** Apply `move` to `state`, returning a fresh state. Never mutates the input. */
export function applyMove(state: GameState, move: Move): GameState {
  const s: GameState = {
    board: cloneBoard(state.board),
    turn: state.turn === 'w' ? 'b' : 'w',
    castling: {
      wK: state.castling.wK,
      wQ: state.castling.wQ,
      bK: state.castling.bK,
      bQ: state.castling.bQ,
    },
    ep: null,
    history: state.history.slice(),
    halfmove: state.halfmove,
  };
  const b = s.board;
  const fr = move.from[0];
  const fc = move.from[1];
  const tr = move.to[0];
  const tc = move.to[1];
  const p = b[fr][fc]!;
  const col = color(p)!;
  const t = type(p)!;
  let captured: Piece | null = b[tr][tc];
  b[fr][fc] = null;
  b[tr][tc] = move.promotion ? col + (move.promoteTo || 'q') : p;
  if (move.ep) {
    const capRow = col === 'w' ? tr + 1 : tr - 1;
    b[capRow][tc] = null;
    captured = 'x';
  }
  if (t === 'k' && Math.abs(tc - fc) === 2) {
    if (tc === 6) {
      b[fr][5] = b[fr][7];
      b[fr][7] = null;
    } else if (tc === 2) {
      b[fr][3] = b[fr][0];
      b[fr][0] = null;
    }
  }
  if (move.double) s.ep = [(fr + tr) / 2, fc];
  if (t === 'k') {
    if (col === 'w') {
      s.castling.wK = false;
      s.castling.wQ = false;
    } else {
      s.castling.bK = false;
      s.castling.bQ = false;
    }
  }
  if (t === 'r') {
    if (fr === 7 && fc === 0) s.castling.wQ = false;
    if (fr === 7 && fc === 7) s.castling.wK = false;
    if (fr === 0 && fc === 0) s.castling.bQ = false;
    if (fr === 0 && fc === 7) s.castling.bK = false;
  }
  // A rook captured on its home square also voids that castling right.
  if (tr === 7 && tc === 0) s.castling.wQ = false;
  if (tr === 7 && tc === 7) s.castling.wK = false;
  if (tr === 0 && tc === 0) s.castling.bQ = false;
  if (tr === 0 && tc === 7) s.castling.bK = false;
  s.halfmove = t === 'p' || captured ? 0 : state.halfmove + 1;
  return s;
}

/** Fully-legal moves for the piece at [r,c] (filters self-check; adds castling). */
export function legalMoves(state: GameState, r: number, c: number): Move[] {
  const board = state.board;
  const p = board[r][c];
  if (!p || color(p) !== state.turn) return [];
  const col = color(p)!;
  const res: Move[] = [];
  const pm = pseudoMoves(state, r, c);
  for (let i = 0; i < pm.length; i++) {
    const ns = applyMove(state, pm[i]);
    if (!inCheck(ns.board, col)) res.push(pm[i]);
  }
  if (type(p) === 'k' && !inCheck(board, col)) {
    const row = col === 'w' ? 7 : 0;
    const enemy: Color = col === 'w' ? 'b' : 'w';
    const kSide = col === 'w' ? state.castling.wK : state.castling.bK;
    const qSide = col === 'w' ? state.castling.wQ : state.castling.bQ;
    if (
      kSide &&
      !board[row][5] &&
      !board[row][6] &&
      board[row][7] === col + 'r' &&
      !isAttacked(board, row, 5, enemy) &&
      !isAttacked(board, row, 6, enemy)
    ) {
      res.push({ from: [r, c], to: [row, 6], castle: 'K' });
    }
    if (
      qSide &&
      !board[row][1] &&
      !board[row][2] &&
      !board[row][3] &&
      board[row][0] === col + 'r' &&
      !isAttacked(board, row, 3, enemy) &&
      !isAttacked(board, row, 2, enemy)
    ) {
      res.push({ from: [r, c], to: [row, 2], castle: 'Q' });
    }
  }
  return res;
}

/** Every legal move for the side to move. */
export function allLegalMoves(state: GameState): Move[] {
  const arr: Move[] = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && color(p) === state.turn) {
        const lm = legalMoves(state, r, c);
        for (let i = 0; i < lm.length; i++) arr.push(lm[i]);
      }
    }
  return arr;
}

export function status(state: GameState): Status {
  const moves = allLegalMoves(state);
  const chk = inCheck(state.board, state.turn);
  if (moves.length === 0) return chk ? 'checkmate' : 'stalemate';
  if (state.halfmove >= 100) return 'draw50';
  return chk ? 'check' : 'playing';
}

function sqName(r: number, c: number): string {
  return FILES[c] + (8 - r);
}

/** Readable move notation (e4, Nf3, exd5, O-O, e8=Q, with +/#). SAN-ish: no
 *  same-square disambiguation (rare; the move list is a convenience, not PGN). */
export function toSAN(state: GameState, move: Move): string {
  if (move.castle === 'K') return castleSuffix(state, move, 'O-O');
  if (move.castle === 'Q') return castleSuffix(state, move, 'O-O-O');
  const p = state.board[move.from[0]][move.from[1]]!;
  const t = type(p)!;
  const capture = state.board[move.to[0]][move.to[1]] || move.ep;
  let s = '';
  if (t === 'p') {
    if (capture) s += FILES[move.from[1]] + 'x';
    s += sqName(move.to[0], move.to[1]);
    if (move.promotion) s += '=' + (move.promoteTo || 'q').toUpperCase();
  } else {
    s += t.toUpperCase();
    if (capture) s += 'x';
    s += sqName(move.to[0], move.to[1]);
  }
  return s + checkSuffix(state, move);
}

function castleSuffix(state: GameState, move: Move, base: string): string {
  return base + checkSuffix(state, move);
}

function checkSuffix(state: GameState, move: Move): string {
  const ns = applyMove(state, move);
  const st = status(ns);
  if (st === 'checkmate') return '#';
  if (st === 'check') return '+';
  return '';
}
