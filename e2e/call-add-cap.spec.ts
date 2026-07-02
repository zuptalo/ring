import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startGroup, hangup, waitRemotes, remoteStreamCount, roster, callState,
} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1028, US3 — the PRE-EMPTIVE CLIENT cap gate on the add path. We shrink the
// CLIENT caps on the adder's device (setCallCaps, the client analogue of the
// server's call-config override) so a full call needs only 3 contexts. At the cap,
// Add people is blocked BEFORE anyone is rung and the existing call is undisturbed;
// the server's JoinIfRoom refusal (covered by call-caps.spec.ts) stays the backstop.

const remaining = (c: any): Promise<number> =>
  c.page.evaluate(() => (window as any).__ringTest.callRemainingSlots());
const invited = (c: any): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.callInvited());
const addPeople = (c: any, ids: string[]): Promise<void> =>
  c.page.evaluate((x: string[]) => (window as any).__ringTest.addPeople(x), ids);

test('adding past the cap is blocked before ringing; the call is undisturbed (US3)', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const [a, b, c, d] = await Promise.all([
    createAccount(ctx[0], 'ADDCAP1'),
    createAccount(ctx[1], 'ADDCAP2'),
    createAccount(ctx[2], 'ADDCAP3'),
    createAccount(ctx[3], 'ADDCAP4'),
  ]);
  await pair(a, b); await pair(a, c); await pair(a, d);

  // Shrink A's client audio cap to 3 so a 3-person call is "full" for the gate.
  await a.page.evaluate(() => (window as any).__ringTest.setCallCaps(undefined, 3));

  // Fill the 3-seat audio call with A, B, C.
  const room = 'e2e-add-cap';
  await startGroup(a, room, 'audio');
  await startGroup(b, room, 'audio');
  await startGroup(c, room, 'audio');
  for (const p of [a, b, c]) await waitRemotes(p, 2);

  // At the cap: no free slots, and attempting to add D rings nobody.
  expect(await remaining(a)).toBe(0);
  await addPeople(a, [d.id]);
  await a.page.waitForTimeout(1500);
  expect(await invited(a)).not.toContain(d.id); // D was never rung
  expect(await callState(d)).toBe('idle'); // D's device never rang

  // The existing call is undisturbed.
  expect(await callState(a)).toBe('connected');
  expect(await remoteStreamCount(a)).toBe(2);
  expect((await roster(a)).sort()).toEqual([a.id, b.id, c.id].sort());

  // One seat frees up → adding is allowed again.
  await hangup(c);
  await a.page.waitForFunction(() => (window as any).__ringTest.callRemainingSlots() >= 1, null, { timeout: 15_000 });
  expect(await remaining(a)).toBeGreaterThanOrEqual(1);

  for (const p of [a, b, d]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});
