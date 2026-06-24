import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, startGroup, accept, hangup, waitCallState, waitRemotes,
  remoteTracks, callState, acceptAndHold, hasSecondIncoming, canHoldIncoming, heldCallId,
  isRemoteHeld, groupHeldPeers, resetCallConfig,
} from './helpers';

/**
 * Call waiting — US1 (spec 0005): take a second call without losing the first. Accepting a
 * second incoming call holds the current one (media paused both ways, "on hold" shown to the
 * other side) and connects the new one. Covers 1:1↔1:1 and holding a GROUP for a 1:1.
 */

test.afterEach(async () => {
  await resetCallConfig();
});

test('accepting a second 1:1 call holds the first (paused both ways, peer sees on hold)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CW1A');
  const b = await createAccount(ctxB, 'CW1B');
  const c = await createAccount(ctxC, 'CW1C');
  await pair(a, b);
  await pair(a, c);

  // A and B are in a connected 1:1 call.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);

  // C calls A → A is offered Accept & hold (a slot is free), not busy.
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  expect(await canHoldIncoming(a)).toBe(true);

  // A accepts-and-holds: the A↔B call is held; A↔C connects live.
  await acceptAndHold(a);
  await waitCallState(a, ['connected']); // now active on A↔C
  await waitCallState(c, ['connected']);
  expect(await remoteTracks(a)).toBeGreaterThan(0); // live media with C
  expect(await heldCallId(a)).not.toBeNull(); // A↔B parked in the held slot

  // B sees the call on hold (the held peer's "on hold" indication).
  await b.page.waitForFunction(() => (window as any).__ringTest.isRemoteHeld() === true, null, { timeout: 10_000 });
  expect(await isRemoteHeld(b)).toBe(true);

  await hangup(a);
  await hangup(c);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('holding a GROUP call to take a 1:1 leaves the other members talking; they see the holder on hold', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const ctxD = await browser.newContext();
  const a = await createAccount(ctxA, 'CW2A');
  const b = await createAccount(ctxB, 'CW2B');
  const c = await createAccount(ctxC, 'CW2C');
  const d = await createAccount(ctxD, 'CW2D');
  for (const [x, y] of [[a, b], [a, c], [b, c], [a, d]] as const) await pair(x, y);

  // A, B, C in a group call (mesh).
  const room = 'cw-group-room';
  await startGroup(a, room, 'audio');
  await startGroup(b, room, 'audio');
  await startGroup(c, room, 'audio');
  for (const x of [a, b, c]) await waitRemotes(x, 2);

  // D calls A 1:1 → A accepts-and-holds the GROUP.
  await startCall(d, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  await acceptAndHold(a);
  await waitCallState(a, ['connected']); // A↔D active
  await waitCallState(d, ['connected']);
  expect(await heldCallId(a)).toBe(room); // the group is held

  // B and C still see each other (mesh intact) and see A "on hold".
  for (const x of [b, c]) {
    expect(await callState(x)).toBe('connected');
    expect(await remoteTracks(x)).toBeGreaterThan(0);
    await x.page.waitForFunction(
      (id: string) => (window as any).__ringTest.groupHeldPeers().includes(id),
      a.id,
      { timeout: 10_000 },
    );
  }

  await hangup(a);
  await hangup(d);
  for (const x of [b, c]) await hangup(x);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
  await ctxD.close();
});
