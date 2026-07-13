// MAX_PINNED_CHATS lives here (dependency-free, like ownsync-keys) so this test
// never has to import the full IDB data layer; queries.ts re-imports it.
import { describe, it, expect } from 'vitest';
import { partitionPinned, pinnedOrder, nextPinRank, PINNED_GRID_MAX, MAX_PINNED_CHATS } from './chat-pins';

type C = { id: string; pinned?: boolean };
const chats: C[] = [
  { id: 'p1', pinned: true },
  { id: 'a' },
  { id: 'p2', pinned: true },
  { id: 'b' },
];

describe('partitionPinned (spec 1044 — iMessage-style pinned grid)', () => {
  it('splits pinned into the grid and the rest into the list on the All filter with empty search', () => {
    const { grid, list } = partitionPinned(chats, { filterAll: true, searching: false });
    expect(grid.map((c) => c.id)).toEqual(['p1', 'p2']);
    expect(list.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('keeps everything in the list (no grid) while searching or on a non-All filter', () => {
    for (const opts of [
      { filterAll: false, searching: false },
      { filterAll: true, searching: true },
    ]) {
      const { grid, list } = partitionPinned(chats, opts);
      expect(grid).toEqual([]);
      expect(list.map((c) => c.id)).toEqual(['p1', 'a', 'p2', 'b']);
    }
  });

  it('preserves incoming order (activity order comes from chatOrder upstream)', () => {
    const many = [{ id: 'x', pinned: true }, ...chats];
    const { grid } = partitionPinned(many, { filterAll: true, searching: false });
    expect(grid.map((c) => c.id)).toEqual(['x', 'p1', 'p2']);
  });

  it('caps the grid at 9 tiles and overflows the rest into the list (over-synced snapshots)', () => {
    const pins: C[] = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, pinned: true }));
    const { grid, list } = partitionPinned([...pins, { id: 'z' }], { filterAll: true, searching: false });
    expect(grid).toHaveLength(PINNED_GRID_MAX);
    expect(list.map((c) => c.id)).toEqual(['p9', 'p10', 'z']);
  });
});

describe('pin cap (spec 1044)', () => {
  it('raises MAX_PINNED_CHATS to 9', () => {
    expect(MAX_PINNED_CHATS).toBe(9);
    expect(PINNED_GRID_MAX).toBe(9);
  });
});

/* ---- spec 1045: user-defined pinned order ---- */

type R = { id: string; pinnedRank?: number; lastMessageTime: number };
const byOrder = (list: R[]) => [...list].sort(pinnedOrder).map((c) => c.id);

describe('pinnedOrder (spec 1045 — manual arrangement)', () => {
  it('sorts by rank ascending, ignoring recency', () => {
    const pins: R[] = [
      { id: 'b', pinnedRank: 1, lastMessageTime: 900 },
      { id: 'c', pinnedRank: 2, lastMessageTime: 500 },
      { id: 'a', pinnedRank: 0, lastMessageTime: 100 },
    ];
    expect(byOrder(pins)).toEqual(['a', 'b', 'c']);
  });

  it('is unaffected by new activity (the rank is the only mover)', () => {
    const pins: R[] = [
      { id: 'a', pinnedRank: 0, lastMessageTime: 100 },
      { id: 'b', pinnedRank: 1, lastMessageTime: 200 },
    ];
    pins[1].lastMessageTime = 99_999; // "new message arrives in b"
    expect(byOrder(pins)).toEqual(['a', 'b']);
  });

  it('sorts legacy pins (no rank) after ranked ones, newest first', () => {
    const pins: R[] = [
      { id: 'legacyOld', lastMessageTime: 100 },
      { id: 'ranked', pinnedRank: 3, lastMessageTime: 1 },
      { id: 'legacyNew', lastMessageTime: 900 },
    ];
    expect(byOrder(pins)).toEqual(['ranked', 'legacyNew', 'legacyOld']);
  });

  it('breaks rank ties (post-sync merges) by recency, then keeps stable input order', () => {
    const pins: R[] = [
      { id: 'y', pinnedRank: 1, lastMessageTime: 100 },
      { id: 'x', pinnedRank: 1, lastMessageTime: 100 },
      { id: 'w', pinnedRank: 1, lastMessageTime: 500 },
    ];
    // w wins on recency; the x/y tie falls through to the (stable) input order.
    expect(byOrder(pins)).toEqual(['w', 'y', 'x']);
  });
});

describe('nextPinRank (spec 1045 — new pins append at the end)', () => {
  it('is 0 for the first pin', () => {
    expect(nextPinRank([])).toBe(0);
    expect(nextPinRank([{ id: 'a', lastMessageTime: 1 }])).toBe(0); // unpinned ignored
  });

  it('appends after the highest existing rank', () => {
    const chats = [
      { id: 'a', pinned: true, pinnedRank: 0, lastMessageTime: 1 },
      { id: 'b', pinned: true, pinnedRank: 4, lastMessageTime: 1 }, // gaps tolerated
      { id: 'c', lastMessageTime: 1 },
    ];
    expect(nextPinRank(chats)).toBe(5);
  });

  it('counts legacy ranked-less pins so an append never collides below them', () => {
    const chats = [
      { id: 'a', pinned: true, lastMessageTime: 1 }, // legacy, no rank
      { id: 'b', pinned: true, pinnedRank: 1, lastMessageTime: 1 },
    ];
    // Two pins exist: the next rank must be >= the pinned count so a later
    // ensurePinRanks() normalisation can't shuffle the appended pin backwards.
    expect(nextPinRank(chats)).toBeGreaterThanOrEqual(2);
  });
});

describe('partitionPinned returns the grid in rank order (spec 1045)', () => {
  it('grid is rank-sorted even when the incoming array is recency-ordered', () => {
    const mixed = [
      { id: 'p2', pinned: true, pinnedRank: 2, lastMessageTime: 900 },
      { id: 'p0', pinned: true, pinnedRank: 0, lastMessageTime: 500 },
      { id: 'row', lastMessageTime: 400 },
      { id: 'p1', pinned: true, pinnedRank: 1, lastMessageTime: 100 },
    ];
    const { grid, list } = partitionPinned(mixed, { filterAll: true, searching: false });
    expect(grid.map((c) => c.id)).toEqual(['p0', 'p1', 'p2']);
    expect(list.map((c) => c.id)).toEqual(['row']);
  });
});
