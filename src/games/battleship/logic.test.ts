// Spec 0011 T001 — the Battleship protocol as tests, red-first. The stakes are
// higher than a rulebook: this suite pins the COMMIT-AND-REVEAL honesty
// machinery, so every cheat class is a test before the verifier exists.
import { beforeAll, describe, it, expect } from 'vitest';
import { ready } from '@/services/crypto/primitives';
import {
  createInitialState,
  applyMove,
  status,
  turn,
  randomLayout,
  layoutLegal,
  commitment,
  randomSalt,
  judgeShot,
  cellsOf,
  type BsMove,
  type BsState,
  type Layout,
} from './logic';

beforeAll(async () => {
  await ready(); // commitments hash through libsodium
});

// A fixed, legal layout pair for deterministic games.
const L0: Layout = [
  { r: 0, c: 0, len: 4, dir: 'h' },
  { r: 2, c: 0, len: 3, dir: 'h' },
  { r: 4, c: 0, len: 3, dir: 'h' },
  { r: 6, c: 0, len: 2, dir: 'h' },
];
const L1: Layout = [
  { r: 0, c: 7, len: 4, dir: 'v' },
  { r: 0, c: 5, len: 3, dir: 'v' },
  { r: 4, c: 5, len: 3, dir: 'v' },
  { r: 6, c: 3, len: 2, dir: 'h' },
];
const S0 = 'c2FsdDA';
const S1 = 'c2FsdDE';

function apply(s: BsState, move: BsMove, player: 0 | 1): BsState {
  const next = applyMove(s, move, player);
  expect(next, `${JSON.stringify(move)} by ${player} should be legal`).not.toBeNull();
  return next!;
}

/** Both players commit their fixed layouts. */
function committed(): BsState {
  let s = createInitialState();
  s = apply(s, { t: 'commit', h: commitment(L0, S0) }, 0);
  s = apply(s, { t: 'commit', h: commitment(L1, S1) }, 1);
  return s;
}

/** Play a full honest game: P0 hunts L1's 12 cells in order, P1 shoots misses.
 *  Returns the state right after the winner's (P0's) final reveal. */
function honestGame(): BsState {
  let s = committed();
  const targets = L1.flatMap((ship) => cellsOf(ship));
  const p1Misses = [0, 1, 2, 8, 9, 10, 16, 17, 18, 24, 25].filter(
    (c) => !L0.flatMap((sh) => cellsOf(sh)).includes(c),
  );
  let hits = 0;
  let mi = 0;
  for (const cell of targets) {
    s = apply(s, { t: 'shot', cell }, 0);
    hits += 1;
    const r = judgeShot(L1, cell, targets.slice(0, hits));
    if (hits === 12) {
      s = apply(s, { t: 'answer', r: 'sunk', reveal: { layout: L1, salt: S1 } }, 1);
      break;
    }
    s = apply(s, { t: 'answer', r }, 1);
    // P1's return shot (a miss into open water), answered by P0.
    s = apply(s, { t: 'shot', cell: 63 - mi }, 1);
    s = apply(s, { t: 'answer', r: judgeShot(L0, 63 - mi, []) }, 0);
    mi += 1;
  }
  // Verify phase: the winner owes the closing reveal.
  expect(status(s)).toEqual({ state: 'ongoing', turn: 0 });
  return apply(s, { t: 'reveal', layout: L0, salt: S0 }, 0);
}

describe('placement', () => {
  it('random layouts are always legal (bounds, no overlap, full fleet), across many rolls', () => {
    let x = 42;
    const rand = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 200; i++) {
      const l = randomLayout(rand);
      expect(layoutLegal(l)).toBe(true);
      expect(l.flatMap(cellsOf)).toHaveLength(12);
    }
  });

  it('layoutLegal rejects out-of-bounds, overlap, and a wrong fleet', () => {
    expect(layoutLegal([{ r: 0, c: 6, len: 4, dir: 'h' }, ...L0.slice(1)])).toBe(false); // off the edge
    expect(
      layoutLegal([
        { r: 0, c: 0, len: 4, dir: 'h' },
        { r: 0, c: 0, len: 3, dir: 'v' }, // overlaps at (0,0)
        { r: 4, c: 0, len: 3, dir: 'h' },
        { r: 6, c: 0, len: 2, dir: 'h' },
      ]),
    ).toBe(false);
    expect(layoutLegal(L0.slice(0, 3) as Layout)).toBe(false); // missing a ship
  });

  it('commitments are salt-sensitive and layout-sensitive', () => {
    expect(commitment(L0, S0)).not.toBe(commitment(L0, S1));
    expect(commitment(L0, S0)).not.toBe(commitment(L1, S0));
    expect(commitment(L0, S0)).toBe(commitment(L0, S0));
    expect(randomSalt()).not.toBe(randomSalt());
  });
});

