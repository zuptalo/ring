import { describe, it, expect } from 'vitest';
import { gridSlotAt, moveItem, previewOrder, isInside, edgeScrollVelocity } from './drag-math';

// A 3-column grid: 300 wide, tiles ~100 each; two rows of height 120.
const grid = { left: 0, top: 100, width: 300, height: 240 };

describe('gridSlotAt (spec 1045 — which slot is the pointer over?)', () => {
  it('maps a point to its column/row cell', () => {
    expect(gridSlotAt(50, 160, grid, 6)).toBe(0);
    expect(gridSlotAt(150, 160, grid, 6)).toBe(1);
    expect(gridSlotAt(250, 160, grid, 6)).toBe(2);
    expect(gridSlotAt(50, 280, grid, 6)).toBe(3);
    expect(gridSlotAt(250, 280, grid, 6)).toBe(5);
  });

  it('clamps a cell beyond the last slot to the last slot (ragged final row)', () => {
    // 4 tiles → row 2 has one tile; pointing at row 2, col 3 must clamp to slot 3.
    expect(gridSlotAt(250, 280, grid, 4)).toBe(3);
  });

  it('returns null outside the grid rect', () => {
    expect(gridSlotAt(150, 50, grid, 6)).toBeNull(); // above
    expect(gridSlotAt(150, 500, grid, 6)).toBeNull(); // below (the list area)
    expect(gridSlotAt(-10, 160, grid, 6)).toBeNull(); // left
  });

  it('honours the slack margin so the gesture is forgiving at the edges', () => {
    expect(gridSlotAt(150, 90, grid, 6, 3, 16)).toBe(1); // 10px above, within slack
    expect(gridSlotAt(150, 50, grid, 6, 3, 16)).toBeNull(); // beyond slack
  });
});

describe('moveItem', () => {
  it('moves forward and backward without mutating the input', () => {
    const src = ['a', 'b', 'c', 'd'];
    expect(moveItem(src, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(src, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(src).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is a no-op for equal or out-of-range indices', () => {
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('previewOrder (live gap while dragging)', () => {
  const ids = ['a', 'b', 'c'];

  it('moves a member id to the hovered slot (grid-origin drag)', () => {
    expect(previewOrder(ids, 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(previewOrder(ids, 'a', 2)).toEqual(['b', 'c', 'a']);
  });

  it('inserts a foreign id at the hovered slot (list-origin drag)', () => {
    expect(previewOrder(ids, 'x', 1)).toEqual(['a', 'x', 'b', 'c']);
    expect(previewOrder(ids, 'x', 3)).toEqual(['a', 'b', 'c', 'x']);
  });

  it('clamps the hover slot and restores order when the pointer leaves (null)', () => {
    expect(previewOrder(ids, 'x', 99)).toEqual(['a', 'b', 'c', 'x']);
    expect(previewOrder(ids, 'c', null)).toEqual(['a', 'b', 'c']);
    expect(previewOrder(ids, 'x', null)).toEqual(['a', 'b', 'c']);
  });
});

describe('isInside', () => {
  it('detects containment with optional slack', () => {
    expect(isInside(10, 110, grid)).toBe(true);
    expect(isInside(10, 90, grid)).toBe(false);
    expect(isInside(10, 90, grid, 16)).toBe(true);
  });
});

describe('edgeScrollVelocity (auto-scroll while dragging near the edges)', () => {
  it('is zero in the middle of the viewport', () => {
    expect(edgeScrollVelocity(400, 0, 800)).toBe(0);
  });

  it('scrolls up near the top and down near the bottom, faster at the very edge', () => {
    const nearTop = edgeScrollVelocity(40, 0, 800);
    const atTop = edgeScrollVelocity(0, 0, 800);
    expect(nearTop).toBeLessThan(0);
    expect(atTop).toBeLessThan(nearTop);
    const nearBottom = edgeScrollVelocity(760, 0, 800);
    const atBottom = edgeScrollVelocity(800, 0, 800);
    expect(nearBottom).toBeGreaterThan(0);
    expect(atBottom).toBeGreaterThan(nearBottom);
  });
});
