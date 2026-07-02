// Unit tests for the badge total computation (spec 1027 T023, fixes bug B4).
// The old page code failed closed to 0 for the WHOLE app while the hidden set
// was still locked in modes never/revealed — blanking legitimate visible-chat
// badges. The pure helper makes the fallback explicit: an unknown set falls
// back to the last successfully computed (already preference-filtered) count,
// never to zero, and never counts what it cannot classify.
import { describe, it, expect } from 'vitest';
import { computeUnreadTotal } from './badge-count';

const chats = [
  { id: 'v1', unread: 2 },
  { id: 'v2', unread: 0 },
  { id: 'h1', unread: 5 },
];
const hidden = new Set(['h1']);

describe('computeUnreadTotal', () => {
  it("mode 'always' counts everything and needs no hidden knowledge", () => {
    expect(computeUnreadTotal(chats, 'always', null, false, null)).toEqual({ total: 7, fresh: true });
    expect(computeUnreadTotal(chats, 'always', hidden, false, null)).toEqual({ total: 7, fresh: true });
  });

  it("mode 'never' excludes hidden unreads when the set is known", () => {
    expect(computeUnreadTotal(chats, 'never', hidden, false, null)).toEqual({ total: 2, fresh: true });
  });

  it("mode 'revealed' counts hidden unreads only during an active reveal", () => {
    expect(computeUnreadTotal(chats, 'revealed', hidden, true, null)).toEqual({ total: 7, fresh: true });
    expect(computeUnreadTotal(chats, 'revealed', hidden, false, null)).toEqual({ total: 2, fresh: true });
  });

  it('an unknown set falls back to the last good count — never a collateral zero (B4)', () => {
    expect(computeUnreadTotal(chats, 'never', null, false, 2)).toEqual({ total: 2, fresh: false });
    expect(computeUnreadTotal(chats, 'revealed', null, false, 4)).toEqual({ total: 4, fresh: false });
  });

  it('an unknown set with no cached count yields 0 without claiming freshness', () => {
    expect(computeUnreadTotal(chats, 'never', null, false, null)).toEqual({ total: 0, fresh: false });
  });

  it('empty chat list is 0 and fresh', () => {
    expect(computeUnreadTotal([], 'never', hidden, false, 9)).toEqual({ total: 0, fresh: true });
  });
});
