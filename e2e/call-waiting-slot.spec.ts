import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, accept, hangup, waitCallState, callState,
  acceptAndHold, hasSecondIncoming,
} from './helpers';

/**
 * Spec 2009 — only ONE caller may occupy the call-waiting slot at a time. While a second call is
 * already ringing/waiting (the Accept & hold prompt is shown, not yet accepted), a further caller
 * must get busy immediately and must NOT steal the waiting caller's place.
 */

test('a further caller cannot steal the call-waiting slot from the one already waiting', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const ctxD = await browser.newContext();
  const a = await createAccount(ctxA, 'CWSA');
  const b = await createAccount(ctxB, 'CWSB');
  const c = await createAccount(ctxC, 'CWSC');
  const d = await createAccount(ctxD, 'CWSD');
  await pair(a, b);
  await pair(a, c);
  await pair(a, d);

  // A and B are on a call.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);

  // C calls A → A shows the Accept & hold (call-waiting) prompt; C is the waiting caller.
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });

  // D calls A while C is still waiting → D MUST get busy and MUST NOT replace C in the prompt.
  await startCall(d, a.id, 'audio');
  await waitCallState(d, ['idle', 'ended'], 15_000); // D is told busy (pre-fix: D steals the slot)
  expect(await hasSecondIncoming(a)).toBe(true); // A still has a pending second call (still C)
  expect(await callState(a)).toBe('connected'); // A↔B undisturbed

  // Accepting the waiting call connects A to C (the original waiter), proving D didn't steal it.
  await acceptAndHold(a);
  await waitCallState(c, ['connected']);
  expect(await callState(c)).toBe('connected');

  await hangup(a);
  await hangup(c).catch(() => {});
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
  await ctxD.close();
});