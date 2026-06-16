import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Friendship gate (spec 0002): you become friends only via request → accept. The
 * directory/key gate is server-enforced; these specs verify the request lifecycle
 * across two accounts — accept makes BOTH sides friends (the requester is imported
 * on the connect-update), an outgoing request can be withdrawn (retracting it from
 * the other inbox), and an incoming request badges the Contacts tab.
 */

const conns = (p: any): Promise<{ incoming: any[]; outgoing: any[] }> =>
  p.page.evaluate(() => (window as any).__ringTest.connections());
const contactIds = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.contactIds());
const incomingFrom = async (p: any): Promise<string[]> => (await conns(p)).incoming.map((r) => r.requester);
const outgoingTo = async (p: any): Promise<string[]> => (await conns(p)).outgoing.map((r) => r.target);

test('friendship: accept makes both friends (requester imported on accept); badge tracks it', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'FRIEND01');
  const b = await createAccount(ctxB, 'FRIEND02');

  // A requests friendship with B.
  await a.page.evaluate((id) => (window as any).__ringTest.connectRequest(id), b.id);

  // B has an incoming request from A; A has an outgoing one to B.
  await expect.poll(() => incomingFrom(b)).toContain(a.id);
  await expect.poll(() => outgoingTo(a)).toContain(b.id);

  // Not friends yet — no local contact on either side (a pending request makes none).
  expect(await contactIds(a)).not.toContain(b.id);
  expect(await contactIds(b)).not.toContain(a.id);

  // B's Contacts-tab badge counts incoming requests in the reactive connections
  // store (useBadges → incomingRequests). The live connect-req push is best-effort,
  // so reconcile B's store the way useSync does on (re)connect, then assert the
  // badge's source of truth shows A's request.
  const bIncoming = async (): Promise<string[]> => {
    await b.page.evaluate(() => (window as any).__ringTest.syncConnections());
    return b.page.evaluate(() => (window as any).__ringTest.incomingRequestIds());
  };
  await expect.poll(bIncoming).toContain(a.id);

  // B accepts → both become friends; A imports B when the connect-update arrives.
  await b.page.evaluate((id) => (window as any).__ringTest.connectAccept(id), a.id);
  await expect.poll(() => contactIds(b)).toContain(a.id);
  await expect.poll(() => contactIds(a)).toContain(b.id);

  // The request leaves both lists, and B's badge clears once answered.
  await expect.poll(() => outgoingTo(a)).not.toContain(b.id);
  await expect.poll(bIncoming).not.toContain(a.id);

  await ctxA.close();
  await ctxB.close();
});

test('friendship: withdrawing an outgoing request retracts it from the other inbox', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'FRIEND03');
  const b = await createAccount(ctxB, 'FRIEND04');

  await a.page.evaluate((id) => (window as any).__ringTest.connectRequest(id), b.id);
  await expect.poll(() => incomingFrom(b)).toContain(a.id);

  // A withdraws → it's gone from B's incoming AND A's outgoing (authoritative,
  // server-side — not just a local removal).
  await a.page.evaluate((id) => (window as any).__ringTest.connectWithdraw(id), b.id);
  await expect.poll(() => incomingFrom(b)).not.toContain(a.id);
  await expect.poll(() => outgoingTo(a)).not.toContain(b.id);

  // Neither is a friend (no contact was ever created for a pending request).
  expect(await contactIds(a)).not.toContain(b.id);
  expect(await contactIds(b)).not.toContain(a.id);

  await ctxA.close();
  await ctxB.close();
});
