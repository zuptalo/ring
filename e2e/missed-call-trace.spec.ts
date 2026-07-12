import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, reject, hangup, accept,
  waitCallState, waitCallLog, callLogCount, chatWith, messages,
  goOffline, goOnline,
} from './helpers';
import type { RingClient } from './helpers';

/**
 * Spec 1040 US2: every missed call leaves a trace — even when the callee's app
 * never witnessed the ring. The caller sends sealed callEvent markers (`ring` at
 * dial, `ended` at outcome) over the messaging relay, so a callee who was
 * offline/closed for the whole attempt still finds the missed-call entry in the
 * 1:1 chat and the Calls tab on next open (FR-013/014/015), while a callee who
 * handled the ring live never gets a duplicate (FR-018).
 */

const callRows = (
  c: RingClient,
): Promise<Array<{ id: string; contactId: string; missed: boolean; seen?: boolean; direction: string }>> =>
  c.page.evaluate(() => (window as any).__ringTest.callRows());

test('a call attempted while the callee was unreachable leaves a missed trace on reconnect', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MISS1A');
  const b = await createAccount(ctxB, 'MISS1B');
  await pair(a, b);

  // B drops off the network — the closed-app stand-in: the relay queues frames.
  await goOffline(b);

  // A dials, gets no reachability sign, and gives up (cancel-before-answer —
  // the clarification says that still logs as a missed call for the callee).
  await startCall(a, b.id, 'audio');
  await waitCallState(a, ['dialing', 'remote-ringing']);
  await a.page.waitForTimeout(1500); // let the dial-time ring marker reach the relay queue
  await hangup(a);
  await waitCallState(a, ['idle', 'ended']);

  // B comes back: the queued markers drain and materialize the trace.
  await goOnline(b);
  await waitCallLog(b, a.id, 15_000);

  // The in-chat row is a MISSED call for B.
  const bChat = await chatWith(b, a.id);
  const row = (await messages(b, bChat)).find((m) => m.kind === 'call') as
    | { callLog?: { missed?: boolean } }
    | undefined;
  expect(row?.callLog?.missed, 'callee trace is a missed call').toBe(true);

  // ...and the Calls tab row exists, missed and unseen (feeds the badge until viewed).
  await expect
    .poll(async () => (await callRows(b)).filter((c) => c.contactId === a.id && c.missed && c.seen === false).length, {
      timeout: 10_000,
    })
    .toBe(1);

  await ctxA.close();
  await ctxB.close();
});

test('a ring the callee declined live never gains a duplicate from the markers', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MISS2A');
  const b = await createAccount(ctxB, 'MISS2B');
  await pair(a, b);

  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await reject(b);
  await waitCallState(a, ['idle', 'ended']);
  await waitCallState(b, ['idle', 'ended']);

  await waitCallLog(b, a.id);
  // Give the outcome marker time to arrive and (correctly) do nothing.
  await b.page.waitForTimeout(2500);
  expect(await callLogCount(b, a.id), 'exactly one chat trace on the callee').toBe(1);
  const rows = (await callRows(b)).filter((c) => c.contactId === a.id);
  expect(rows.length, 'exactly one Calls-tab row on the callee').toBe(1);

  await ctxA.close();
  await ctxB.close();
});

test('a call answered normally leaves no missed artifacts from the markers', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MISS3A');
  const b = await createAccount(ctxB, 'MISS3B');
  await pair(a, b);

  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await hangup(a);
  await waitCallState(b, ['idle', 'ended']);

  await waitCallLog(b, a.id);
  await b.page.waitForTimeout(2500); // let the answered marker settle (it must clear, not log)
  const rows = (await callRows(b)).filter((c) => c.contactId === a.id);
  expect(rows.length, 'one row total').toBe(1);
  expect(rows[0].missed, 'the answered call is not missed').toBe(false);

  await ctxA.close();
  await ctxB.close();
});
