import { describe, it, expect } from 'vitest';
import { applySignal, deriveStatus, replayState, localMoveAllowed } from './session';
import tictactoe from './tictactoe';
import type { GameSession } from './types';
import type { TicTacToeState } from './tictactoe/logic';

// Spec 0008 T003 — session-engine unit tests (constitution III: written failing
// first). The engine implements data-model.md validation rules 2–7 in order
// (rule 1, target existence, lives in queries.ts). Both devices must classify
// the same inbound signal identically, so every outcome here is deterministic.

const fresh = (): GameSession => ({ gameType: 'tictactoe', moves: [] });

function sig(seq: number, cell: number, at = 1000) {
  return { seq, action: 'move' as const, move: { cell }, at };
}

/** Apply a list of [cell, player] pairs as accepted signals; expect all applied. */
function build(pairs: Array<[number, 0 | 1]>): GameSession {
  let s = fresh();
  pairs.forEach(([cell, player], i) => {
    const r = applySignal(tictactoe, s, sig(i + 1, cell), player);
    if (r.outcome !== 'applied') throw new Error(`setup: move ${i} → ${r.outcome}`);
    s = r.session;
  });
  return s;
}

describe('session engine (spec 0008)', () => {
  it('replays a valid log into the expected derived state', () => {
    const s = build([[4, 0], [0, 1], [8, 0]]);
    const state = replayState(tictactoe, s) as TicTacToeState;
    expect(state.cells[4]).toBe(0);
    expect(state.cells[0]).toBe(1);
    expect(state.cells[8]).toBe(0);
    expect(deriveStatus(tictactoe, s)).toEqual({ state: 'ongoing', turn: 1 });
  });

  it('applies a valid move exactly once and keeps the log contiguous', () => {
    const s0 = fresh();
    const r = applySignal(tictactoe, s0, sig(1, 4), 0);
    expect(r.outcome).toBe('applied');
    expect(r.session.moves).toEqual([{ seq: 1, player: 0, move: { cell: 4 }, at: 1000 }]);
    expect(s0.moves).toHaveLength(0); // pure: input session untouched
  });

  it('drops a duplicate seq with identical content (relay redelivery, FR-006)', () => {
    const s = build([[4, 0]]);
    const r = applySignal(tictactoe, s, sig(1, 4), 0);
    expect(r.outcome).toBe('dropped');
    expect(r.session.moves).toHaveLength(1);
    expect(r.session.outOfSync).toBeUndefined();
  });

  it('marks out-of-sync on a conflicting seq (same seq, different content)', () => {
    const s = build([[4, 0]]);
    const r = applySignal(tictactoe, s, sig(1, 5), 0);
    expect(r.outcome).toBe('out-of-sync');
    expect(r.session.outOfSync).toBe(true);
    expect(r.session.moves).toHaveLength(1); // never partially applied
  });

  it('marks out-of-sync on a seq gap (contiguity broken)', () => {
    const s = build([[4, 0]]);
    const r = applySignal(tictactoe, s, sig(3, 5), 1);
    expect(r.outcome).toBe('out-of-sync');
    expect(r.session.outOfSync).toBe(true);
  });

  it('marks out-of-sync on an out-of-turn sender (FR-003)', () => {
    const s = build([[4, 0]]);
    // seq 2 is player 1's turn; player 0 tries to move again
    const r = applySignal(tictactoe, s, sig(2, 5), 0);
    expect(r.outcome).toBe('out-of-sync');
    expect(r.session.outOfSync).toBe(true);
  });

  it('marks out-of-sync on an illegal move (occupied cell)', () => {
    const s = build([[4, 0]]);
    const r = applySignal(tictactoe, s, sig(2, 4), 1);
    expect(r.outcome).toBe('out-of-sync');
    expect(r.session.outOfSync).toBe(true);
  });

  it('drops any signal after a terminal state (late move after win is not a conflict)', () => {
    // player 0 wins the top row
    const s = build([[0, 0], [3, 1], [1, 0], [4, 1], [2, 0]]);
    expect(deriveStatus(tictactoe, s)).toEqual({ state: 'won', winner: 0 });
    const r = applySignal(tictactoe, s, sig(6, 5), 1);
    expect(r.outcome).toBe('dropped');
    expect(r.session).toEqual(s);
  });

  it('drops signals once out-of-sync (terminal too)', () => {
    const s = build([[4, 0]]);
    const broken = applySignal(tictactoe, s, sig(1, 5), 0).session;
    expect(broken.outOfSync).toBe(true);
    const r = applySignal(tictactoe, broken, sig(2, 0), 1);
    expect(r.outcome).toBe('dropped');
  });

  it('accepts a resign from either player while ongoing (FR-008)', () => {
    const s = build([[4, 0]]);
    const r = applySignal(tictactoe, s, { seq: 2, action: 'resign', at: 2000 }, 1);
    expect(r.outcome).toBe('applied');
    expect(r.session.resignedBy).toBe(1);
    expect(deriveStatus(tictactoe, r.session)).toEqual({ state: 'resigned', winner: 0 });
  });

  it('resign dedupes and conflicts by seq like a move', () => {
    const s = build([[4, 0]]);
    const resigned = applySignal(tictactoe, s, { seq: 2, action: 'resign', at: 2000 }, 1).session;
    // duplicate redelivery of the same resign → dropped (already terminal)
    const r = applySignal(tictactoe, resigned, { seq: 2, action: 'resign', at: 2000 }, 1);
    expect(r.outcome).toBe('dropped');
  });

  it('ignores unknown future actions without corrupting the session (contract §3)', () => {
    const s = build([[4, 0]]);
    const r = applySignal(
      tictactoe,
      s,
      { seq: 2, action: 'draw-offer' as never, at: 2000 },
      1,
    );
    expect(r.outcome).toBe('dropped');
    expect(r.session.outOfSync).toBeUndefined();
    expect(r.session.moves).toHaveLength(1);
  });

  it('derives win/draw/turn statuses for the UI', () => {
    expect(deriveStatus(tictactoe, fresh())).toEqual({ state: 'ongoing', turn: 0 });
    const draw = build([[0, 0], [1, 1], [2, 0], [4, 1], [3, 0], [5, 1], [7, 0], [6, 1], [8, 0]]);
    expect(deriveStatus(tictactoe, draw)).toEqual({ state: 'draw' });
    const broken = { ...fresh(), outOfSync: true as const };
    expect(deriveStatus(tictactoe, broken)).toEqual({ state: 'out-of-sync' });
  });

  it('localMoveAllowed gates the honest sender (your turn + ongoing only, FR-003)', () => {
    const s = build([[4, 0]]);
    expect(localMoveAllowed(tictactoe, s, 1)).toBe(true);
    expect(localMoveAllowed(tictactoe, s, 0)).toBe(false);
    const broken = { ...s, outOfSync: true as const };
    expect(localMoveAllowed(tictactoe, broken, 1)).toBe(false);
  });

  // Spec 0009 regression fence: the engine is seat-AGNOSTIC. Sessions carrying
  // the new explicit-players/challenge fields replay and classify exactly like
  // bare 1:1 sessions — seats are the CALLER's mapping concern.
  it('ignores explicit-players/challenge fields entirely (1:1 behavior unchanged)', () => {
    const bare = build([[4, 0], [0, 1]]);
    const dressed: GameSession = {
      ...build([[4, 0], [0, 1]]),
      players: ['alice', 'bob'],
      challenge: { accepts: [{ userId: 'bob', at: 1 }] },
    };
    expect(replayState(tictactoe, dressed)).toEqual(replayState(tictactoe, bare));
    expect(deriveStatus(tictactoe, dressed)).toEqual(deriveStatus(tictactoe, bare));
    const r = applySignal(tictactoe, dressed, sig(3, 8), 0);
    expect(r.outcome).toBe('applied');
    expect(r.session.players).toEqual(['alice', 'bob']); // fields carried through
  });

  it('treats an unknown gameType defensively: deriveStatus never throws', () => {
    const weird: GameSession = { gameType: 'from-the-future', moves: [] };
    expect(() => deriveStatus(null, weird)).not.toThrow();
    expect(deriveStatus(null, weird)).toEqual({ state: 'ongoing', turn: 0 });
  });
});
