import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, accept, hangup, waitCallState, connectMarks, recordConnect,
  acceptAndHold, hasSecondIncoming,
} from './helpers';

/**
 * Spec 2008 — make the FIRST call connect as fast as a call-waiting SECOND call.
 *
 * The gate is a DETERMINISTIC ordering/overlap invariant observed via connect milestones (not a
 * flaky wall-clock threshold): the first call must warm TURN off the critical path and not
 * serialize connection setup strictly behind getUserMedia. Time-to-first-media parity is a
 * generous-margin sanity check on top.
 */

test('US1: placing a first call warms TURN without waiting for getUserMedia (caller overlap)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CSP1A');
  const b = await createAccount(ctxB, 'CSP1B');
  await pair(a, b);

  await recordConnect(a, true);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);

  const m = await connectMarks(a);
  // Caller overlap invariant: TURN warming is kicked off before (or at) the gUM call — i.e. it is
  // NOT serialized after getUserMedia inside newPeerConnection (the pre-fix behavior, where there
  // is no warm at all and TURN is fetched only after gUM resolves).
  expect(m.turnWarmStart, 'caller should record a TURN-warm milestone').toBeGreaterThan(0);
  expect(m.gumStart, 'caller should record a gUM-start milestone').toBeGreaterThan(0);
  expect(m.turnWarmStart).toBeLessThanOrEqual(m.gumStart);

  await hangup(a);
  await ctxA.close();
  await ctxB.close();
});

test('US2: answering a first call warms TURN during ring, before accept (callee overlap)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CSP2A');
  const b = await createAccount(ctxB, 'CSP2B');
  await pair(a, b);

  // Record on the CALLEE, before the offer arrives.
  await recordConnect(b, true);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(b, ['connected']);

  const m = await connectMarks(b);
  // Callee overlap invariant: TURN is warmed during the RING (before the user accepts), so accept
  // doesn't pay a cold TURN fetch. Pre-fix there is no ring-time warm and no accept milestone.
  expect(m.turnWarmStart, 'callee should warm TURN on ring').toBeGreaterThan(0);
  expect(m.callStart, 'callee should record the accept milestone').toBeGreaterThan(0);
  expect(m.turnWarmStart).toBeLessThanOrEqual(m.callStart);
  // And the remote description is set as part of the (now-overlapped) accept path.
  expect(m.remoteDescriptionSet, 'callee should record remoteDescriptionSet').toBeGreaterThan(0);

  await hangup(b);
  await ctxA.close();
  await ctxB.close();
});

test('first-call media is prompt and on par with the second (call-waiting) call', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CSP3A');
  const b = await createAccount(ctxB, 'CSP3B');
  const c = await createAccount(ctxC, 'CSP3C');
  await pair(a, b);
  await pair(a, c);

  // Measure on A as the CALLEE both times (accept → first decoded remote media), so first vs
  // second is apples-to-apples on the same device.
  await recordConnect(a, true);

  // FIRST call: B → A, A answers.
  await startCall(b, a.id, 'audio');
  await waitCallState(a, ['incoming']);
  await accept(a);
  await waitCallState(a, ['connected']);
  await a.page.waitForFunction(() => ((window as any).__ringTest.connectMarks().firstRemoteMedia ?? 0) > 0, null, { timeout: 10_000 });
  const first = await connectMarks(a);
  const firstTTFM = first.firstRemoteMedia - first.callStart;
  expect(firstTTFM, 'first-call accept→media').toBeLessThanOrEqual(2000); // SC-002

  // SECOND call (call waiting): C → A, A accept-and-holds → connectSecondDirect (the fast path).
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  expect(await hasSecondIncoming(a)).toBe(true);
  await acceptAndHold(a);
  await waitCallState(a, ['connected']);
  await a.page.waitForFunction(() => ((window as any).__ringTest.connectMarks().firstRemoteMedia ?? 0) > 0, null, { timeout: 10_000 });
  const second = await connectMarks(a);
  const secondTTFM = second.firstRemoteMedia - second.callStart;

  // SC-001 parity (generous margin; the deterministic overlap gates above are the real check).
  expect(firstTTFM, `first ${firstTTFM}ms vs second ${secondTTFM}ms`).toBeLessThanOrEqual(secondTTFM + 1000);

  await hangup(a);
  await hangup(c).catch(() => {});
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
