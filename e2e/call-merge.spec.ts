import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, accept, waitCallState, waitRemotes, roster,
} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1028, US1 — merge an incoming caller INTO the current call. A and B are in a
// 1:1 audio call; C calls A; A taps "Add to call", which promotes A+B into a mesh
// and rings C into it → a three-way audio mesh. The alternative (Accept & hold) is
// unaffected. AUDIO only (headless CI can't run a 3-person video mesh).

const startDial = (c: any, peer: string): Promise<void> =>
  c.page.evaluate((p: string) => (window as any).__ringTest.startCall(p, 'audio'), peer);
const mergeIncoming = (c: any): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.mergeIncoming());
const isGroup = (c: any): Promise<boolean> =>
  c.page.evaluate(() => !!(window as any).__ringTest.callMeta()?.isGroup);

test('merging an incoming caller into a 1:1 makes a three-way call (US1)', async ({ browser }) => {
  test.setTimeout(150_000);
  const a = await createAccount(await browser.newContext(), 'MERGE1');
  const b = await createAccount(await browser.newContext(), 'MERGE2');
  const c = await createAccount(await browser.newContext(), 'MERGE3');
  await pair(a, b); await pair(a, c); await pair(b, c);

  // A and B in a 1:1 audio call.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);

  // C calls A → A gets a second-incoming (call-waiting) slot.
  await startDial(c, a.id);
  await a.page.waitForFunction(
    () => !!(window as any).__ringTest.hasSecondIncoming(),
    null,
    { timeout: 30_000 },
  );

  // A merges C into the call → promote A+B, ring C in.
  await mergeIncoming(a);

  // All three end up meshed; A and B are now group calls.
  for (const p of [a, b, c]) await waitRemotes(p, 2);
  expect(await isGroup(a)).toBe(true);
  expect(await isGroup(b)).toBe(true);
  for (const p of [a, b, c]) {
    const r = await roster(p);
    for (const id of [a.id, b.id, c.id]) expect(r).toContain(id);
  }
});
