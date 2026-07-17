import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const emojis = (p: any, messageId: string): Promise<string[]> =>
  p.page.evaluate(
    (id: string) =>
      (window as any).__ringTest.getReactions(id).then((rs: any[]) => rs.map((r) => r.emoji).sort()),
    messageId,
  );

const react = (p: any, messageId: string, emoji: string) =>
  p.page.evaluate(
    (args: [string, string]) => (window as any).__ringTest.reactToMessage(args[0], args[1]),
    [messageId, emoji],
  );

/**
 * 1:1 emoji reactions: they sync to the peer (including reacting to YOUR OWN
 * message), multiple users' reactions coexist, and tapping your emoji again
 * removes it on both sides (toggle-off propagates).
 */
test('1:1 reactions: own-message, both ways, and toggle off', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGTST7');
  const b = await createAccount(ctxB, 'RINGTST8');
  await pair(a, b);

  // A sends a message to B and learns its id (shared by both sides of the chat).
  const aChat = await a.page.evaluate((id) => (window as any).__ringTest.chatWith(id), b.id);
  expect(aChat).toBeTruthy();
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'hi'), aChat);
  const msgId = (await a.page
    .waitForFunction(
      (id) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.find((m) => m.body === 'hi')?.id),
      aChat,
      { timeout: 30_000 },
    )
    .then((h) => h.jsonValue())) as string;

  // Wait until B has actually received the message (delivery creates B's chat).
  await b.page.waitForFunction(
    async (aid) => {
      const id = await (window as any).__ringTest.chatWith(aid);
      if (!id) return false;
      const ms = await (window as any).__ringTest.messages(id);
      return ms.some((m: any) => m.body === 'hi');
    },
    a.id,
    { timeout: 30_000 },
  );

  // A reacts 👍 to its OWN message → B sees 👍.
  await react(a, msgId, '👍');
  await expect.poll(() => emojis(b, msgId), { timeout: 30_000 }).toEqual(['👍']);

  // B reacts ❤️ → A sees both reactions.
  await react(b, msgId, '❤️');
  await expect.poll(() => emojis(a, msgId), { timeout: 30_000 }).toEqual(['❤️', '👍'].sort());

  // A taps 👍 again → toggles off; both sides converge to ❤️ only.
  await react(a, msgId, '👍');
  await expect.poll(() => emojis(a, msgId), { timeout: 30_000 }).toEqual(['❤️']);
  await expect.poll(() => emojis(b, msgId), { timeout: 30_000 }).toEqual(['❤️']);

  await ctxA.close();
  await ctxB.close();
});
