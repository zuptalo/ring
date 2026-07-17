import { test, expect } from '@playwright/test';
import { createAccount, noticeBodies } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ev = (p: any, fn: (a: any) => any, arg: any) => p.page.evaluate(fn, arg);
const conns = (p: any) => ev(p, () => (window as any).__ringTest.connections(), null);
const search = (p: any, q: string) =>
  ev(p, (s) => (window as any).__ringTest.searchDirectory(s).then((us: any[]) => us.map((u) => u.username)), q);

/**
 * Connect-request lifecycle (the directory-initiated handshake) AND that the gate is
 * actually enforced: a peer's prekey bundle is NOT fetchable before they accept, and
 * IS after. Also verifies reject+block hides you from the requester's directory.
 */
test('connect requests: request -> accept, and reject+block hides from directory', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CONNTST1');
  const b = await createAccount(ctxB, 'CONNTST2');
  const c = await createAccount(ctxC, 'CONNTST3');

  // A requests B -> B sees an incoming pending request from A.
  expect(await ev(a, (id) => (window as any).__ringTest.connectRequest(id), b.id)).toBe('pending');
  await expect
    .poll(async () => (await conns(b)).incoming.map((r: any) => r.requester), { timeout: 20_000 })
    .toContain(a.id);

  // GATE ENFORCED: before B accepts, A cannot fetch B's prekey bundle.
  expect(await ev(a, (id) => (window as any).__ringTest.peerBundleExists(id), b.id)).toBe(false);

  // B accepts -> the incoming request clears (the pair is now connected).
  await ev(b, (id) => (window as any).__ringTest.connectAccept(id), a.id);

  // GATE: now connected, A CAN fetch B's bundle.
  await expect
    .poll(() => ev(a, (id) => (window as any).__ringTest.peerBundleExists(id), b.id), { timeout: 20_000 })
    .toBe(true);
  await expect
    .poll(async () => (await conns(b)).incoming.map((r: any) => r.requester), { timeout: 20_000 })
    .not.toContain(a.id);

  // C requests B; B rejects + blocks -> C's outgoing shows 'rejected', and C can no
  // longer find B in the directory (the block hides B from C).
  const bUsername = (await ev(b, () => (window as any).__ringTest.selfUsername(), null)) as string;
  await expect.poll(() => search(c, bUsername), { timeout: 20_000 }).toContain(bUsername); // visible before
  await ev(c, (id) => (window as any).__ringTest.connectRequest(id), b.id);
  await expect
    .poll(async () => (await conns(b)).incoming.map((r: any) => r.requester), { timeout: 20_000 })
    .toContain(c.id);
  await ev(b, (id) => (window as any).__ringTest.connectReject(id, true), c.id);

  await expect
    .poll(async () => (await conns(c)).outgoing.find((r: any) => r.target === b.id)?.state, { timeout: 20_000 })
    .toBe('rejected');
  await expect.poll(() => search(c, bUsername), { timeout: 20_000 }).not.toContain(bUsername); // hidden after
});

/**
 * Spec 1015 (US2 / FR-009, FR-020): the original requester is notified of the
 * outcome of their friend request. Verifies the live in-app path — B accepts A's
 * request and A (app open) gets an "accepted your friend request" in-app banner.
 */
test('friend-request outcome notifies the requester (accepted)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CONNNOT1');
  const b = await createAccount(ctxB, 'CONNNOT2');
  await ev(b, ([n]) => (window as any).__ringTest.setProfile(n, ''), ['Bob']);

  // A requests B → pending.
  expect(await ev(a, (id) => (window as any).__ringTest.connectRequest(id), b.id)).toBe('pending');

  // B accepts → A receives a live connect-update(accepted) and surfaces an in-app
  // banner naming the (now-known) peer with the outcome.
  await ev(b, (id) => (window as any).__ringTest.connectAccept(id), a.id);

  await expect
    .poll(() => noticeBodies(a), { timeout: 20_000 })
    .toContain('accepted your friend request');

  await ctxA.close();
  await ctxB.close();
});
