import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ev = (p: any, fn: (a: any) => any, arg: any) => p.page.evaluate(fn, arg);
const chatWith = (p: any, id: string) => ev(p, (x) => (window as any).__ringTest.chatWith(x), id);
const bodies = (p: any, chatId: string) =>
  ev(p, async (id) => (await (window as any).__ringTest.messages(id)).map((m: any) => m.body), chatId);

/**
 * Disappearing messages: turning on a per-chat TTL is shared with the peer (a `ttl`
 * control), the sender stamps an expiry INSIDE the sealed payload, and both sides
 * sweep it once the timer elapses, so the message vanishes for everyone. A message
 * sent BEFORE the TTL was set has no expiry and stays.
 */
test('disappearing messages: TTL syncs to the peer and both sides sweep', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'TTLTEST1');
  const b = await createAccount(ctxB, 'TTLTEST2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  // A message sent before any TTL → permanent (control case).
  await ev(a, (id) => (window as any).__ringTest.sendChatMessage(id, 'keep'), aChat);
  await b.page.waitForFunction(
    async (aid) => {
      const id = await (window as any).__ringTest.chatWith(aid);
      if (!id) return false;
      const ms = await (window as any).__ringTest.messages(id);
      return ms.some((m: any) => m.body === 'keep');
    },
    a.id,
    { timeout: 30_000 },
  );
  const bChat = (await chatWith(b, a.id)) as string;

  // A turns on a short TTL; B must adopt it via the ttl control.
  await ev(a, (id) => (window as any).__ringTest.setChatTtl(id, 3000), aChat);
  await expect
    .poll(() => ev(b, (id) => (window as any).__ringTest.chatTtl(id), bChat), { timeout: 30_000 })
    .toBe(3000);

  // A sends a disappearing message; both sides see it first.
  await ev(a, (id) => (window as any).__ringTest.sendChatMessage(id, 'vanishes'), aChat);
  await expect.poll(() => bodies(b, bChat), { timeout: 30_000 }).toContain('vanishes');
  expect(await bodies(a, aChat)).toContain('vanishes');

  // After the timer + a sweep, it's gone on BOTH sides; 'keep' (no TTL) stays.
  await a.page.waitForTimeout(3500);
  await ev(a, () => (window as any).__ringTest.sweepExpired(), null);
  await ev(b, () => (window as any).__ringTest.sweepExpired(), null);
  await expect.poll(() => bodies(a, aChat), { timeout: 10_000 }).not.toContain('vanishes');
  await expect.poll(() => bodies(b, bChat), { timeout: 10_000 }).not.toContain('vanishes');
  expect(await bodies(a, aChat)).toContain('keep');
  expect(await bodies(b, bChat)).toContain('keep');
});

/**
 * Default message timer (privacy.messageTimer): turning it on makes every NEW 1:1
 * chat you start begin with disappearing messages set to that duration. Existing
 * chats are untouched; this pins the inheritance on a freshly-created chat.
 */
test('default message timer: a new 1:1 chat inherits privacy.messageTimer', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'TTLDEF1');
  const b = await createAccount(ctxB, 'TTLDEF2');

  // Turn the default on BEFORE the chat is created (pair() starts the chat at its end).
  await ev(a, () => (window as any).__ringTest.setSetting('privacy.messageTimer', '24h'), null);
  await pair(a, b);

  const DAY = 24 * 60 * 60 * 1000;
  const aChat = (await chatWith(a, b.id)) as string;
  expect(aChat).toBeTruthy();
  expect(await ev(a, (id: string) => (window as any).__ringTest.chatTtl(id), aChat)).toBe(DAY);

  await ctxA.close();
  await ctxB.close();
});
