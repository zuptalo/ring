import { describe, it, expect } from 'vitest';
import {
  challengePhase,
  resolveOpponent,
  applyAccept,
  applyCancel,
  playerIndexOf,
  lockOpponent,
  buildWallSession,
  type WallGameRow,
} from './challenge';
import tictactoe from './tictactoe';
import type { GameSession } from './types';

// Spec 0009 T001/T002 — the pure challenge engine. The whole feature rests on
// two properties: every device resolves the SAME opponent from the same data
// (never arrival order), and third parties can never poison a board (drop,
// never out-of-sync). Committed failing first (constitution III).

const open = (over: Partial<GameSession> = {}): GameSession => ({
  gameType: 'tictactoe',
  players: ['alice'],
  challenge: { accepts: [] },
  moves: [],
  ...over,
});

describe('accept race (spec 0009 FR-002)', () => {
  it('the earliest accept wins the seat; userId breaks timestamp ties', () => {
    let s = open();
    s = applyAccept(s, 'carol', 2000).session;
    s = applyAccept(s, 'bob', 1000).session;
    expect(resolveOpponent(s)).toBe('bob');
    // exact tie → lexicographically smaller userId, so every device agrees
    let t = open();
    t = applyAccept(t, 'carol', 1000).session;
    t = applyAccept(t, 'bob', 1000).session;
    expect(resolveOpponent(t)).toBe('bob');
  });

  it('is permutation-invariant: any apply order yields the same seat', () => {
    const accepts: Array<[string, number]> = [['dave', 3000], ['bob', 1500], ['carol', 1200]];
    const orders = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    const seats = orders.map((order) => {
      let s = open();
      for (const i of order) s = applyAccept(s, accepts[i][0], accepts[i][1]).session;
      return resolveOpponent(s);
    });
    expect(new Set(seats).size).toBe(1);
    expect(seats[0]).toBe('carol');
  });

  it('dedupes accepts by user and drops the creator accepting their own challenge', () => {
    let s = open();
    expect(applyAccept(s, 'alice', 500).outcome).toBe('dropped'); // creator
    s = applyAccept(s, 'bob', 1000).session;
    const again = applyAccept(s, 'bob', 900); // duplicate user, even "earlier"
    expect(again.outcome).toBe('dropped');
    expect(again.session.challenge?.accepts).toHaveLength(1);
  });

  it('the seq-1 lock beats a later-arriving earlier accept', () => {
    let s = open();
    s = applyAccept(s, 'carol', 2000).session;
    s = lockOpponent(s, 'carol'); // challenger played seq 1 stamping carol
    expect(s.players).toEqual(['alice', 'carol']);
    // bob's earlier accept was still in transit — it changes nothing now
    const late = applyAccept(s, 'bob', 1000);
    expect(late.outcome).toBe('dropped');
    expect(resolveOpponent(late.session)).toBe('carol');
  });

  it('challengePhase walks open → accepted → and cancel wins only before moves', () => {
    let s = open();
    expect(challengePhase(s)).toBe('open');
    s = applyAccept(s, 'bob', 1000).session;
    expect(challengePhase(s)).toBe('accepted');
    // cancel before any move → withdrawn, accepts never override
    const cancelled = applyCancel(s, 'alice', 3000).session;
    expect(challengePhase(cancelled)).toBe('cancelled');
    expect(applyAccept(cancelled, 'dave', 100).outcome).toBe('dropped');
    // a cancel AFTER play started is meaningless (the challenger moved) → dropped
    const playing = lockOpponent(s, 'bob');
    const played: GameSession = { ...playing, moves: [{ seq: 1, player: 0, move: { cell: 4 }, at: 5000 }] };
    expect(applyCancel(played, 'alice', 6000).outcome).toBe('dropped');
    expect(challengePhase(played)).toBe('accepted');
  });

  it('only the creator can cancel', () => {
    const s = open();
    expect(applyCancel(s, 'bob', 1000).outcome).toBe('dropped');
  });

  it('playerIndexOf maps seats and returns null for everyone else', () => {
    let s = open();
    s = applyAccept(s, 'bob', 1000).session;
    expect(playerIndexOf(s, 'alice')).toBe(0);
    expect(playerIndexOf(s, 'bob')).toBe(1); // pre-lock derived seat
    expect(playerIndexOf(s, 'carol')).toBeNull();
    const locked = lockOpponent(s, 'bob');
    expect(playerIndexOf(locked, 'bob')).toBe(1);
    expect(playerIndexOf(locked, 'carol')).toBeNull();
  });
});

