// Spec 0008 FR-026 — which cue a game event earns, as a pure decision so both
// the local and inbound paths sound identical. The gating (Game sounds toggle,
// chat-open check) lives in the caller/player, not here.
import { describe, it, expect } from 'vitest';
import { gameCueFor } from './game-sounds';
import type { GameSessionStatus } from '@/games/types';

const s = (v: GameSessionStatus) => v;

describe('gameCueFor (spec 0008 FR-026)', () => {
  it('an ongoing game ticks per move', () => {
    expect(gameCueFor(s({ state: 'ongoing', turn: 0 }), 0)).toBe('gamemove');
    expect(gameCueFor(s({ state: 'ongoing', turn: 1 }), 0)).toBe('gamemove');
  });

  it('winning earns the fanfare, losing the warm descent — from each side', () => {
    expect(gameCueFor(s({ state: 'won', winner: 0 }), 0)).toBe('gamewin');
    expect(gameCueFor(s({ state: 'won', winner: 0 }), 1)).toBe('gamelose');
    expect(gameCueFor(s({ state: 'won', winner: 1 }), 0)).toBe('gamelose');
  });

  it('a resignation resolves like a result (winner fanfare, resigner descent)', () => {
    expect(gameCueFor(s({ state: 'resigned', winner: 0 }), 0)).toBe('gamewin');
    expect(gameCueFor(s({ state: 'resigned', winner: 0 }), 1)).toBe('gamelose');
  });

  it('a draw is neutral', () => {
    expect(gameCueFor(s({ state: 'draw' }), 0)).toBe('gamedraw');
    expect(gameCueFor(s({ state: 'draw' }), 1)).toBe('gamedraw');
  });

  it('an out-of-sync game makes no sound at all', () => {
    expect(gameCueFor(s({ state: 'out-of-sync' }), 0)).toBeNull();
  });
});
