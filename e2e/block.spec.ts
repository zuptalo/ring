import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ev = (p: any, fn: (a: any) => any, arg: any) => p.page.evaluate(fn, arg);
const chatWith = (p: any, id: string) => ev(p, (x) => (window as any).__ringTest.chatWith(x), id);
const bodies = (p: any, chatId: string) =>
  ev(p, async (id) => (await (window as any).__ringTest.messages(id)).map((m: any) => m.body), chatId);

/**
 * Blocking is server-enforced: once A blocks B, the relay drops B's messages to A
 * and refuses B our key bundle (can't re-add). History is kept (read-only).
 * Unblocking resumes delivery.
 */
test('blocking stops delivery + re-adding; unblock resumes', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await createAccount(await browser.newContext(), 'BLOCKTS1');
  const b = await createAccount(await browser.newContext(), 'BLOCKTS2');
  await pair(a, b);

  // Baseline: B → A delivers (and gives A a chat with history).
  const bChat = (await chatWith(b, a.id)) as string;
  await ev(b, (id) => (window as any).__ringTest.sendChatMessage(id, 'before'), bChat);
  await a.page.waitForFunction(
    async (bid) => {
      const id = await (window as any).__ringTest.chatWith(bid);
      if (!id) return false;
      const ms = await (window as any).__ringTest.messages(id);
      return ms.some((m: any) => m.body === 'before');
    },
    b.id,
    { timeout: 30_000 },
  );
  const aChat = (await chatWith(a, b.id)) as string;

  // A blocks B.
  await ev(a, (bid) => (window as any).__ringTest.blockContact(bid), b.id);
  expect(await ev(a, (bid) => (window as any).__ringTest.isPeerBlocked(bid), b.id)).toBe(true);

  // B sends while blocked → A must NOT receive it live (the relay HOLDS it silently).
  await ev(b, (id) => (window as any).__ringTest.sendChatMessage(id, 'while-blocked'), bChat);
  await a.page.waitForTimeout(3000);
  expect(await bodies(a, aChat)).not.toContain('while-blocked');
  expect(await bodies(a, aChat)).toContain('before'); // history kept

  // B can no longer fetch A's bundle → can't re-add A.
  expect(await ev(b, (aid) => (window as any).__ringTest.peerBundleExists(aid), a.id)).toBe(false);

  // A unblocks → the message held during the block flushes on reconnect, and B's
  // next message delivers live again.
  await ev(a, (bid) => (window as any).__ringTest.unblockContact(bid), b.id);
  await ev(a, () => (window as any).__ringTest.forceReconnect());
  await expect.poll(() => bodies(a, aChat), { timeout: 30_000 }).toContain('while-blocked');
  await ev(b, (id) => (window as any).__ringTest.sendChatMessage(id, 'after-unblock'), bChat);
  await expect.poll(() => bodies(a, aChat), { timeout: 30_000 }).toContain('after-unblock');
});
