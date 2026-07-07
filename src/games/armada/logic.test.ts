// Spec 1038 T002 — the Armada protocol as tests, red-first. Same stakes as
// battleship's suite (this pins the commit-and-reveal honesty machinery), plus
// the two 1038-specific guarantees: the commitment binds the 10×10 five-ship
// geometry, and deployment commits are SEQUENTIAL on the wire (the shipped
// parallel-commit seq race is a proven session killer — contract §Moves).
import { beforeAll, describe, it, expect } from 'vitest';
import { ready } from '@/services/crypto/primitives';
import { applySignal, localMoveAllowed } from '@/games/session';
import type { GameModule, GameSession } from '@/games/types';
import {
  createInitialState,
  applyMove,
  mayMove,
  status,
  turn,
  randomLayout,
  layoutLegal,
  serializeLayout,
  commitment,
  randomSalt,
  judgeShot,
  cellsOf,
  fleetView,
  SIZE,
  FLEET,
  FLEET_CELLS,
  SHIP_CLASSES,
  type ArmadaMove,
  type ArmadaState,
  type Layout,
} from './logic';

beforeAll(async () => {
  await ready(); // commitments hash through libsodium
});

// Fixed, legal layouts for deterministic games (canonical class order:
// Carrier 5, Battleship 4, Cruiser 3, Submarine 3, Destroyer 2).
const L0: Layout = [
  { r: 0, c: 0, len: 5, dir: 'h' },
  { r: 2, c: 0, len: 4, dir: 'h' },
  { r: 4, c: 0, len: 3, dir: 'h' },
  { r: 6, c: 0, len: 3, dir: 'h' },
  { r: 8, c: 0, len: 2, dir: 'h' },
];
const L1: Layout = [
  { r: 0, c: 9, len: 5, dir: 'v' },
  { r: 0, c: 7, len: 4, dir: 'v' },
  { r: 0, c: 5, len: 3, dir: 'v' },
  { r: 5, c: 7, len: 3, dir: 'v' },
  { r: 8, c: 3, len: 2, dir: 'h' },
];
const S0 = 'c2FsdDA';
const S1 = 'c2FsdDE';

function apply(s: ArmadaState, move: ArmadaMove, player: 0 | 1): ArmadaState {
  const next = applyMove(s, move, player);
  expect(next, `${JSON.stringify(move)} by ${player} should be legal`).not.toBeNull();
  return next!;
}

/** Both players commit their fixed layouts (P0 first — commits are sequential). */
function committed(): ArmadaState {
  let s = createInitialState();
  s = apply(s, { t: 'commit', h: commitment(L0, S0) }, 0);
  s = apply(s, { t: 'commit', h: commitment(L1, S1) }, 1);
  return s;
}

/** P1's return shots: open water on P0's board (all > cell 84, none in L0). */
const p1Miss = (i: number): number => 99 - i;

/** Play a full honest game: P0 hunts L1's 17 cells in order, P1 misses back.
 *  Ends right after the winner's (P0's) closing reveal. */
function honestGame(): ArmadaState {
  let s = committed();
  const targets = L1.flatMap((ship) => cellsOf(ship));
  let hits = 0;
  for (const cell of targets) {
    s = apply(s, { t: 'shot', cell }, 0);
    hits += 1;
    if (hits === FLEET_CELLS) {
      s = apply(s, { t: 'answer', r: 'sunk', reveal: { layout: L1, salt: S1 } }, 1);
      break;
    }
    s = apply(s, { t: 'answer', r: judgeShot(L1, cell, targets.slice(0, hits)) }, 1);
    s = apply(s, { t: 'shot', cell: p1Miss(hits) }, 1);
    s = apply(s, { t: 'answer', r: 'miss' }, 0);
  }
  expect(status(s)).toEqual({ state: 'ongoing', turn: 0 }); // verify: winner owes the reveal
  return apply(s, { t: 'reveal', layout: L0, salt: S0 }, 0);
}

/** Run a scripted cheat-flavored game where the LOSER's final reveal is
 *  `loserReveal` and the WINNER closes with `winnerReveal`. */
function riggedGame(loserReveal: { layout: Layout; salt: string }, winnerReveal: { layout: Layout; salt: string }): ArmadaState {
  let s = committed();
  const targets = L1.flatMap(cellsOf);
  let hits = 0;
  for (const cell of targets) {
    s = apply(s, { t: 'shot', cell }, 0);
    hits += 1;
    if (hits === FLEET_CELLS) {
      s = apply(s, { t: 'answer', r: 'sunk', reveal: loserReveal }, 1);
      break;
    }
    s = apply(s, { t: 'answer', r: judgeShot(L1, cell, targets.slice(0, hits)) }, 1);
    s = apply(s, { t: 'shot', cell: p1Miss(hits) }, 1);
    s = apply(s, { t: 'answer', r: 'miss' }, 0);
  }
  return apply(s, { t: 'reveal', layout: winnerReveal.layout, salt: winnerReveal.salt }, 0);
}