describe('buildWallSession (spec 0009 FR-008, replay from the pulled set)', () => {
  const row = (id: string, actor: string, payload: WallGameRow['payload']): WallGameRow => ({ id, actor, payload });
  const game = { gameType: 'tictactoe' };

  it('derives the identical session from any permutation of the same rows', () => {
    const rows: WallGameRow[] = [
      row('e1', 'bob', { t: 'accept', at: 1000 }),
      row('e2', 'carol', { t: 'accept', at: 2000 }),
      row('e3', 'alice', { t: 'move', seq: 1, action: 'move', move: { cell: 4 }, at: 3000, opponent: 'bob' }),
      row('e4', 'bob', { t: 'move', seq: 2, action: 'move', move: { cell: 0 }, at: 4000 }),
    ];
    const a = buildWallSession(tictactoe, 'alice', game, rows);
    const b = buildWallSession(tictactoe, 'alice', game, [...rows].reverse());
    expect(a).toEqual(b);
    expect(a.players).toEqual(['alice', 'bob']);
    expect(a.moves).toHaveLength(2);
    expect(a.outOfSync).toBeUndefined();
  });

  it('dedupes duplicate engagement rows by id', () => {
    const r = row('e1', 'bob', { t: 'accept', at: 1000 });
    const s = buildWallSession(tictactoe, 'alice', game, [r, r, r]);
    expect(s.challenge?.accepts).toHaveLength(1);
  });

  it('drops rows from non-players instead of poisoning the board', () => {
    const rows: WallGameRow[] = [
      row('e1', 'bob', { t: 'accept', at: 1000 }),
      row('e2', 'alice', { t: 'move', seq: 1, action: 'move', move: { cell: 4 }, at: 2000, opponent: 'bob' }),
      row('e3', 'mallory', { t: 'move', seq: 2, action: 'move', move: { cell: 0 }, at: 2500 }),
    ];
    const s = buildWallSession(tictactoe, 'alice', game, rows);
    expect(s.moves).toHaveLength(1); // mallory's row ignored
    expect(s.outOfSync).toBeUndefined();
  });

  it('a genuine fork in the pulled set lands on the out-of-sync terminal', () => {
    const rows: WallGameRow[] = [
      row('e1', 'bob', { t: 'accept', at: 1000 }),
      row('e2', 'alice', { t: 'move', seq: 1, action: 'move', move: { cell: 4 }, at: 2000, opponent: 'bob' }),
      row('e3', 'bob', { t: 'move', seq: 2, action: 'move', move: { cell: 0 }, at: 3000 }),
      row('e4', 'bob', { t: 'move', seq: 2, action: 'move', move: { cell: 1 }, at: 3500 }), // conflicting slot
    ];
    const s = buildWallSession(tictactoe, 'alice', game, rows);
    expect(s.outOfSync).toBe(true);
  });

  it('an unaccepted wall challenge is simply open', () => {
    const s = buildWallSession(tictactoe, 'alice', game, []);
    expect(challengePhase(s)).toBe('open');
    expect(s.players).toEqual(['alice']);
  });
});

describe('buildWallSession stats base (spec 0009 wall stats)', () => {
  it('startedAt is the seat-winning accept, so reply stats measure from the match', () => {
    const rows: WallGameRow[] = [
      { id: 'e1', actor: 'carol', payload: { t: 'accept', at: 2000 } },
      { id: 'e2', actor: 'bob', payload: { t: 'accept', at: 1000 } },
    ];
    const s = buildWallSession(tictactoe, 'alice', { gameType: 'tictactoe' }, rows);
    expect(s.startedAt).toBe(1000); // bob won the seat at 1000
    const open = buildWallSession(tictactoe, 'alice', { gameType: 'tictactoe' }, []);
    expect(open.startedAt).toBeUndefined();
  });
});
