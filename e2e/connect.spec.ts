import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ev = (p: any, fn: (a: any) => any, arg: any) => p.page.evaluate(fn, arg);
const conns = (p: any) => ev(p, () => (window as any).__ringTest.connections(), null);
const search = (p: any, q: string) =>
  ev(p, (s) => (window as any).__ringTest.searchDirectory(s).then((us: any[]) => us.map((u) => u.username)), q);

/**
 * Connect-request lifecycle (the directory-initiated handshake). The gate itself
 * (REQUIRE_CONNECTION) is opt-in and off in the e2e backend; this verifies the
 * request/accept/reject state machine and that reject+block hides you from the
 * requester's directory.
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

  // B accepts -> the incoming request clears (the pair is now connected).
  await ev(b, (id) => (window as any).__ringTest.connectAccept(id), a.id);
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