describe('geometry & placement', () => {
  it('the board is 10×10 with the classic five-ship fleet (17 cells)', () => {
    expect(SIZE).toBe(10);
    expect([...FLEET]).toEqual([5, 4, 3, 3, 2]);
    expect(FLEET_CELLS).toBe(17);
    expect(SHIP_CLASSES.map((c) => c.size)).toEqual([...FLEET]);
    expect(SHIP_CLASSES.map((c) => c.key)).toEqual(['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer']);
  });

  it('random layouts are always legal (bounds, no overlap, full fleet), across many rolls', () => {
    let x = 42;
    const rand = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 200; i++) {
      const l = randomLayout(rand);
      expect(layoutLegal(l)).toBe(true);
      expect(l.flatMap(cellsOf)).toHaveLength(FLEET_CELLS);
    }
  });

  it('layoutLegal rejects out-of-bounds, overlap, wrong class order, and a foreign fleet', () => {
    expect(layoutLegal([{ r: 0, c: 6, len: 5, dir: 'h' }, ...L0.slice(1)])).toBe(false); // off the edge
    expect(
      layoutLegal([
        { r: 0, c: 0, len: 5, dir: 'h' },
        { r: 0, c: 0, len: 4, dir: 'v' }, // overlaps at (0,0)
        ...L0.slice(2),
      ]),
    ).toBe(false);
    expect(layoutLegal(L0.slice(0, 4) as Layout)).toBe(false); // missing the destroyer
    // Canonical order is part of legality: swapping the submarine and destroyer
    // lengths produces [5,4,3,2,3] — not the fleet.
    expect(
      layoutLegal([L0[0], L0[1], L0[2], { r: 8, c: 0, len: 2, dir: 'h' }, { r: 6, c: 0, len: 3, dir: 'h' }]),
    ).toBe(false);
    // A battleship-shaped (8×8, four-ship) layout is a foreign fleet here.
    expect(
      layoutLegal([
        { r: 0, c: 0, len: 4, dir: 'h' },
        { r: 2, c: 0, len: 3, dir: 'h' },
        { r: 4, c: 0, len: 3, dir: 'h' },
        { r: 6, c: 0, len: 2, dir: 'h' },
      ]),
    ).toBe(false);
  });

  it('the commitment binds the 10×10 five-ship geometry header', () => {
    expect(serializeLayout(L0, S0).startsWith('10x10|5,4,3,3,2|')).toBe(true);
    expect(commitment(L0, S0)).not.toBe(commitment(L0, S1)); // salt-sensitive
    expect(commitment(L0, S0)).not.toBe(commitment(L1, S0)); // layout-sensitive
    expect(commitment(L0, S0)).toBe(commitment(L0, S0)); // deterministic
    expect(randomSalt()).not.toBe(randomSalt());
  });

  it('fleetView expands a layout into named UI ship recs', () => {
    const v = fleetView(L0);
    expect(v).toHaveLength(5);
    expect(v[0]).toMatchObject({ key: 'carrier', name: 'Carrier', size: 5, orient: 'h' });
    expect(v[0].cells).toEqual([0, 1, 2, 3, 4]);
    expect(v[4]).toMatchObject({ key: 'destroyer', name: 'Destroyer', size: 2 });
    expect(v[4].cells).toEqual([80, 81]);
  });
});

