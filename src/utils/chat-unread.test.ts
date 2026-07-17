import { describe, it, expect } from 'vitest';
import { jumpButtonVisible, unreadSince, seenFrontier } from './chat-unread';

// Pure logic behind the "scroll to latest" control (spec 1012): the show/hide hysteresis
// predicate and the unread-since-boundary count. Both are pure (no DOM) — the view feeds them
// the live distance-from-bottom and a message list.

describe('jumpButtonVisible (hysteresis)', () => {
  it('shows once past the show threshold', () => {
    expect(jumpButtonVisible(700, false, 600, 120)).toBe(true);
  });

  it('hides once within the hide threshold', () => {
    expect(jumpButtonVisible(80, true, 600, 120)).toBe(false);
  });

  it('keeps the current state in the gap between thresholds (no flicker)', () => {
    expect(jumpButtonVisible(300, false, 600, 120)).toBe(false); // was hidden → stays hidden
    expect(jumpButtonVisible(300, true, 600, 120)).toBe(true); // was shown → stays shown
  });

  it('does not oscillate across a sweep when showPx > hidePx', () => {
    let shown = false;
    // climb up: hidden until past showPx, then shown
    for (const d of [50, 200, 400, 600, 601, 900]) shown = jumpButtonVisible(d, shown, 600, 120);
    expect(shown).toBe(true);
    // come back down: stays shown until within hidePx
    for (const d of [500, 300, 121, 120, 0]) shown = jumpButtonVisible(d, shown, 600, 120);
    expect(shown).toBe(false);
  });
});

describe('unreadSince (incoming-only count + first unread)', () => {
  const M = (id: string, timestamp: number, over: Partial<{ outgoing: boolean; deleted: boolean; senderId: string }> = {}) =>
    ({ id, timestamp, outgoing: false, ...over });

  it('returns 0 / null when there is no boundary', () => {
    expect(unreadSince([M('a', 10)], null, 'me')).toEqual({ count: 0, firstId: null });
  });

  it('counts incoming messages strictly after the boundary, earliest as firstId', () => {
    const msgs = [M('a', 10), M('b', 20), M('c', 30), M('d', 40)];
    expect(unreadSince(msgs, { ts: 20, id: 'b' }, 'me')).toEqual({ count: 2, firstId: 'c' }); // c@30, d@40
  });

  it('excludes outgoing / own-device messages', () => {
    const msgs = [M('in1', 30), M('out1', 40, { outgoing: true }), M('own', 50, { senderId: 'me' })];
    expect(unreadSince(msgs, { ts: 20, id: 'b' }, 'me')).toEqual({ count: 1, firstId: 'in1' });
  });

  it('excludes deleted messages', () => {
    const msgs = [M('x', 30, { deleted: true }), M('y', 40)];
    expect(unreadSince(msgs, { ts: 20, id: 'b' }, 'me')).toEqual({ count: 1, firstId: 'y' });
  });

  it('breaks timestamp ties by id so firstId is deterministic', () => {
    const msgs = [M('z', 30), M('a', 30), M('m', 30)];
    expect(unreadSince(msgs, { ts: 20, id: 'b' }, 'me')).toEqual({ count: 3, firstId: 'a' });
  });

  it('uses a (timestamp, id) cut so a same-millisecond newer message is not dropped', () => {
    // The user had seen m50@100 (the boundary). Two messages share that millisecond: one with a
    // greater id sorts BELOW the boundary (arrived after → unread); one with a smaller id sorts
    // ABOVE it (already on-screen → read); the boundary message itself is excluded.
    const msgs = [M('aaa', 100), M('zzz', 100), M('m50', 100)];
    expect(unreadSince(msgs, { ts: 100, id: 'm50' }, 'me')).toEqual({ count: 1, firstId: 'zzz' });
  });

  it('returns 0 / null when nothing is after the boundary', () => {
    expect(unreadSince([M('a', 10), M('b', 20)], { ts: 20, id: 'b' }, 'me')).toEqual({ count: 0, firstId: null });
  });
});

describe('seenFrontier (high-water mark of what this device has reported Seen)', () => {
  const F = (
    id: string,
    timestamp: number,
    over: Partial<{ outgoing: boolean; deleted: boolean; senderId: string; seenReportedAt: number }> = {},
  ) => ({ id, timestamp, outgoing: false, ...over });

  it('returns null when no message has been reported Seen', () => {
    expect(seenFrontier([F('a', 10), F('b', 20)], 'me')).toBeNull();
  });

  it('returns the (ts, id) of the newest incoming message with seenReportedAt set', () => {
    const msgs = [F('a', 10, { seenReportedAt: 10 }), F('b', 20, { seenReportedAt: 20 }), F('c', 30)];
    expect(seenFrontier(msgs, 'me')).toEqual({ ts: 20, id: 'b' }); // c is not reported
  });

  it('excludes outgoing / own-device messages even if they carry the flag', () => {
    const msgs = [
      F('in', 30, { seenReportedAt: 30 }),
      F('out', 40, { outgoing: true, seenReportedAt: 40 }),
      F('own', 50, { senderId: 'me', seenReportedAt: 50 }),
    ];
    expect(seenFrontier(msgs, 'me')).toEqual({ ts: 30, id: 'in' });
  });

  it('excludes deleted messages', () => {
    const msgs = [F('x', 30, { seenReportedAt: 30, deleted: true }), F('y', 20, { seenReportedAt: 20 })];
    expect(seenFrontier(msgs, 'me')).toEqual({ ts: 20, id: 'y' });
  });

  it('breaks timestamp ties by id (largest id wins at the same ts), independent of input order', () => {
    const msgs = [
      F('a', 30, { seenReportedAt: 30 }),
      F('z', 30, { seenReportedAt: 30 }),
      F('m', 30, { seenReportedAt: 30 }),
    ];
    expect(seenFrontier(msgs, 'me')).toEqual({ ts: 30, id: 'z' });
    expect(seenFrontier([...msgs].reverse(), 'me')).toEqual({ ts: 30, id: 'z' });
  });
});
