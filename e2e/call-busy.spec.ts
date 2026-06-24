import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, startGroup, accept, hangup,
  waitCallState, waitRemotes, callState, busyMemberIds, resetCallConfig,
} from './helpers';

/**
 * Busy signalling (spec 0004 US2): while you're already in ANY call, a new incoming call —
 * 1:1 or a group invite — is answered with "busy" so the caller learns you're unavailable
 * instead of ringing forever, and your current call is never disturbed.
 */

test.afterEach(async () => {
  await resetCallConfig();
});

test('a second 1:1 call to someone in a call is offered Accept & hold (call waiting), not auto-busy; their call is undisturbed', async ({ browser }) => {
  // Spec 0005 supersedes the old "second 1:1 call = busy": with a held slot free, the callee is
  // offered Accept & hold instead. (Busy now only fires at the two-call cap — see call-waiting.)
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'BUSY1A');
  const b = await createAccount(ctxB, 'BUSY1B');
  const c = await createAccount(ctxC, 'BUSY1C');
  await pair(a, b);
  await pair(a, c);

  // A and B are in a connected 1:1 call.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);

  // C calls A → A is offered Accept & hold (a slot is free), NOT auto-busied.
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });

  // A's call with B is undisturbed (still connected; A's active call never flipped to 'incoming').
  expect(await callState(a)).toBe('connected');
  expect(await callState(b)).toBe('connected');

  await hangup(a);
  await hangup(c);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('a group invite to a busy member resolves to "unavailable" on the caller', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'BUSY2A');
  const b = await createAccount(ctxB, 'BUSY2B');
  const c = await createAccount(ctxC, 'BUSY2C');
  await pair(a, b);
  await pair(a, c);
  await pair(b, c);

  // A and B are in a connected 1:1 call.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);

  // C starts a group call ringing A (who is busy). A should auto-reply busy, so C marks A
  // as unavailable rather than ringing them indefinitely.
  await startGroup(c, 'busy-group-room', 'audio', [a.id]);
  await c.page.waitForFunction(
    (id: string) => (window as any).__ringTest.busyMemberIds().includes(id),
    a.id,
    { timeout: 15_000 },
  );
  expect(await busyMemberIds(c)).toContain(a.id);

  // A's existing call is undisturbed.
  expect(await callState(a)).toBe('connected');

  await hangup(a);
  await hangup(c);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