describe('phase machine', () => {
  it('commits are SEQUENTIAL: P0 first, once each, nothing else legal while placing', () => {
    let s = createInitialState();
    expect(turn(s)).toBe(0);
    expect(mayMove(s, 0)).toBe(true);
    expect(mayMove(s, 1)).toBe(false); // P1's slot is not open — the UI stages instead
    expect(applyMove(s, { t: 'commit', h: commitment(L1, S1) }, 1)).toBeNull(); // early commit illegal
    expect(applyMove(s, { t: 'shot', cell: 0 }, 0)).toBeNull();
    s = apply(s, { t: 'commit', h: commitment(L0, S0) }, 0);
    expect(applyMove(s, { t: 'commit', h: 'again' }, 0)).toBeNull(); // no double commit
    expect(mayMove(s, 1)).toBe(true); // now P1's slot is open
    s = apply(s, { t: 'commit', h: commitment(L1, S1) }, 1);
    expect(turn(s)).toBe(0); // battle: P0 fires first
  });

  it('battle alternates shot → answer, turn ALWAYS passing (no bonus shot on hit)', () => {
    let s = committed();
    expect(turn(s)).toBe(0);
    expect(applyMove(s, { t: 'shot', cell: 5 }, 1)).toBeNull(); // not P1's turn
    s = apply(s, { t: 'shot', cell: 0 }, 0); // a genuine HIT on L1? cell 0 is water for L1
    s = apply(s, { t: 'answer', r: 'miss' }, 1);
    expect(turn(s)).toBe(1);
    s = apply(s, { t: 'shot', cell: 9 }, 1); // P1 hits L0? cell 9 is water for L0
    s = apply(s, { t: 'answer', r: 'miss' }, 0);
    expect(turn(s)).toBe(0);
    // A HIT still passes the turn.
    s = apply(s, { t: 'shot', cell: 9 }, 0); // L1 carrier bow — a hit
    s = apply(s, { t: 'answer', r: 'hit' }, 1);
    expect(turn(s)).toBe(1); // strict alternation
  });

  it('an attacker cannot shoot the same cell twice; the OTHER attacker may', () => {
    let s = committed();
    s = apply(s, { t: 'shot', cell: 50 }, 0);
    s = apply(s, { t: 'answer', r: 'miss' }, 1);
    s = apply(s, { t: 'shot', cell: 50 }, 1);
    s = apply(s, { t: 'answer', r: 'miss' }, 0);
    expect(applyMove(s, { t: 'shot', cell: 50 }, 0)).toBeNull();
  });

  it('the final (17th-hit) answer must carry the reveal; then ONLY the winner reveal is legal', () => {
    let s = committed();
    const targets = L1.flatMap(cellsOf);
    for (let i = 0; i < FLEET_CELLS - 1; i++) {
      s = apply(s, { t: 'shot', cell: targets[i] }, 0);
      s = apply(s, { t: 'answer', r: judgeShot(L1, targets[i], targets.slice(0, i + 1)) }, 1);
      s = apply(s, { t: 'shot', cell: p1Miss(i) }, 1);
      s = apply(s, { t: 'answer', r: 'miss' }, 0);
    }
    s = apply(s, { t: 'shot', cell: targets[FLEET_CELLS - 1] }, 0);
    expect(applyMove(s, { t: 'answer', r: 'sunk' }, 1)).toBeNull(); // bare final answer: illegal
    // A reveal riding a NON-final answer is illegal too — proven by the game so
    // far never accepting one (applyMove would have rejected it above); assert
    // the final acceptance path:
    s = apply(s, { t: 'answer', r: 'sunk', reveal: { layout: L1, salt: S1 } }, 1);
    expect(applyMove(s, { t: 'shot', cell: 40 }, 1)).toBeNull();
    expect(applyMove(s, { t: 'reveal', layout: L0, salt: S0 }, 1)).toBeNull(); // loser already revealed
    expect(status(s)).toEqual({ state: 'ongoing', turn: 0 });
  });

  it('a reveal may not ride a non-final answer', () => {
    let s = committed();
    s = apply(s, { t: 'shot', cell: 9 }, 0);
    expect(applyMove(s, { t: 'answer', r: 'hit', reveal: { layout: L1, salt: S1 } }, 1)).toBeNull();
  });
});

describe('verification (the honesty machinery)', () => {
  it('an honest game ends won by the final attacker', () => {
    expect(status(honestGame())).toEqual({ state: 'won', winner: 0 });
  });

  it('the WINNER revealing with a wrong salt flips the win to the loser', () => {
    const s = riggedGame({ layout: L1, salt: S1 }, { layout: L0, salt: S1 });
    expect(status(s)).toEqual({ state: 'won', winner: 1 });
  });

  it('the LOSER revealing a different layout (commitment mismatch) cannot profit — verdict stands', () => {
    const s = riggedGame({ layout: L1, salt: S0 }, { layout: L0, salt: S0 });
    expect(status(s)).toEqual({ state: 'won', winner: 0 });
  });

  it('a battleship-shaped reveal can never verify (geometry binding)', () => {
    const foreign: Layout = [
      { r: 0, c: 0, len: 4, dir: 'h' },
      { r: 2, c: 0, len: 3, dir: 'h' },
      { r: 4, c: 0, len: 3, dir: 'h' },
      { r: 6, c: 0, len: 2, dir: 'h' },
    ] as unknown as Layout;
    const s = riggedGame({ layout: foreign, salt: S1 }, { layout: L0, salt: S0 });
    expect(status(s)).toEqual({ state: 'won', winner: 0 }); // loser proven a cheater; verdict stands
  });

  it('a lied answer (hit declared on open water) is caught at reveal time', () => {
    let s = committed();
    const targets = L1.flatMap(cellsOf);
    // P0 shoots genuinely empty water that P1 falsely answers 'hit'.
    const water = [...Array(SIZE * SIZE).keys()].find((c) => !targets.includes(c))!;
    s = apply(s, { t: 'shot', cell: water }, 0);
    s = apply(s, { t: 'answer', r: 'hit' }, 1); // the lie
    s = apply(s, { t: 'shot', cell: p1Miss(0) }, 1);
    s = apply(s, { t: 'answer', r: 'miss' }, 0);
    let declared = 1;
    for (const cell of targets) {
      s = apply(s, { t: 'shot', cell }, 0);
      declared += 1;
      if (declared === FLEET_CELLS) {
        s = apply(s, { t: 'answer', r: 'sunk', reveal: { layout: L1, salt: S1 } }, 1);
        break;
      }
      s = apply(s, { t: 'answer', r: judgeShot(L1, cell, targets.slice(0, targets.indexOf(cell) + 1)) }, 1);
      s = apply(s, { t: 'shot', cell: p1Miss(declared) }, 1);
      s = apply(s, { t: 'answer', r: 'miss' }, 0);
    }
    s = apply(s, { t: 'reveal', layout: L0, salt: S0 }, 0);
    // P1's answers contradict P1's true layout → P1 is the proven cheater.
    expect(status(s)).toEqual({ state: 'won', winner: 0 });
  });

  it('both reveals invalid → a disgraceful draw', () => {
    const s = riggedGame({ layout: L1, salt: S0 }, { layout: L0, salt: S1 }); // both bad salts
    expect(status(s)).toEqual({ state: 'draw' });
  });
});

