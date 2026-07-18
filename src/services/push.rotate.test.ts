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

// The WEAK signature (iOS 16.x zombies on a frequently-checked phone): a
// streak of ≥3 separate should-have-woken drain sessions with zero wakes
// between rotates too, even though no single message sat queued 10 minutes.
import { shouldRotateForMissedWakes } from './push';

const weakBase = {
  streak: { count: 3, newestAt: NOW - 10 * 60 * 1000 },
  lastWakeAt: NOW - 2 * 24 * H, // no wake in two days
  lastRotateAt: 0,
  now: NOW,
};

describe('weak zombie signature: shouldRotateForMissedWakes', () => {
  it('fires at a streak of 3 with no wake since the newest miss', () => {
    expect(shouldRotateForMissedWakes(weakBase)).toBe(true);
  });
  it('no streak → never', () => {
    expect(shouldRotateForMissedWakes({ ...weakBase, streak: null })).toBe(false);
  });
  it('a streak of 2 is not yet evidence', () => {
    expect(shouldRotateForMissedWakes({ ...weakBase, streak: { ...weakBase.streak, count: 2 } })).toBe(false);
  });
  it('a wake AFTER the newest miss invalidates the streak (push path alive)', () => {
    expect(shouldRotateForMissedWakes({ ...weakBase, lastWakeAt: weakBase.streak.newestAt + 1000 })).toBe(false);
  });
  it('rotated within 24h → capped', () => {
    expect(shouldRotateForMissedWakes({ ...weakBase, lastRotateAt: NOW - 23 * H })).toBe(false);
  });
});

// Spec 2043 — the server-truth zombie signature: the server holds queued frames
// older than the bar with NO push wake since they queued. Unlike the two decrypted-
// evidence signatures above, this reads directly from /relay/status, so it fires even
// on a device whose lastWakeAt is 0 (never woke) or a fresh-burst zombie that matches
// neither the ≥10-min-stale nor the streak-of-3 signature. Its OWN short (2h) cap,
// separate from the 24h drain cap, lets a device that rotated into a still-dead
// endpoint retry next session.
import { shouldRotateForQueueAge } from './push';

const M = 60 * 1000;
const queueBase = {
  oldestQueuedAtMs: NOW - 30 * M, // oldest frame queued 30min ago (well past the 10min bar)
  lastWakeAt: 0, // never woke — the exact case the decrypted-evidence signatures can't heal
  lastForceRotateAt: 0,
  now: NOW,
};

describe('spec 2043: shouldRotateForQueueAge', () => {
  it('fires when the server holds old frames and this device never woke', () => {
    expect(shouldRotateForQueueAge(queueBase)).toBe(true);
  });
  it('empty queue (null) → never', () => {
    expect(shouldRotateForQueueAge({ ...queueBase, oldestQueuedAtMs: null })).toBe(false);
  });
  it('a queue younger than the 10min bar → wait (a held push to a live sub may still be in flight)', () => {
    expect(shouldRotateForQueueAge({ ...queueBase, oldestQueuedAtMs: NOW - 3 * M })).toBe(false);
  });
  it('a wake since the oldest frame queued → not a zombie (offline phone caught up)', () => {
    expect(shouldRotateForQueueAge({ ...queueBase, lastWakeAt: queueBase.oldestQueuedAtMs + 1000 })).toBe(false);
  });
  it('a wake BEFORE the oldest frame keeps the signature (that wake proves nothing about these frames)', () => {
    expect(shouldRotateForQueueAge({ ...queueBase, lastWakeAt: queueBase.oldestQueuedAtMs - 1000 })).toBe(true);
  });
  it('force-rotated within the 2h cap → wait', () => {
    expect(shouldRotateForQueueAge({ ...queueBase, lastForceRotateAt: NOW - 1 * H })).toBe(false);
  });
  it('force-rotated over 2h ago → allowed again (retry a still-dead endpoint)', () => {
    expect(shouldRotateForQueueAge({ ...queueBase, lastForceRotateAt: NOW - 3 * H })).toBe(true);
  });
});
