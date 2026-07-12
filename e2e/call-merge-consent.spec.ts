import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, accept, hangup, waitCallState, waitRemotes, roster,
  type RingClient,
} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1041 — the consent-gated merge. Merging a waiting caller into the ongoing
// call is now a JOIN REQUEST the caller answers: accept lands them in the room
// with their own media, reject is final for this call (only hold/swap remain),
// and requests are withdrawn when the ongoing call ends. AUDIO only (headless CI
// can't run a 3-person video mesh).

const startDial = (c: RingClient, peer: string): Promise<void> =>
  c.page.evaluate((p: string) => (window as any).__ringTest.startCall(p, 'audio'), peer);
const mergeIncoming = (c: RingClient): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.mergeIncoming());
const hasSecondIncoming = (c: RingClient): Promise<boolean> =>
  c.page.evaluate(() => !!(window as any).__ringTest.hasSecondIncoming());
const joinRequest = (c: RingClient): Promise<{ from: string; roomId: string; roomKind: string } | null> =>
  c.page.evaluate(() => (window as any).__ringTest.joinRequest());
const acceptJoin = (c: RingClient): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.acceptJoinRequest());
const rejectJoin = (c: RingClient): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.rejectJoinRequest());
const canRequestJoin = (c: RingClient, partyId: string): Promise<boolean> =>
  c.page.evaluate((p: string) => (window as any).__ringTest.canRequestJoin(p), partyId);
const joinRequestPending = (c: RingClient, partyId: string): Promise<boolean> =>
  c.page.evaluate((p: string) => (window as any).__ringTest.joinRequestPending(p), partyId);
const isGroup = (c: RingClient): Promise<boolean> =>
  c.page.evaluate(() => !!(window as any).__ringTest.callMeta()?.isGroup);
const callRows = (c: RingClient): Promise<Array<{ contactId: string; missed: boolean }>> =>
  c.page.evaluate(() => (window as any).__ringTest.callRows());

const awaitJoinPrompt = (c: RingClient): Promise<unknown> =>
  c.page.waitForFunction(() => !!(window as any).__ringTest.joinRequest(), null, { timeout: 20_000 });

/** A and B connected 1:1; C dialing A and parked in A's waiting slot. */
async function trioWithWaiting(browser: any, codes: [string, string, string]) {
  const ctx = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [a, b, c] = await Promise.all(codes.map((code, i) => createAccount(ctx[i], code)));
  await pair(a, b); await pair(a, c); await pair(b, c);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);
  await startDial(c, a.id);
  await a.page.waitForFunction(() => !!(window as any).__ringTest.hasSecondIncoming(), null, { timeout: 30_000 });
  return { ctx, a, b, c };
}

test('accepting a join request merges the waiting caller in with their own media (US1)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, a, b, c } = await trioWithWaiting(browser, ['CONS1A', 'CONS1B', 'CONS1C']);

  // A invites C; C sees WHO is asking and the room's kind, and their attempt
  // keeps ringing meanwhile (nothing converted yet — no consent, no join).
  await mergeIncoming(a);
  expect(await joinRequestPending(a, c.id)).toBe(true);
  await awaitJoinPrompt(c);
  const req = await joinRequest(c);
  expect(req?.from).toBe(a.id);
  expect(req?.roomKind).toBe('audio');
  expect(await isGroup(a)).toBe(false); // promote-on-accept, never on request

  // C joins → three-way mesh, everyone in the roster.
  await acceptJoin(c);
  for (const p of [a, b, c]) await waitRemotes(p, 2);
  for (const p of [a, b, c]) {
    const r = await roster(p);
    for (const id of [a.id, b.id, c.id]) expect(r).toContain(id);
  }

  // The dissolved 1:1 attempt left no missed-call artifacts on either side.
  await a.page.waitForTimeout(3500); // let the deferred spec-1040 markers settle
  expect((await callRows(a)).filter((r) => r.contactId === c.id && r.missed)).toEqual([]);
  expect((await callRows(c)).filter((r) => r.contactId === a.id && r.missed)).toEqual([]);

  for (const p of [a, b, c]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});

test('a rejection is final for this call: no re-request, hold/decline unaffected (US2)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, a, b, c } = await trioWithWaiting(browser, ['CONS2A', 'CONS2B', 'CONS2C']);

  await mergeIncoming(a);
  await awaitJoinPrompt(c);
  await rejectJoin(c);

  // A's merge affordance for C disappears for the rest of this call…
  await a.page.waitForFunction(
    (id: string) => !(window as any).__ringTest.canRequestJoin(id) && !(window as any).__ringTest.joinRequestPending(id),
    c.id,
    { timeout: 15_000 },
  );
  // …while C's attempt still waits in A's slot (hold/decline untouched), and
  // C never got pulled into anything.
  expect(await hasSecondIncoming(a)).toBe(true);
  expect(await isGroup(c)).toBe(false);
  await c.page.waitForTimeout(1000);
  expect(await joinRequest(c)).toBeNull();

  // The block dies with the call: a fresh call offers the merge again.
  for (const p of [a, b, c]) await hangup(p);
  await waitCallState(a, ['idle']);
  await waitCallState(b, ['idle']);
  await waitCallState(c, ['idle']);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  expect(await canRequestJoin(a, c.id)).toBe(true);

  await hangup(a);
  await Promise.all(ctx.map((x) => x.close()));
});

test('the ongoing call ending withdraws an outstanding join request (US3)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, a, b, c } = await trioWithWaiting(browser, ['CONS3A', 'CONS3B', 'CONS3C']);

  await mergeIncoming(a);
  await awaitJoinPrompt(c);

  // A's whole call ends with the request pending → C's prompt is withdrawn,
  // and C's own attempt is untouched (still dialing/ringing A).
  await hangup(a);
  await c.page.waitForFunction(() => (window as any).__ringTest.joinRequest() === null, null, { timeout: 15_000 });
  const cState = await c.page.evaluate(() => (window as any).__ringTest.callState());
  expect(['dialing', 'remote-ringing']).toContain(cState);

  for (const p of [b, c]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});

test('the waiting caller hanging up clears the pending request on the callee (US3)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, a, b, c } = await trioWithWaiting(browser, ['CONS4A', 'CONS4B', 'CONS4C']);

  await mergeIncoming(a);
  await awaitJoinPrompt(c);

  // C gives up before deciding → A's prompt and pending request both clear;
  // C could be asked again if they called back (no rejection memory).
  await hangup(c);
  await a.page.waitForFunction(
    (id: string) => !(window as any).__ringTest.hasSecondIncoming() && !(window as any).__ringTest.joinRequestPending(id),
    c.id,
    { timeout: 15_000 },
  );
  expect(await canRequestJoin(a, c.id)).toBe(true);

  for (const p of [a, b]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});
