import { test } from '@playwright/test';
import { createAccount, pair, startGroup, waitRemotes, waitCallState, hangup } from './helpers';

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
