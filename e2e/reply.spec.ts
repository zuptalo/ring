import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

const messages = (p: any, chatId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.messages(id), chatId);

const idOf = async (p: any, chatId: string, body: string): Promise<string> => {
  const ms = await messages(p, chatId);
  return ms.find((m: any) => m.body === body)?.id ?? '';
};

/**
 * Reply: a reply carries a quote (id + author + preview) end-to-end. The peer
 * sees the quote pointing at the original message (its preview + id).
 */
test('reply carries the quoted message to the peer', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGTST9');
  const b = await createAccount(ctxB, 'TESTCOD2');
  await pair(a, b);

  // A sends the original.
  const aChat = await chatWith(a, b.id);
  expect(aChat).toBeTruthy();
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'original'), aChat);
  await expect.poll(() => idOf(a, aChat as string, 'original'), { timeout: 30_000 }).not.toBe('');
  const origId = await idOf(a, aChat as string, 'original');

  // B receives the original (delivery creates B's chat with A).
  await b.page.waitForFunction(
    async (aid) => {
      const id = await (window as any).__ringTest.chatWith(aid);
      if (!id) return false;
      const ms = await (window as any).__ringTest.messages(id);
      return ms.some((m: any) => m.body === 'original');
    },
    a.id,
    { timeout: 30_000 },
  );
  const bChat = await chatWith(b, a.id);
  expect(bChat).toBeTruthy();

  // B replies to A's message.
  await b.page.evaluate(
    (args: [string, string, string]) => (window as any).__ringTest.sendReply(args[0], args[1], args[2]),
    [bChat as string, 'replying', origId],
  );

  // A receives the reply with the quote pointing at the original message.
  await expect
    .poll(
      async () => {
        const ms = await messages(a, aChat);
        return ms.find((m: any) => m.body === 'replying')?.replyTo ?? null;
      },
      { timeout: 30_000 },
    )
    .toMatchObject({ id: origId, preview: 'original' });

  await ctxA.close();
  await ctxB.close();
});
