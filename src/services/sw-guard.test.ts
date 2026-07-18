// Spec 2043 — the per-event guard around a push wake. The pre-2043 bug was a
// MODULE-GLOBAL "last notification shown" stamp: in an overlapping burst, a later
// event's accepted show bled past an earlier event's start and suppressed the
// earlier event's fallback → a silent push → an iOS subscription strike. The fix
// is a per-event context: one WakeCtx per wake, never shared. These tests pin the
// two decisions (reject/timeout → fall back unless THIS event showed; clean resolve
// → fall back unless THIS event was satisfied) and the burst-isolation invariant.
import { describe, it, expect } from 'vitest';
import { runGuardedWake, type WakeCtx } from './sw-inbox';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('spec 2043: runGuardedWake', () => {
  it('a wake that shows and is satisfied fires no fallback', async () => {
    const reasons: string[] = [];
    await runGuardedWake(
      async (ctx: WakeCtx) => { ctx.shown = true; ctx.satisfied = true; },
      async (r) => { reasons.push(r); },
      1000,
    );
    expect(reasons).toEqual([]);
  });

  it('a CLEAN resolve that showed nothing and was not satisfied trips the backstop', async () => {
    const reasons: string[] = [];
    await runGuardedWake(
      async () => { /* resolves without touching ctx — the un-backstopped regression */ },
      async (r) => { reasons.push(r); },
      1000,
    );
    expect(reasons).toEqual(['clean-resolve-no-show']);
  });

  it('a clean resolve with LICENSED silence (satisfied, not shown) fires no backstop', async () => {
    const reasons: string[] = [];
    await runGuardedWake(
      async (ctx: WakeCtx) => { ctx.satisfied = true; /* focused+visible Chromium: silence is licensed */ },
      async (r) => { reasons.push(r); },
      1000,
    );
    expect(reasons).toEqual([]);
  });

  it('a wake that THROWS having shown nothing fires the fallback', async () => {
    const reasons: string[] = [];
    await runGuardedWake(
      async () => { throw new Error('idb wedged'); },
      async (r) => { reasons.push(r); },
      1000,
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('idb wedged');
  });

  it('a wake that throws AFTER an accepted show does NOT double up a fallback', async () => {
    const reasons: string[] = [];
    await runGuardedWake(
      async (ctx: WakeCtx) => { ctx.shown = true; throw new Error('straggler blew up post-show'); },
      async (r) => { reasons.push(r); },
      1000,
    );
    expect(reasons).toEqual([]);
  });

  it('burst isolation: a sibling event\'s show never suppresses THIS event\'s fallback (the 2043 regression)', async () => {
    // Two overlapping wakes. Wake B is fast and shows; wake A is slow and throws
    // having shown nothing. With the old global stamp, B's show would satisfy A's
    // suppression check and A would end SILENTLY. With per-event ctx, A still falls
    // back. Order the timing so B resolves BEFORE A rejects.
    const aReasons: string[] = [];
    const bReasons: string[] = [];
    const a = runGuardedWake(
      async () => { await sleep(30); throw new Error('A failed'); },
      async (r) => { aReasons.push(r); },
      1000,
    );
    const b = runGuardedWake(
      async (ctx: WakeCtx) => { ctx.shown = true; ctx.satisfied = true; },
      async (r) => { bReasons.push(r); },
      1000,
    );
    await Promise.all([a, b]);
    expect(bReasons).toEqual([]);           // B showed → no fallback
    expect(aReasons).toHaveLength(1);       // A still falls back despite B's show
    expect(aReasons[0]).toContain('A failed');
  });

  it('a dispatch that never resolves falls back after the deadline', async () => {
    const reasons: string[] = [];
    await runGuardedWake(
      () => new Promise<void>(() => { /* never settles */ }),
      async (r) => { reasons.push(r); },
      20,
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('deadline');
  });

  it('a fallback that itself rejects is swallowed (the platform denied even the generic)', async () => {
    // Still resolves; the attempt is recorded as fellBack so the ledger sees it.
    await expect(
      runGuardedWake(
        async () => { throw new Error('boom'); },
        async () => { throw new Error('platform denied the fallback too'); },
        1000,
      ),
    ).resolves.toMatchObject({ fellBack: true, shown: false });
  });

  it('reports the outcome: shown wakes never fall back; silent primary paths do', async () => {
    const shownRes = await runGuardedWake(
      async (ctx: WakeCtx) => { ctx.shown = true; ctx.satisfied = true; },
      async () => {},
      1000,
    );
    expect(shownRes).toEqual({ shown: true, satisfied: true, fellBack: false });

    const backstopRes = await runGuardedWake(async () => {}, async () => {}, 1000);
    expect(backstopRes).toEqual({ shown: false, satisfied: false, fellBack: true });
  });
});
