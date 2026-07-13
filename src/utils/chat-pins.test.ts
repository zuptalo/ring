// MAX_PINNED_CHATS lives here (dependency-free, like ownsync-keys) so this test
// never has to import the full IDB data layer; queries.ts re-imports it.
import { describe, it, expect } from 'vitest';
import { partitionPinned, PINNED_GRID_MAX, MAX_PINNED_CHATS } from './chat-pins';

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
