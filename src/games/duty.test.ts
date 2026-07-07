// Spec 1038 T003 — the duty resolver as tests, red-first. This is the
// regression suite for the both-players-waiting stall: an owed move must be
// derivable from (state, secret, staged) alone, with no board mounted, and
// re-derivation after the move already landed must return null (idempotent
// re-emit — the engine's dedup makes an accidental double-send harmless, but
// the resolver itself must go quiet once the log carries the answer).
import { beforeAll, describe, it, expect } from 'vitest';
import { ready } from '@/services/crypto/primitives';
import {
  applyMove,
  cellsOf,
  commitment,
  createInitialState,
  judgeShot,
  FLEET_CELLS,
  type ArmadaMove,
  type ArmadaState,
  type Layout,
} from './armada/logic';
import { owedMove } from './duty';

beforeAll(async () => {
  await ready();
});

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
const SEC0 = { layout: L0, salt: S0 };
const SEC1 = { layout: L1, salt: S1 };

function apply(s: ArmadaState, move: ArmadaMove, player: 0 | 1): ArmadaState {
  const next = applyMove(s, move, player);
  expect(next).not.toBeNull();
  return next!;
}

function committed(): ArmadaState {
  let s = createInitialState();
  s = apply(s, { t: 'commit', h: commitment(L0, S0) }, 0);
  s = apply(s, { t: 'commit', h: commitment(L1, S1) }, 1);
  return s;
}

describe('staged commits (sequential wire, parallel authoring)', () => {
  it('P1 with a staged commit owes nothing until P0 commits, then owes the commit', () => {
    let s = createInitialState();
    const h1 = commitment(L1, S1);
    expect(owedMove(s, 1, SEC1, { h: h1 })).toBeNull(); // slot not open yet
    s = apply(s, { t: 'commit', h: commitment(L0, S0) }, 0);
    expect(owedMove(s, 1, SEC1, { h: h1 })).toEqual({ t: 'commit', h: h1 });
  });

  it('a staged commit goes quiet once it is in the log', () => {
    const s = committed();
    expect(owedMove(s, 1, SEC1, { h: commitment(L1, S1) })).toBeNull();
  });

  it('P0 with a staged commit owes it immediately on a fresh board', () => {
    const s = createInitialState();
    const h0 = commitment(L0, S0);
    expect(owedMove(s, 0, SEC0, { h: h0 })).toEqual({ t: 'commit', h: h0 });
  });
});

describe('owed answers (the stall regression)', () => {
  it('a pending enemy shot is owed the truthful answer — with no board mounted', () => {
    let s = committed();
    s = apply(s, { t: 'shot', cell: 9 }, 0); // L1 carrier bow
    expect(owedMove(s, 1, SEC1)).toEqual({ t: 'answer', r: 'hit' });
  });

  it('a miss is answered as a miss', () => {
    let s = committed();
    s = apply(s, { t: 'shot', cell: 0 }, 0); // water for L1
    expect(owedMove(s, 1, SEC1)).toEqual({ t: 'answer', r: 'miss' });
  });

  it('re-derivation after the answer landed returns null (idempotent re-emit)', () => {
    let s = committed();
    s = apply(s, { t: 'shot', cell: 9 }, 0);
    s = apply(s, { t: 'answer', r: 'hit' }, 1);
    expect(owedMove(s, 1, SEC1)).toBeNull();
  });

  it('the attacker owes nothing while their own shot is pending', () => {
    let s = committed();
    s = apply(s, { t: 'shot', cell: 9 }, 0);
    expect(owedMove(s, 0, SEC0)).toBeNull();
  });

  it('the FINAL answer carries the loser reveal', () => {
    let s = committed();
    const targets = L1.flatMap(cellsOf);
    let hits = 0;
    for (const cell of targets.slice(0, FLEET_CELLS - 1)) {
      s = apply(s, { t: 'shot', cell }, 0);
      hits += 1;
      s = apply(s, { t: 'answer', r: judgeShot(L1, cell, targets.slice(0, hits)) }, 1);
      s = apply(s, { t: 'shot', cell: 99 - hits }, 1);
      s = apply(s, { t: 'answer', r: 'miss' }, 0);
    }
    s = apply(s, { t: 'shot', cell: targets[FLEET_CELLS - 1] }, 0);
    expect(owedMove(s, 1, SEC1)).toEqual({
      t: 'answer',
      r: 'sunk',
      reveal: { layout: L1, salt: S1 },
    });
  });
});

describe('owed reveals and silence', () => {
  function finalAnswered(): ArmadaState {
    let s = committed();
    const targets = L1.flatMap(cellsOf);
    let hits = 0;
    for (const cell of targets) {
      s = apply(s, { t: 'shot', cell }, 0);
      hits += 1;
      if (hits === FLEET_CELLS) {
        s = apply(s, { t: 'answer', r: 'sunk', reveal: { layout: L1, salt: S1 } }, 1);
        break;
      }
      s = apply(s, { t: 'answer', r: judgeShot(L1, cell, targets.slice(0, hits)) }, 1);
      s = apply(s, { t: 'shot', cell: 99 - hits }, 1);
      s = apply(s, { t: 'answer', r: 'miss' }, 0);
    }
    return s;
  }

  it('the presumptive winner owes the closing reveal', () => {
    const s = finalAnswered();
    expect(owedMove(s, 0, SEC0)).toEqual({ t: 'reveal', layout: L0, salt: S0 });
    expect(owedMove(s, 1, SEC1)).toBeNull(); // the loser already revealed
  });

  it('goes quiet after the winner reveal (terminal state)', () => {
    let s = finalAnswered();
    s = apply(s, { t: 'reveal', layout: L0, salt: S0 }, 0);
    expect(owedMove(s, 0, SEC0)).toBeNull();
    expect(owedMove(s, 1, SEC1)).toBeNull();
  });

  it('a device WITHOUT the secret owes nothing, ever (second own-device)', () => {
    let s = committed();
    s = apply(s, { t: 'shot', cell: 9 }, 0);
    expect(owedMove(s, 1, null)).toBeNull();
    expect(owedMove(s, 1, null, { h: 'x' })).toBeNull();
  });

  it('owes nothing when nothing is pending mid-battle', () => {
    let s = committed();
    s = apply(s, { t: 'shot', cell: 0 }, 0);
    s = apply(s, { t: 'answer', r: 'miss' }, 1);
    expect(owedMove(s, 0, SEC0)).toBeNull();
    expect(owedMove(s, 1, SEC1)).toBeNull();
  });
});
