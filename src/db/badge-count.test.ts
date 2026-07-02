// Unit tests for the badge total computation (spec 1027 T023, fixes bug B4;
// mode-at-write cache tightening in spec 1028). The naive code failed closed to
// 0 for the WHOLE app while the hidden set was locked in modes never/revealed —
// blanking legitimate visible-chat badges. The pure helper falls back to the
// last HIDDEN-EXCLUDED count instead, and marks which results are safe to cache
// so an always-mode (hidden-inclusive) total can never seed that fallback.
import { describe, it, expect } from 'vitest';
import { computeUnreadTotal } from './badge-count';

const chats = [
  { id: 'v1', unread: 2 },
  { id: 'v2', unread: 0 },
  { id: 'h1', unread: 5 },
];
const hidden = new Set(['h1']);

describe('computeUnreadTotal', () => {
  it("mode 'always' counts everything but is NOT cacheable (hidden-inclusive)", () => {
    expect(computeUnreadTotal(chats, 'always', null, false, null)).toEqual({ total: 7, cacheable: false });
    expect(computeUnreadTotal(chats, 'always', hidden, false, null)).toEqual({ total: 7, cacheable: false });
  });

  it("mode 'never' excludes hidden unreads when the set is known, and is cacheable", () => {
    expect(computeUnreadTotal(chats, 'never', hidden, false, null)).toEqual({ total: 2, cacheable: true });
  });

  it("mode 'revealed' counts hidden only while revealed — and is cacheable ONLY when relocked", () => {
    // Revealed → hidden counted → NOT safe to cache (would leak into a later
    // locked cold-open fallback).
    expect(computeUnreadTotal(chats, 'revealed', hidden, true, null)).toEqual({ total: 7, cacheable: false });
    // Relocked → hidden excluded → cacheable.
    expect(computeUnreadTotal(chats, 'revealed', hidden, false, null)).toEqual({ total: 2, cacheable: true });
  });

  it('an unknown set falls back to the last good count — never a collateral zero (B4), never re-cached', () => {
    expect(computeUnreadTotal(chats, 'never', null, false, 2)).toEqual({ total: 2, cacheable: false });
    expect(computeUnreadTotal(chats, 'revealed', null, false, 4)).toEqual({ total: 4, cacheable: false });
  });

  it('an unknown set with no cached count yields 0 (fail-closed under-count, no leak)', () => {
    expect(computeUnreadTotal(chats, 'never', null, false, null)).toEqual({ total: 0, cacheable: false });
  });

  it('empty chat list is 0 and cacheable', () => {
    expect(computeUnreadTotal([], 'never', hidden, false, 9)).toEqual({ total: 0, cacheable: true });
  });

  it('mode-at-write leak is closed: an always-mode total never seeds the never/revealed fallback', () => {
    // Sequence: user in 'always' → cache would hold the hidden-inclusive 7; but
    // 'always' is not cacheable, so it never writes. User switches to 'never'
    // and locks + cold-opens before a recompute: the fallback must NOT surface
    // a hidden-inclusive number. With no cacheable write having happened, the
    // fallback is whatever hidden-EXCLUDED value was last cached (here none → 0),
    // and the always total (7) can never have been the cached seed.
    const always = computeUnreadTotal(chats, 'always', hidden, false, null);
    expect(always.cacheable).toBe(false); // 7 is never persisted
    // The only value the fallback can reuse is a prior hidden-excluded total.
    const cachedNever = computeUnreadTotal(chats, 'never', hidden, false, null);
    expect(cachedNever).toEqual({ total: 2, cacheable: true }); // this one seeds it
  });
});
