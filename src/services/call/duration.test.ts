import { describe, it, expect } from 'vitest';
import { activeDurationSec, bankActive, startActive, type ActiveClock } from './duration';

const SEC = 1000;

describe('call active-time accounting (spec 0005 — hold excludes held time)', () => {
  it('counts the running stint from startedAt', () => {
    const c: ActiveClock = { startedAt: 1_000_000 };
    expect(activeDurationSec(c, 1_000_000 + 30 * SEC)).toBe(30);
  });

  it('banks the stint on hold and stops counting while held', () => {
    const c: ActiveClock = { startedAt: 1_000_000 };
    bankActive(c, 1_000_000 + 20 * SEC); // 20s talk, then held
    expect(c.startedAt).toBeUndefined();
    expect(c.activeSec).toBe(20);
    // Time passes ON HOLD — duration must NOT grow.
    expect(activeDurationSec(c, 1_000_000 + 5 * 60 * SEC)).toBe(20);
  });

  it('resumes and accumulates only active time across a hold (held interval excluded)', () => {
    const c: ActiveClock = { startedAt: 1_000_000 };
    bankActive(c, 1_000_000 + 20 * SEC); // 20s active
    // ...held for 5 minutes...
    startActive(c, 1_000_000 + 5 * 60 * SEC); // resume
    // ...10s more active.
    const now = 1_000_000 + 5 * 60 * SEC + 10 * SEC;
    expect(activeDurationSec(c, now)).toBe(30); // 20 + 10, NOT 20 + 300 + 10
  });

  it('two concurrent calls track independent durations', () => {
    const a: ActiveClock = { startedAt: 1_000_000 };
    const b: ActiveClock = { startedAt: 1_000_000 + 40 * SEC }; // started 40s later
    const now = 1_000_000 + 100 * SEC;
    expect(activeDurationSec(a, now)).toBe(100);
    expect(activeDurationSec(b, now)).toBe(60);
  });

  it('bankActive is idempotent when already banked (no running stint)', () => {
    const c: ActiveClock = { activeSec: 15 };
    bankActive(c, 9_999_999);
    expect(c.activeSec).toBe(15);
  });

  it('a never-connected call (no startedAt, no banked time) is zero', () => {
    expect(activeDurationSec({}, 123)).toBe(0);
    expect(activeDurationSec(null, 123)).toBe(0);
  });
});
