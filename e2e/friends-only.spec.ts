import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ev = (p: any, fn: (a: any) => any, arg: any) => p.page.evaluate(fn, arg);
const chatWith = (p: any, id: string) => ev(p, (x) => (window as any).__ringTest.chatWith(x), id);
const bodies = async (p: any, id: string): Promise<string[]> => {
  const cid = await chatWith(p, id);
  if (!cid) return [];
  return ev(p, async (c) => (await (window as any).__ringTest.messages(c)).map((m: any) => m.body), cid);
};

/**
 * Messaging is friends-only by design: a message from someone who is neither a contact
 * nor an accepted connection is dropped. C is connected to A only server-side (a one-way
 * link, as a group co-member would be) but is NOT in A's contacts/connected ledger — i.e.
 * "unknown" to A — so A drops C's message until A connects with them. (Call signalling
 * rides a separate path, so this never blocks adding a non-contact to a call.)
 */
test('friends-only: drops a stranger’s message until A connects with them', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'BLKUNK1');
  const c = await createAccount(ctxC, 'BLKUNK2');

  // C reaches A server-side (link makes the bundle fetchable both ways) but A never
  // adds C, so C is "unknown" to A.
  await ev(c, (aid) => (window as any).__ringTest.connectLink(aid), a.id);
  await ev(c, (aid) => (window as any).__ringTest.importDirectoryUser(aid), a.id);
  const cChat = (await ev(c, (aid) => (window as any).__ringTest.startChat(aid), a.id)) as string;
  expect(cChat).toBeTruthy();
  await ev(c, (id) => (window as any).__ringTest.sendChatMessage(id, 'stranger-msg'), cChat);

  // Give it time to (not) arrive, then assert A never stored it.
  await a.page.waitForTimeout(3000);
  expect(await bodies(a, c.id)).not.toContain('stranger-msg');

  // A connects with C (adds them). A new message from C now lands.
  await ev(a, (cid) => (window as any).__ringTest.requestFriend(cid), c.id);
  await ev(c, (id) => (window as any).__ringTest.sendChatMessage(id, 'friend-msg'), cChat);
  await expect.poll(() => bodies(a, c.id), { timeout: 30_000 }).toContain('friend-msg');
  // The previously-blocked message stays gone (it was dropped, not just deferred).
  expect(await bodies(a, c.id)).not.toContain('stranger-msg');

  await ctxA.close();
  await ctxC.close();
});
