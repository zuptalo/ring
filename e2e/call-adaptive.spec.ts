import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startGroup, waitRemotes, waitCallState, groupDiag,
  setVideoQuality, hangup, resetCallConfig,
} from './helpers';

/**
 * Adaptive per-receiver video quality (spec 0004 US4). The controller starts every leg LOW
 * and climbs as the link allows. Here we verify the CLIMB (it ramps up given localhost
 * headroom) and the MANUAL PIN clamp (a 'low' pin holds it at the floor). The congestion
 * BACK-OFF can't be exercised end-to-end — Chromium's WebRTC bitrate estimator doesn't react
 * to Playwright/CDP network emulation — so that path is covered by the pure-function unit
 * tests in src/services/call/quality.test.ts (nextTier backs off on bandwidth/cpu/loss).
 */

const TIERS = ['off', 'low', 'medium', 'high', 'hd'];
const tierOf = (d: { tiers: Record<string, string> }): string => Object.values(d.tiers)[0] ?? 'off';

test.afterEach(async () => {
  await resetCallConfig();
});

test('a leg starts low and climbs with headroom', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ADAPT1A');
  const b = await createAccount(ctxB, 'ADAPT1B');
  await pair(a, b);

  const room = 'adaptive-climb-room';
  await startGroup(a, room, 'video');
  await startGroup(b, room, 'video');
  await waitRemotes(a, 1);
  await waitCallState(a, ['connected']);

  // It starts at the floor (low), then climbs above it within a few sample cycles. Reaching
  // medium+ at all is the proof of the climb — this resolving IS the assertion (it throws on
  // timeout). We don't re-read after, because headless can momentarily back off on a CPU blip.
  await a.page.waitForFunction(
    async () => {
      const d = await (window as any).__ringTest.groupCallDiag();
      const t = Object.values(d.tiers)[0] as string | undefined;
      return t === 'medium' || t === 'high' || t === 'hd';
    },
    null,
    { timeout: 25_000, polling: 1000 },
  );

  await hangup(a);
  await hangup(b);
  await ctxA.close();
  await ctxB.close();
});

test('a manual "low" pin clamps the leg at the floor (no climb)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ADAPT2A');
  const b = await createAccount(ctxB, 'ADAPT2B');
  await pair(a, b);

  const room = 'adaptive-pin-room';
  await startGroup(a, room, 'video');
  await startGroup(b, room, 'video');
  await waitRemotes(a, 1);
  await waitCallState(a, ['connected']);

  // Pin A's outgoing quality to low — the controller must not climb past it.
  await setVideoQuality(a, 'low');

  // Give it well past several climb cycles; the tier must remain 'low'.
  await a.page.waitForTimeout(12_000);
  expect(tierOf(await groupDiag(a))).toBe('low');

  await hangup(a);
  await hangup(b);
  await ctxA.close();
  await ctxB.close();
});
