import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, accept, reject, hangup, waitCallState, waitRemotes,
  acceptAndHold, swapCalls, endHeld, heldCallId, isRemoteHeld, hasSecondIncoming,
} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1030, US4 — growing the ACTIVE call never disturbs a separately HELD call
// (FR-009), and a swap can't race a promotion/add mid-conversion (FR-010, the
// add-in-flight guard): the add completes first, so no half-open connection is
// ever parked. AUDIO only (headless CI constraint).

const addPeople = (c: any, ids: string[]): Promise<void> =>
  c.page.evaluate((x: string[]) => (window as any).__ringTest.addPeople(x), ids);
const waitIncoming = (c: any): Promise<void> =>
  c.page.waitForFunction(() => (window as any).__ringTest.callState() === 'incoming', null, { timeout: 30_000 });
const callId = (c: any): Promise<string | undefined> =>
  c.page.evaluate(() => (window as any).__ringTest.callMeta()?.callId);
const isGroup = (c: any): Promise<boolean> =>
  c.page.evaluate(() => !!(window as any).__ringTest.callMeta()?.isGroup);
const rosterOf = (c: any): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.callRoster());
const peerOf = (c: any): Promise<string | undefined> =>
  c.page.evaluate(() => (window as any).__ringTest.callMeta()?.peerUserId);

test('adding to the active call leaves the held call intact and swappable; a swap cannot race the promotion (US4)', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await Promise.all([0, 1, 2, 3, 4].map(() => browser.newContext()));
  const [a, b, c, d, e] = await Promise.all([
    createAccount(ctx[0], 'MHA1'),
    createAccount(ctx[1], 'MHA2'),
    createAccount(ctx[2], 'MHA3'),
    createAccount(ctx[3], 'MHA4'),
    createAccount(ctx[4], 'MHA5'),
  ]);
  await pair(a, b); await pair(a, c); await pair(a, d); await pair(a, e);
  await pair(c, d);

  // Call X: A and B in a 1:1 audio call.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  const xId = await callId(a);

  // C calls A; A accepts & holds → X is HELD (B on hold), active is A↔C.
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => !!(window as any).__ringTest.hasSecondIncoming(), null, { timeout: 30_000 });
  await acceptAndHold(a);
  await waitCallState(c, ['connected']);
  await b.page.waitForFunction(() => (window as any).__ringTest.isRemoteHeld() === true, null, { timeout: 15_000 });
  expect(await heldCallId(a)).toBe(xId);

  // A grows the ACTIVE call (promote A↔C to a room, ring D in). The held X must
  // stay exactly as it is throughout (FR-009).
  await addPeople(a, [d.id]);
  await waitIncoming(d);
  await accept(d);
  for (const p of [a, c, d]) await waitRemotes(p, 2);
  expect(await heldCallId(a)).toBe(xId); // held slot untouched by the add
  expect(await isRemoteHeld(b)).toBe(true); // B is still (only) on hold
  expect(await hasSecondIncoming(a)).toBe(false); // and only ONE call is parked

  // The held call is still swappable: swap back to X…
  await swapCalls(a);
  expect(await callId(a)).toBe(xId);
  expect(await isGroup(a)).toBe(false);
  expect(await peerOf(a)).toBe(b.id);
  await b.page.waitForFunction(() => (window as any).__ringTest.isRemoteHeld() === false, null, { timeout: 15_000 });
  // …and the group is now the (single) held call, its peers seeing A on hold.
  const heldGroupId = await heldCallId(a);
  expect(heldGroupId).not.toBeNull();
  expect(heldGroupId).not.toBe(xId);
  await c.page.waitForFunction(
    (id: string) => ((window as any).__ringTest.groupHeldPeers() as string[]).includes(id),
    a.id, { timeout: 15_000 },
  );

  // FR-010 race: fire an add (which PROMOTES the active 1:1 X — the riskiest
  // conversion) and a swap in the same tick. The guard makes the swap drain the
  // in-flight add first, so nothing half-built is ever parked.
  await a.page.evaluate((eid: string) => Promise.all([
    (window as any).__ringTest.addPeople([eid]),
    (window as any).__ringTest.swapCalls(),
  ]), e.id);
  // The swap landed on the COMPLETED promotion: active is the C+D group again…
  expect(await isGroup(a)).toBe(true);
  const r = await rosterOf(a);
  expect(r).toContain(c.id);
  expect(r).toContain(d.id);
  // …the promoted X' (now a room, with E ringing into it) is the one held call…
  expect(await heldCallId(a)).not.toBeNull();
  expect(await hasSecondIncoming(a)).toBe(false);
  // …and E really was rung by the completed add (no dropped half-open invite).
  await waitIncoming(e);
  await reject(e);

  // Still swappable both ways after the race.
  await swapCalls(a);
  expect(await isGroup(a)).toBe(true); // X' is a room now (B followed the promotion)
  expect(await heldCallId(a)).not.toBeNull();

  await hangup(a);
  for (const p of [b, c, d]) await hangup(p).catch(() => {});
  await endHeld(a).catch(() => {});
  await Promise.all(ctx.map((x) => x.close()));
});
