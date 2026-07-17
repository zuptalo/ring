import { describe, it, expect } from 'vitest';
import { computeGameStats } from './stats';
import tictactoe from './tictactoe';
import type { GameSession } from './types';

// Spec 0008 T033 (FR-024) — the game's story in numbers, derived purely from the
// session's own timestamps: no extra tracking, no new wire data. Reply time for a
// move = its `at` minus the previous move's `at` (the first move measures from
// `startedAt`); a missing base simply excludes that move from the averages.

const mv = (seq: number, player: 0 | 1, cell: number, at: number) => ({ seq, player, move: { cell }, at });

describe('computeGameStats (spec 0008 FR-024)', () => {
  it('tells the story of a finished game: duration, moves, replies per player', () => {
    // p0 wins the top row: cells 0,1,2 vs p1 on 3,4.
    const s: GameSession = {
      gameType: 'tictactoe',
      startedAt: 1_000,
      moves: [
        mv(1, 0, 0, 5_000), // p0 reply: 4s (from startedAt)
        mv(2, 1, 3, 15_000), // p1 reply: 10s
        mv(3, 0, 1, 20_000), // p0 reply: 5s
        mv(4, 1, 4, 30_000), // p1 reply: 10s
        mv(5, 0, 2, 40_000), // p0 reply: 10s — the winning move ends the game
      ],
    };
    const st = computeGameStats(tictactoe, s);
    expect(st.startedAt).toBe(1_000);
    expect(st.endedAt).toBe(40_000);
    expect(st.durationMs).toBe(39_000);
    expect(st.moveCount).toBe(5);
    expect(st.players[0].moves).toBe(3);
    expect(st.players[0].avgReplyMs).toBeCloseTo((4_000 + 5_000 + 10_000) / 3, 0);
    expect(st.players[0].fastestReplyMs).toBe(4_000);
    expect(st.players[1].moves).toBe(2);
    expect(st.players[1].avgReplyMs).toBe(10_000);
    expect(st.players[1].fastestReplyMs).toBe(10_000);
  });

  it('a resigned game ends at the resignation', () => {
    const s: GameSession = {
      gameType: 'tictactoe',
      startedAt: 1_000,
      moves: [mv(1, 0, 4, 5_000)],
      resignedBy: 1,
      resignedAt: 9_000,
    };
    const st = computeGameStats(tictactoe, s);
    expect(st.endedAt).toBe(9_000);
    expect(st.durationMs).toBe(8_000);
  });

  it('an ongoing game has no end or duration yet', () => {
    const s: GameSession = { gameType: 'tictactoe', startedAt: 1_000, moves: [mv(1, 0, 4, 5_000)] };
    const st = computeGameStats(tictactoe, s);
    expect(st.endedAt).toBeNull();
    expect(st.durationMs).toBeNull();
    expect(st.moveCount).toBe(1);
  });

  it('degrades gracefully on a legacy session without startedAt', () => {
    const s: GameSession = {
      gameType: 'tictactoe',
      moves: [mv(1, 0, 0, 5_000), mv(2, 1, 3, 8_000), mv(3, 0, 1, 20_000)],
    };
    const st = computeGameStats(tictactoe, s);
    expect(st.startedAt).toBeNull();
    // p0's FIRST move has no base (no startedAt) → excluded; its second reply counts.
    expect(st.players[0].avgReplyMs).toBe(12_000);
    expect(st.players[1].avgReplyMs).toBe(3_000);
  });

  it('never divides by zero: a fresh game has empty player stats', () => {
    const s: GameSession = { gameType: 'tictactoe', startedAt: 1_000, moves: [] };
    const st = computeGameStats(tictactoe, s);
    expect(st.players[0].avgReplyMs).toBeNull();
    expect(st.players[0].fastestReplyMs).toBeNull();
  });
});
