import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startGroup, accept, reject, hangup, recall,
  waitCallState, waitRemotes, callState, notJoiningIds, goOffline, goOnline,
  setCallConfig, resetCallConfig,
} from './helpers';

/**
 * Re-invite-after-leaving (spec 0004 US1): a group invitee who dismisses the ring, or who
 * joins and then leaves, must NOT be silently rung back into the call (the original bug, where
 * a buffered invite re-flushed on reconnect). A DELIBERATE recall must still ring them. The
 * reminder cadence is shrunk so "did it re-ring?" resolves in a couple of seconds.
 */

const SHORT = { ringIntervalMs: 400, ringCount: 5 }; // ~2s of reminder rounds

test.beforeEach(async () => {
  await setCallConfig(SHORT);
});
test.afterEach(async () => {
  await resetCallConfig();
});

/** Assert `c` never re-enters the 'incoming' (ringing) state over `ms`. */
async function neverRingsAgain(c: { page: import('@playwright/test').Page }, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const s = await c.page.evaluate(() => (window as any).__ringTest.callState());
    expect(s, 'should not be re-rung').not.toBe('incoming');
    await c.page.waitForTimeout(150);
  }
}

test('a dismissed group invite does not re-ring; a deliberate recall still does', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'REINV1A');
  const b = await createAccount(ctxB, 'REINV1B');
  await pair(a, b);

  const room = 'reinvite-room-1';
  await startGroup(a, room, 'audio', [b.id]);
  await waitCallState(b, ['incoming']);

  // B dismisses the ring. It must not come back round after round.
  await reject(b);
  await waitCallState(b, ['idle', 'ended']);
  await neverRingsAgain(b, 2500); // spans several (400ms) reminder rounds

  // A sees B as a non-joiner (the server's no-answer broadcast). A deliberately recalls B,
  // which SHOULD ring B again — recall is the explicit, allowed re-ring.
  await a.page.waitForFunction(
    (id: string) => (window as any).__ringTest.notJoiningIds().includes(id),
    b.id,
    { timeout: 10_000 },
  );
  await recall(a, b.id);
  await waitCallState(b, ['incoming'], 10_000);

  await reject(b);
  await hangup(a);
  await ctxA.close();
  await ctxB.close();
});

test('a member who joins then leaves is not auto-re-invited, even after a reconnect', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'REINV2A');
  const b = await createAccount(ctxB, 'REINV2B');
  const c = await createAccount(ctxC, 'REINV2C');
  await pair(a, b);
  await pair(a, c);
  await pair(b, c);

  const room = 'reinvite-room-2';
  await startGroup(a, room, 'audio', [b.id, c.id]);
  await waitCallState(b, ['incoming']);
  await waitCallState(c, ['incoming']);
  await accept(b);
  await accept(c);
  await waitRemotes(a, 2); // A meshed with B and C

  // C leaves the call. They must stay out — not be rung back in.
  await hangup(c);
  await waitCallState(c, ['idle', 'ended']);
  await neverRingsAgain(c, 2000);

  // C's socket blips and reconnects (the original bug re-flushed a buffered invite here).
  await goOffline(c);
  await c.page.waitForTimeout(800);
  await goOnline(c);
  await neverRingsAgain(c, 2500);
  expect(await callState(c)).toBe('idle');

  await hangup(a);
  await hangup(b);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
