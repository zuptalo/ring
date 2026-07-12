import { test, expect } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1041, US4 — call-tile avatars stay CIRCULAR through join/leave
// transitions. The bug: UserAvatar's internal height:100% survived
// .tile-avatar's width-only override, so with both dimensions set,
// aspect-ratio:1 was ignored and border-radius:50% drew a 34%-wide,
// tile-tall ellipse (see specs/1041-merge-waiting-caller/avatar-stretch.png).
// An audio group call renders every remote tile camera-off → avatar tiles.

const round = async (c: RingClient, label: string): Promise<void> => {
  const tiles = c.page.locator('.tile-avatar');
  const n = await tiles.count();
  expect(n, `${label}: at least one avatar tile`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const box = await tiles.nth(i).boundingBox();
    if (!box) continue; // mid-transition detach — the next sample covers it
    expect(Math.abs(box.width - box.height), `${label}: tile ${i} is ${box.width}x${box.height}`).toBeLessThanOrEqual(2);
  }
};

test('avatars measure circular in a group call, including during a leave transition', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [a, b, c] = await Promise.all(['AVSH1', 'AVSH2', 'AVSH3'].map((code, i) => createAccount(ctx[i], code)));
  await pair(a, b); await pair(a, c); await pair(b, c);

  const room = 'e2e-avatar-room';
  for (const p of [a, b, c]) {
    await p.page.evaluate((r) => (window as any).__ringTest.startGroup(r, 'audio'), room);
  }
  for (const p of [a, b, c]) {
    await p.page.waitForFunction(() => (window as any).__ringTest.remoteStreamCount() >= 2, null, { timeout: 60_000 });
  }

  // Steady state: every camera-off tile's avatar is a circle.
  await a.page.waitForSelector('.tile-avatar', { timeout: 15_000 });
  await round(a, 'steady');

  // C leaves → its tile lingers with the waving-hand goodbye (the exact surface
  // of the reported stretch). Sample through the animation window.
  await c.page.evaluate(() => (window as any).__ringTest.hangup());
  for (let i = 0; i < 4; i++) {
    await a.page.waitForTimeout(600);
    await round(a, `leave sample ${i}`);
  }

  for (const p of [a, b]) await p.page.evaluate(() => (window as any).__ringTest.hangup());
  await Promise.all(ctx.map((x) => x.close()));
});