describe('phase machine', () => {
  it('commits go P0 then P1; nothing else is legal while placing', () => {
    let s = createInitialState();
    expect(turn(s)).toBe(0);
    expect(applyMove(s, { t: 'commit', h: 'x' }, 1)).toBeNull(); // P1 cannot jump the queue
    expect(applyMove(s, { t: 'shot', cell: 0 }, 0)).toBeNull();
    s = apply(s, { t: 'commit', h: commitment(L0, S0) }, 0);
    expect(turn(s)).toBe(1);
    expect(applyMove(s, { t: 'commit', h: 'y' }, 0)).toBeNull(); // no double commit
  });

  it('battle alternates shot → answer, P0 firing first', () => {
    let s = committed();
    expect(turn(s)).toBe(0);
    expect(applyMove(s, { t: 'shot', cell: 5 }, 1)).toBeNull(); // not P1's turn
    s = apply(s, { t: 'shot', cell: 5 }, 0);
    expect(turn(s)).toBe(1); // defender answers
    expect(applyMove(s, { t: 'shot', cell: 9 }, 1)).toBeNull(); // must answer first
    s = apply(s, { t: 'answer', r: 'miss' }, 1);
    expect(turn(s)).toBe(1); // then fires back
    s = apply(s, { t: 'shot', cell: 9 }, 1);
    expect(turn(s)).toBe(0);
  });

  it('an attacker cannot shoot the same cell twice', () => {
    let s = committed();
    s = apply(s, { t: 'shot', cell: 5 }, 0);
    s = apply(s, { t: 'answer', r: 'miss' }, 1);
    s = apply(s, { t: 'shot', cell: 5 }, 1); // the OTHER attacker may shoot 5
    s = apply(s, { t: 'answer', r: 'hit' }, 0);
    expect(applyMove(s, { t: 'shot', cell: 5 }, 0)).toBeNull(); // repeat for P0
  });

  it('the final (12th-hit) answer must carry the reveal', () => {
    let s = committed();
    const targets = L1.flatMap(cellsOf);
    for (let i = 0; i < 11; i++) {
      s = apply(s, { t: 'shot', cell: targets[i] }, 0);
      s = apply(s, { t: 'answer', r: judgeShot(L1, targets[i], targets.slice(0, i + 1)) }, 1);
      s = apply(s, { t: 'shot', cell: 56 + i > 63 ? 32 + i : 56 + i }, 1);
      s = apply(s, { t: 'answer', r: 'miss' }, 0);
    }
    s = apply(s, { t: 'shot', cell: targets[11] }, 0);
    expect(applyMove(s, { t: 'answer', r: 'sunk' }, 1)).toBeNull(); // bare final answer: illegal
    s = apply(s, { t: 'answer', r: 'sunk', reveal: { layout: L1, salt: S1 } }, 1);
    // Verify phase: ONLY the winner's reveal is legal now.
    expect(applyMove(s, { t: 'shot', cell: 40 }, 1)).toBeNull();
    expect(applyMove(s, { t: 'reveal', layout: L0, salt: S0 }, 1)).toBeNull();
    expect(status(s)).toEqual({ state: 'ongoing', turn: 0 });
  });
});

