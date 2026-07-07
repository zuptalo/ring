// Spec 1038 T008 — the ongoing-games truth table behind the floating pill.
import { beforeAll, describe, it, expect } from 'vitest';
import { ready } from '@/services/crypto/primitives';
import armada from './armada';
import tictactoe from './tictactoe';
import { commitment, type Layout } from './armada/logic';
import { mostUrgentFirst, overlayGameEntry, type OverlayGameRef } from './overlay-games';
import type { GameSession } from './types';

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
const H0 = () => commitment(L0, 'c2FsdDA');

const chatRef: OverlayGameRef = { surface: 'chat', chatId: 'c1', messageId: 'm1', gameType: 'armada' };
const wallRef: OverlayGameRef = { surface: 'wall', postId: 'p1', gameType: 'armada' };

const fresh = (extra?: Partial<GameSession>): GameSession => ({ gameType: 'armada', moves: [], ...extra });

describe('overlayGameEntry (the pill truth table)', () => {
  it('a fresh 1:1 armada session lists for BOTH seats; only P0 is awaited (sequential commits)', () => {
    const s = fresh();
    const p0 = overlayGameEntry(armada, s, 0, chatRef, 100);
    const p1 = overlayGameEntry(armada, s, 1, chatRef, 100);
    expect(p0).toMatchObject({ awaitingMe: true, lastActivityAt: 100 });
    expect(p1).toMatchObject({ awaitingMe: false });
  });

  it('inline-presentation games never list', () => {
    expect(overlayGameEntry(tictactoe, { gameType: 'tictactoe', moves: [] }, 0, chatRef, 1)).toBeNull();
  });

  it('spectators (no seat) never list', () => {
    expect(overlayGameEntry(armada, fresh(), null, wallRef, 1)).toBeNull();
  });

  it('an unknown module and a finished/resigned session never list', () => {
    expect(overlayGameEntry(null, fresh(), 0, chatRef, 1)).toBeNull();
    expect(overlayGameEntry(armada, fresh({ resignedBy: 1 }), 0, chatRef, 1)).toBeNull();
    expect(overlayGameEntry(armada, fresh({ outOfSync: true }), 0, chatRef, 1)).toBeNull();
  });

  it('an OPEN or CANCELLED wall challenge has no board to return to', () => {
    const open = fresh({ players: ['host'], challenge: { accepts: [] } });
    expect(overlayGameEntry(armada, open, 0, wallRef, 1)).toBeNull();
    const cancelled = fresh({
      players: ['host'],
      challenge: { accepts: [], cancelledAt: 5 },
    });
    expect(overlayGameEntry(armada, cancelled, 0, wallRef, 1)).toBeNull();
    const accepted = fresh({
      players: ['host', 'guest'],
      challenge: { accepts: [{ userId: 'guest', at: 2 }] },
    });
    expect(overlayGameEntry(armada, accepted, 1, wallRef, 1)).not.toBeNull();
  });

  it('awaitingMe flips with the turn and lastActivityAt tracks the newest move', () => {
    const s = fresh({
      moves: [{ seq: 1, player: 0, move: { t: 'commit', h: H0() }, at: 500 }],
    });
    // P0 committed; P1's slot is open → P1 awaited, P0 not.
    expect(overlayGameEntry(armada, s, 0, chatRef, 1)?.awaitingMe).toBe(false);
    const p1 = overlayGameEntry(armada, s, 1, chatRef, 1);
    expect(p1?.awaitingMe).toBe(true);
    expect(p1?.lastActivityAt).toBe(500);
  });
});

describe('mostUrgentFirst (the pill tap order)', () => {
  it('awaiting-me games outrank newer their-turn games; newest activity breaks ties', () => {
    const mk = (awaitingMe: boolean, lastActivityAt: number, id: string) => ({
      ref: { surface: 'chat' as const, chatId: 'c', messageId: id, gameType: 'armada' },
      awaitingMe,
      lastActivityAt,
    });
    const sorted = mostUrgentFirst([mk(false, 900, 'a'), mk(true, 100, 'b'), mk(true, 500, 'c')]);
    expect(sorted.map((e) => (e.ref as { messageId: string }).messageId)).toEqual(['c', 'b', 'a']);
  });
});
