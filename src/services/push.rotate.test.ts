// Spec 1037 — the pure zombie-rotation decision: rotate the push subscription
// exactly when a long-queued message drained with NO push wake since it was
// sent (the should-have-woken-but-didn't signature), with a grace window for a
// racing held-push wake and a 24h thrash cap.
import { describe, it, expect } from 'vitest';
import { shouldRotateForStaleness } from './push';

const H = 60 * 60 * 1000;
const NOW = 1_000_000_000;
const base = {
  stale: { at: NOW - 30 * 60 * 1000, recordedAt: NOW - 5 * 60 * 1000 }, // sent 30min ago, seen 5min ago
  lastWakeAt: NOW - 2 * 24 * H, // no wake in two days
  lastRotateAt: 0,
  now: NOW,
};

describe('spec 1037: shouldRotateForStaleness', () => {
  it('fires on the zombie signature', () => {
    expect(shouldRotateForStaleness(base)).toBe(true);
  });
  it('no marker → never', () => {
    expect(shouldRotateForStaleness({ ...base, stale: null })).toBe(false);
  });
  it('a wake AFTER the stale message was sent invalidates the signature (offline phone, held pushes arrived)', () => {
    expect(shouldRotateForStaleness({ ...base, lastWakeAt: base.stale.at + 1000 })).toBe(false);
  });
  it('a wake BEFORE the stale message keeps the signature (that wake proves nothing)', () => {
    expect(shouldRotateForStaleness({ ...base, lastWakeAt: base.stale.at - 1000 })).toBe(true);
  });
  it('within the 60s grace (a racing held-push may still land) → wait', () => {
    expect(shouldRotateForStaleness({ ...base, stale: { ...base.stale, recordedAt: NOW - 30_000 } })).toBe(false);
  });
  it('rotated within 24h → capped', () => {
    expect(shouldRotateForStaleness({ ...base, lastRotateAt: NOW - 23 * H })).toBe(false);
  });
  it('rotated over 24h ago → allowed again', () => {
    expect(shouldRotateForStaleness({ ...base, lastRotateAt: NOW - 25 * H })).toBe(true);
  });
});
