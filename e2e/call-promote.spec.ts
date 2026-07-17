import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, accept, waitCallState, waitRemotes, roster,
} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1028, US1 — promoting a 1:1 into a group by adding a person. A and B are in
// a 1:1 audio call; A adds C, which promotes the 1:1 into a mesh room (A + B both
// reuse their capture), rings C, and C joins → a three-way audio mesh. AUDIO only
// (headless CI can't run a 3-person video mesh — see call-quality.spec).

const addPeople = (c: any, ids: string[]): Promise<void> =>
  c.page.evaluate((x: string[]) => (window as any).__ringTest.addPeople(x), ids);
const waitIncoming = (c: any): Promise<void> =>
  c.page.waitForFunction(() => (window as any).__ringTest.callState() === 'incoming', null, { timeout: 30_000 });
const isGroup = (c: any): Promise<boolean> =>
  c.page.evaluate(() => !!(window as any).__ringTest.callMeta()?.isGroup);

test('adding a person to a 1:1 promotes it into a group mesh (US1)', async ({ browser }) => {
  test.setTimeout(150_000);
  const a = await createAccount(await browser.newContext(), 'PROMO1');
  const b = await createAccount(await browser.newContext(), 'PROMO2');
  const c = await createAccount(await browser.newContext(), 'PROMO3');
  await pair(a, b); await pair(a, c); await pair(b, c);

  // A and B are in a 1:1 audio call.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);
  expect(await isGroup(a)).toBe(false); // still a 1:1

  // A adds C → the 1:1 promotes to a mesh; B auto-follows; C rings and joins.
  await addPeople(a, [c.id]);
  await waitIncoming(c);
  await accept(c);

  // All three end up in one three-way mesh (each sees the other two).
  for (const p of [a, b, c]) await waitRemotes(p, 2);
  // A and B's calls are now group calls (promoted), and everyone's roster has all three.
  expect(await isGroup(a)).toBe(true);
  expect(await isGroup(b)).toBe(true); // B auto-followed into the room
  for (const p of [a, b, c]) {
    const r = await roster(p);
    for (const id of [a.id, b.id, c.id]) expect(r).toContain(id);
  }
});
