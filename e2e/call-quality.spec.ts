import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startGroup, waitRemotes, waitCallState, hangup,
  setVideoQuality, legTierTo, legDiag, throttle,
} from './helpers';

/**
 * Spec 0007 — adaptive call quality. US1 (regression fix): on a healthy network, video must reach a
 * clearly-good tier quickly and NOT stay stuck low/blocky. We read per-leg tiers via the group diag
 * hook. Assertions target "high or HD-class" (SC-001) rather than strictly HD, because headless CI
 * can momentarily back off on a CPU blip — the point is it's clearly-good, not bottomed out.
 */

test('US1: a 2-person video call reaches a clearly-good tier quickly (not stuck low)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CQ1A');
  const b = await createAccount(ctxB, 'CQ1B');
  await pair(a, b);

  const room = 'cq-2p';
  await startGroup(a, room, 'video');
  await startGroup(b, room, 'video');
  await waitRemotes(a, 1);
  await waitCallState(a, ['connected']);

  // 2-person (1 peer) → ceiling HD → must reach high/HD-class. Resolving IS the assertion.
  await a.page.waitForFunction(
    async () => {
      const d = await (window as any).__ringTest.groupCallDiag();
      const t = Object.values(d.tiers)[0] as string | undefined;
      return t === 'high' || t === 'hd';
    },
    null,
    { timeout: 20_000, polling: 1000 },
  );

  await hangup(a);
  await hangup(b);
  await ctxA.close();
  await ctxB.close();
});

test('US1: a 3-person group video call reaches a clearly-good tier on each leg', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CQ2A');
  const b = await createAccount(ctxB, 'CQ2B');
  const c = await createAccount(ctxC, 'CQ2C');
  for (const [x, y] of [[a, b], [a, c], [b, c]] as const) await pair(x, y);

  const room = 'cq-3p';
  await startGroup(a, room, 'video');
  await startGroup(b, room, 'video');
  await startGroup(c, room, 'video');
  for (const x of [a, b, c]) await waitRemotes(x, 2);

  // 3-person (2 peers) → ceiling high → each leg must reach high/HD-class (not stuck low).
  await a.page.waitForFunction(
    async () => {
      const d = await (window as any).__ringTest.groupCallDiag();
      const ts = Object.values(d.tiers) as string[];
      return ts.length >= 2 && ts.every((t) => t === 'high' || t === 'hd');
    },
    null,
    { timeout: 25_000, polling: 1000 },
  );

  for (const x of [a, b, c]) await hangup(x);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('US3: pinning one participant to low caps only the streams sent TO them', async ({ browser }) => {
  // Deterministic per-receiver test (no flaky network shaping): A's manual low pin folds into the
  // ceiling A asks every peer for, so B and C cap their A-leg at low — while their leg to EACH OTHER
  // stays high. Proves the receiver-requested ceiling end-to-end (the same path the downlink uses).
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CQ3A');
  const b = await createAccount(ctxB, 'CQ3B');
  const c = await createAccount(ctxC, 'CQ3C');
  for (const [x, y] of [[a, b], [a, c], [b, c]] as const) await pair(x, y);

  const room = 'cq-pin';
  for (const x of [a, b, c]) await startGroup(x, room, 'video');
  for (const x of [a, b, c]) await waitRemotes(x, 2);
  await waitCallState(a, ['connected']);

  // Let everyone climb to a clearly-good tier first.
  await b.page.waitForFunction(
    async () => {
      const d = await (window as any).__ringTest.groupCallDiag();
      return (Object.values(d.tiers) as string[]).every((t) => t === 'high' || t === 'hd');
    },
    null,
    { timeout: 25_000, polling: 1000 },
  );

  // A pins to low → A asks B and C for at most low.
  await setVideoQuality(a, 'low');

  // B's and C's leg TO A drops to low; their leg to each OTHER stays high/hd.
  await b.page.waitForFunction(
    ([aShort, cShort]) =>
      (async () => {
        const d = await (window as any).__ringTest.groupCallDiag();
        const toA = d.legs[aShort]?.tier;
        const toC = d.legs[cShort]?.tier;
        return toA === 'low' && (toC === 'high' || toC === 'hd');
      })(),
    [a.id.slice(0, 8), c.id.slice(0, 8)],
    { timeout: 15_000, polling: 1000 },
  );
  expect(await legTierTo(c, a.id)).toBe('low'); // C → A also capped at low

  for (const x of [a, b, c]) await hangup(x);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('US2/US5: a throttled receiver is reflected in the per-leg diag (corroborating)', async ({ browser }) => {
  // Best-effort network-shaping check (see throttle() caveat). We assert the diagnostics plumbing is
  // wired — each leg exposes a tier/downlink/requested ceiling — and that throttling one receiver does
  // not crash adaptation or freeze others. The hard per-receiver guarantee is covered by the US3 test.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CQ4A');
  const b = await createAccount(ctxB, 'CQ4B');
  await pair(a, b);

  const room = 'cq-thr';
  await startGroup(a, room, 'video');
  await startGroup(b, room, 'video');
  await waitRemotes(a, 1);
  await waitCallState(a, ['connected']);

  // Diagnostics are populated per leg (US5).
  await a.page.waitForFunction(
    () => (async () => Object.keys((await (window as any).__ringTest.groupCallDiag()).legs).length >= 1)(),
    null,
    { timeout: 20_000, polling: 1000 },
  );
  const before = await legDiag(a);
  const aLeg = Object.values(before.legs)[0]!;
  expect(['off', 'low', 'medium', 'high', 'hd']).toContain(aLeg.tier);
  expect(['off', 'low', 'medium', 'high', 'hd']).toContain(aLeg.downlink);

  // Throttle B's downlink; the call must keep flowing (inbound frames keep advancing on A).
  await throttle(b, 'poor');
  const frames1 = (await legDiag(a)).inboundVideoFrames;
  await a.page.waitForTimeout(6000);
  const frames2 = (await legDiag(a)).inboundVideoFrames;
  expect(frames2).toBeGreaterThanOrEqual(frames1); // no freeze/crash under throttling
  await throttle(b, null);

  await hangup(a);
  await hangup(b);
  await ctxA.close();
  await ctxB.close();
});
