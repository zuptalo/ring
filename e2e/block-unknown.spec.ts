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
 * "Block unknown account messages" (privacy.blockUnknown): a message from someone
 * who is neither a contact nor an accepted connection is dropped while the toggle is
 * on. C is connected to A only server-side (a one-way link, as a group co-member
 * would be) but is NOT in A's contacts/connected ledger — i.e. "unknown" to A.
 */
test('block unknown: drops a stranger’s message until the toggle is off', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'BLKUNK1');
  const c = await createAccount(ctxC, 'BLKUNK2');

  await ev(a, () => (window as any).__ringTest.setSetting('privacy.blockUnknown', true), null);

  // C reaches A server-side (link makes the bundle fetchable both ways) but A never
  // adds C, so C is "unknown" to A.
  await ev(c, (aid) => (window as any).__ringTest.connectLink(aid), a.id);
  await ev(c, (aid) => (window as any).__ringTest.importDirectoryUser(aid), a.id);
  const cChat = (await ev(c, (aid) => (window as any).__ringTest.startChat(aid), a.id)) as string;
  expect(cChat).toBeTruthy();
  await ev(c, (id) => (window as any).__ringTest.sendChatMessage(id, 'blocked-msg'), cChat);

  // Give it time to (not) arrive, then assert A never stored it.
  await a.page.waitForTimeout(3000);
  expect(await bodies(a, c.id)).not.toContain('blocked-msg');

  // Turn the block off; a new message now lands.
  await ev(a, () => (window as any).__ringTest.setSetting('privacy.blockUnknown', false), null);
  await ev(c, (id) => (window as any).__ringTest.sendChatMessage(id, 'allowed-msg'), cChat);
  await expect.poll(() => bodies(a, c.id), { timeout: 30_000 }).toContain('allowed-msg');
  // The previously-blocked message stays gone (it was dropped, not just deferred).
  expect(await bodies(a, c.id)).not.toContain('blocked-msg');

  await ctxA.close();
  await ctxC.close();
});
