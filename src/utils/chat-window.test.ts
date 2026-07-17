import { describe, it, expect } from 'vitest';
import {
  ROW_CAP,
  initialWindow,
  shiftWindow,
  computeWindow,
} from './chat-window';

// Pure render-window math. The view renders rows.slice(start, end); these helpers move
// {start,end} as the user scrolls, keeping the DOM bounded to ROW_CAP while always
// covering the look-ahead direction. They never touch the DOM — the view feeds them the
// loaded-row count + the direction a look-ahead sentinel fired in.

describe('initialWindow', () => {
  it('renders the newest ROW_CAP rows (pinned to bottom on open)', () => {
    const w = initialWindow(500, 100);
    expect(w).toEqual({ start: 400, end: 500 });
    expect(w.end - w.start).toBe(100);
  });

  it('renders the whole run when it is smaller than the cap', () => {
    expect(initialWindow(12, 100)).toEqual({ start: 0, end: 12 });
  });

  it('defaults the cap to ROW_CAP', () => {
    const w = initialWindow(1000);
    expect(w.end - w.start).toBe(ROW_CAP);
  });
});

describe('shiftWindow', () => {
  it('shifts both edges by a prepend count so the same rows stay rendered', () => {
    // loadOlder prepended 50 rows to the front of `rows`; indices move +50.
    expect(shiftWindow({ start: 0, end: 100 }, 50)).toEqual({ start: 50, end: 150 });
  });
});

describe('computeWindow — grow older (scrolling up)', () => {
  it('grows start downward and retreats end to stay within the cap', () => {
    const w = computeWindow(
      { start: 60, end: 160 },
      { grow: 'older', step: 40, total: 500, rowCap: 100 },
    );
    expect(w.start).toBe(20); // 60 - 40 (grew start ↓)
    expect(w.end).toBe(120); // retreated end to keep end - start === 100
    expect(w.end - w.start).toBe(100);
  });

  it('never lets start go below 0', () => {
    const w = computeWindow(
      { start: 20, end: 120 },
      { grow: 'older', step: 40, total: 500, rowCap: 100 },
    );
    expect(w.start).toBe(0);
    expect(w.end - w.start).toBeLessThanOrEqual(100);
  });
});

describe('computeWindow — grow newer (downward re-entry after eviction)', () => {
  it('grows end upward and advances start to stay within the cap', () => {
    const w = computeWindow(
      { start: 20, end: 120 },
      { grow: 'newer', step: 40, total: 500, rowCap: 100 },
    );
    expect(w.end).toBe(160); // 120 + 40 (grew end ↑)
    expect(w.start).toBe(60); // advanced start to keep end - start === 100
    expect(w.end - w.start).toBe(100);
  });

  it('never lets end exceed total', () => {
    const w = computeWindow(
      { start: 380, end: 480 },
      { grow: 'newer', step: 40, total: 500, rowCap: 100 },
    );
    expect(w.end).toBe(500);
    expect(w.end - w.start).toBeLessThanOrEqual(100);
  });
});

describe('computeWindow — invariants over a long scroll', () => {
  it('never exceeds the cap across an up-then-down sweep', () => {
    let w = initialWindow(1000, 100);
    // sweep up to the top
    for (let i = 0; i < 40; i++) {
      w = computeWindow(w, { grow: 'older', step: 40, total: 1000, rowCap: 100 });
      expect(w.end - w.start).toBeLessThanOrEqual(100);
      expect(w.start).toBeGreaterThanOrEqual(0);
      expect(w.end).toBeLessThanOrEqual(1000);
    }
    expect(w.start).toBe(0);
    // sweep back down to the bottom
    for (let i = 0; i < 40; i++) {
      w = computeWindow(w, { grow: 'newer', step: 40, total: 1000, rowCap: 100 });
      expect(w.end - w.start).toBeLessThanOrEqual(100);
      expect(w.start).toBeGreaterThanOrEqual(0);
      expect(w.end).toBeLessThanOrEqual(1000);
    }
    expect(w.end).toBe(1000);
  });
});
