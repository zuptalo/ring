import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  pickAnchor,
  resolveAnchorDelta,
  shouldDeferScrollWrite,
  isSelfEcho,
} from './scroll-anchor';

// Pure anchor-delta math (INV-1) + the momentum/echo guard predicates (INV-5). The
// view measures rendered [data-mid] rects and hands them here; the helper decides the
// scrollTop correction that keeps the anchored bubble visually stationary (≤2px).

describe('pickAnchor', () => {
  it('picks the topmost row fully below the viewport top', () => {
    const a = pickAnchor([
      { id: 'off', top: -30 }, // partly scrolled off the top
      { id: 'x', top: 12 }, // first fully-visible row
      { id: 'y', top: 80 },
    ]);
    expect(a?.id).toBe('x');
    expect(a?.top).toBe(12);
  });

  it('records a fallback chain from the anchor downward (for an evicted anchor)', () => {
    const a = pickAnchor([
      { id: 'x', top: 12 },
      { id: 'y', top: 80 },
      { id: 'z', top: 140 },
    ]);
    expect(a?.fallback).toEqual(['x', 'y', 'z']);
  });

  it('returns null when nothing is rendered', () => {
    expect(pickAnchor([])).toBeNull();
  });
});

describe('resolveAnchorDelta', () => {
  it('computes the residual so the anchor lands back within ≤2px', () => {
    const anchor = { id: 'x', top: 12, fallback: ['x', 'y'] };
    // After the prepend the anchor measured 60px lower.
    const delta = resolveAnchorDelta(anchor, [
      { id: 'x', top: 72 },
      { id: 'y', top: 140 },
    ]);
    expect(delta).toBe(60); // scrollTop += 60 → anchor returns to top 12
    // Residual after applying the correction is 0 (≤2px, INV-1).
    const residual = Math.abs(72 - delta! - anchor.top);
    expect(residual).toBeLessThanOrEqual(2);
  });

  it('falls back to the next still-rendered row when the anchor was evicted', () => {
    const anchor = { id: 'x', top: 12, fallback: ['x', 'y', 'z'] };
    // 'x' is gone (evicted); 'y' is the next still-rendered row.
    const delta = resolveAnchorDelta(anchor, [
      { id: 'y', top: 70 },
      { id: 'z', top: 130 },
    ]);
    expect(delta).toBe(70 - 12); // uses y's measured top against the recorded anchor top
  });

  it('returns null when nothing in the fallback chain is still rendered', () => {
    const anchor = { id: 'x', top: 12, fallback: ['x', 'y'] };
    expect(resolveAnchorDelta(anchor, [{ id: 'q', top: 50 }])).toBeNull();
  });
});

describe('momentum / echo guards (INV-5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('defers a scrollTop write while a fling is in flight, permits it once quiet', () => {
    const QUIET = 220;
    const lastUserScrollAt = 1000;
    // 100ms after the last genuine user scroll → still flinging → defer.
    expect(shouldDeferScrollWrite(1100, lastUserScrollAt, QUIET)).toBe(true);
    // 260ms later → settled → permit.
    expect(shouldDeferScrollWrite(1260, lastUserScrollAt, QUIET)).toBe(false);
  });

  it('does not defer when there has been no user scroll yet', () => {
    expect(shouldDeferScrollWrite(5000, 0, 220)).toBe(false);
  });

  it('marks a scroll within the suppress window as our own echo', () => {
    const suppressStickUntil = 2000;
    expect(isSelfEcho(1900, suppressStickUntil)).toBe(true); // our pin echo
    expect(isSelfEcho(2100, suppressStickUntil)).toBe(false); // genuine user scroll
  });
});