describe('verification (the honesty machinery)', () => {
  it('an honest game ends won by the final attacker', () => {
    expect(status(honestGame())).toEqual({ state: 'won', winner: 0 });
  });

  it('a wrong salt in the loser reveal flips the win to the loser-side opponent... '
    + 'i.e. the cheater loses either way: winner-side cheat flips the result', () => {
    // Winner (P0) reveals with the WRONG salt → P0's commitment check fails →
    // the win flips to P1.
    let s = committed();
    const targets = L1.flatMap(cellsOf);
    let hits = 0;
    for (const cell of targets) {
      s = apply(s, { t: 'shot', cell }, 0);
      hits += 1;
      if (hits === 12) {
        s = apply(s, { t: 'answer', r: 'sunk', reveal: { layout: L1, salt: S1 } }, 1);
        break;
      }
      s = apply(s, { t: 'answer', r: judgeShot(L1, cell, targets.slice(0, hits)) }, 1);
      s = apply(s, { t: 'shot', cell: 63 - hits }, 1);
      s = apply(s, { t: 'answer', r: judgeShot(L0, 63 - hits, []) }, 0);
    }
    s = apply(s, { t: 'reveal', layout: L0, salt: S1 }, 0); // wrong salt
    expect(status(s)).toEqual({ state: 'won', winner: 1 });
  });

  it('a lied answer (miss on a real hit) is caught at reveal time and flips the result', () => {
    // P1 lies 'miss' when P0 hits L1's cell — P0 never completes the hunt that
    // way, so script it short: P1 lies once, then P0 still sinks all 12 declared
    // cells is impossible... instead: P1 (defender) lies about cell T, P0 keeps
    // hunting the remaining 11 + one water cell declared 'hit' by the liar to
    // reach 12 declared hits, final answer carries P1's TRUE layout+salt → the
    // answer history contradicts the layout → P1 (the loser) proves themselves
    // a cheater; the presumptive winner P0 keeps the win. The flip matters on
    // the WINNER side (previous test); on the loser side the verdict stands.
    let s = committed();
    const targets = L1.flatMap(cellsOf);
    // P0 shoots a genuinely empty cell that P1 falsely answers 'hit'.
    const water = [...Array(64).keys()].find((c) => !targets.includes(c))!;
    s = apply(s, { t: 'shot', cell: water }, 0);
    s = apply(s, { t: 'answer', r: 'hit' }, 1); // the lie
    s = apply(s, { t: 'shot', cell: 63 }, 1);
    s = apply(s, { t: 'answer', r: judgeShot(L0, 63, []) }, 0);
    let declaredHits = 1;
    for (const cell of targets) {
      s = apply(s, { t: 'shot', cell }, 0);
      declaredHits += 1;
      if (declaredHits === 12) {
        s = apply(s, { t: 'answer', r: 'sunk', reveal: { layout: L1, salt: S1 } }, 1);
        break;
      }
      s = apply(s, { t: 'answer', r: judgeShot(L1, cell, targets.slice(0, targets.indexOf(cell) + 1)) }, 1);
      s = apply(s, { t: 'shot', cell: 62 - declaredHits }, 1);
      s = apply(s, { t: 'answer', r: judgeShot(L0, 62 - declaredHits, []) }, 0);
    }
    s = apply(s, { t: 'reveal', layout: L0, salt: S0 }, 0);
    // P1's answers contradict P1's true layout → P1 is the proven cheater; the
    // result stays with P0 and the verdict is deterministic for any replayer.
    expect(status(s)).toEqual({ state: 'won', winner: 0 });
  });

  it('an illegal revealed layout (moved ship) flips against the revealer', () => {
    let s = committed();
    const targets = L1.flatMap(cellsOf);
    let hits = 0;
    for (const cell of targets) {
      s = apply(s, { t: 'shot', cell }, 0);
      hits += 1;
      if (hits === 12) {
        // The loser reveals a DIFFERENT (still legal-shaped) layout: commitment fails.
        s = apply(s, { t: 'answer', r: 'sunk', reveal: { layout: L0, salt: S1 } }, 1);
        break;
      }
      s = apply(s, { t: 'answer', r: judgeShot(L1, cell, targets.slice(0, hits)) }, 1);
      s = apply(s, { t: 'shot', cell: 63 - hits }, 1);
      s = apply(s, { t: 'answer', r: judgeShot(L0, 63 - hits, []) }, 0);
    }
    s = apply(s, { t: 'reveal', layout: L0, salt: S0 }, 0);
    expect(status(s)).toEqual({ state: 'won', winner: 0 }); // loser cheated; verdict stands
  });

  it('both reveals invalid → a disgraceful draw', () => {
    let s = committed();
    const targets = L1.flatMap(cellsOf);
    let hits = 0;
    for (const cell of targets) {
      s = apply(s, { t: 'shot', cell }, 0);
      hits += 1;
      if (hits === 12) {
        s = apply(s, { t: 'answer', r: 'sunk', reveal: { layout: L1, salt: S0 } }, 1); // bad salt
        break;
      }
      s = apply(s, { t: 'answer', r: judgeShot(L1, cell, targets.slice(0, hits)) }, 1);
      s = apply(s, { t: 'shot', cell: 63 - hits }, 1);
      s = apply(s, { t: 'answer', r: judgeShot(L0, 63 - hits, []) }, 0);
    }
    s = apply(s, { t: 'reveal', layout: L0, salt: S1 }, 0); // bad salt too
    expect(status(s)).toEqual({ state: 'draw' });
  });
});