describe('engine convergence (applySignal, spec 1038 anti-stall)', () => {
  // A minimal module wrapper — the same functions index.ts exposes, without
  // dragging ionicons into a logic test.
  const mod: GameModule = {
    id: 'armada',
    displayName: 'Armada',
    icon: '',
    players: 2,
    createInitialState,
    applyMove: (s, m, p) => applyMove(s as ArmadaState, m as ArmadaMove, p),
    turn: (s) => turn(s as ArmadaState),
    status: (s) => status(s as ArmadaState),
    mayMove: (s, p) => mayMove(s as ArmadaState, p),
    themes: [{ id: 'classic', name: 'Armada' }],
  };
  const fresh = (): GameSession => ({ gameType: 'armada', moves: [] });

  it('a redelivered (duplicate) signal drops and both replicas stay identical', () => {
    const sig = { seq: 1, action: 'move' as const, move: { t: 'commit', h: commitment(L0, S0) }, at: 1 };
    const a1 = applySignal(mod, fresh(), sig, 0);
    expect(a1.outcome).toBe('applied');
    const a2 = applySignal(mod, a1.session, sig, 0); // relay redelivery
    expect(a2.outcome).toBe('dropped');
    expect(JSON.stringify(a2.session)).toBe(JSON.stringify(a1.session));
  });

  it('placement is race-free by construction: the un-slotted player may not move (stages instead)', () => {
    const session = fresh();
    expect(localMoveAllowed(mod, session, 0)).toBe(true);
    expect(localMoveAllowed(mod, session, 1)).toBe(false); // an honest P1 device never emits early
    // And if a tampering P1 emits anyway, the fork is LABELED, never silent:
    const bad = applySignal(mod, session, { seq: 1, action: 'move', move: { t: 'commit', h: 'x' }, at: 1 }, 1);
    expect(bad.outcome).toBe('out-of-sync');
    expect(bad.session.outOfSync).toBe(true);
  });

  it('interleaved delivery converges: the same accepted log yields the same state on both replicas', () => {
    // Build the signal list from an honest opening (both commits + one round).
    const sigs = [
      { seq: 1, action: 'move' as const, move: { t: 'commit', h: commitment(L0, S0) }, at: 1, sender: 0 as const },
      { seq: 2, action: 'move' as const, move: { t: 'commit', h: commitment(L1, S1) }, at: 2, sender: 1 as const },
      { seq: 3, action: 'move' as const, move: { t: 'shot', cell: 9 }, at: 3, sender: 0 as const },
      { seq: 4, action: 'move' as const, move: { t: 'answer', r: 'hit' }, at: 4, sender: 1 as const },
    ];
    // Replica A: in order. Replica B: with duplicated redeliveries sprinkled in.
    let a = fresh();
    for (const s of sigs) a = applySignal(mod, a, s, s.sender).session;
    let b = fresh();
    for (const s of sigs) {
      b = applySignal(mod, b, s, s.sender).session;
      b = applySignal(mod, b, s, s.sender).session; // immediate redelivery
    }
    expect(JSON.stringify(a.moves)).toBe(JSON.stringify(b.moves));
    expect(a.outOfSync).toBeUndefined();
    expect(b.outOfSync).toBeUndefined();
  });
});
