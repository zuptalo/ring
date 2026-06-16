import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Inline quick-react (spec 1008): each bubble's bottom row has a reaction button that
 * opens a transient popover of the 7 most-used emoji + "+", all visible (no scrolling).
 * Tapping one applies it; the popover auto-dismisses and never lingers after leaving.
 */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);
const send = (p: any, chatId: string, body: string) =>
  p.page.evaluate(
    (args: [string, string]) => (window as any).__ringTest.sendChatMessage(args[0], args[1]),
    [chatId, body] as [string, string],
  );
const messages = (p: any, chatId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.messages(id), chatId);
const getReactions = (p: any, messageId: string): Promise<string[]> =>
  p.page.evaluate(
    (id: string) => (window as any).__ringTest.getReactions(id).then((rs: any[]) => rs.map((r) => r.emoji)),
    messageId,
  );

async function openChatAt(p: any, chatId: string, mid: string) {
  await p.page.goto(`/chat/${chatId}`);
  const bubble = p.page.locator(`.bubble[data-mid="${mid}"]`);
  await bubble.waitFor({ state: 'visible', timeout: 30_000 });
  return bubble;
}

test('the reaction button shows 7 emoji + "+" (all visible) and applies one', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'QREACT1');
  const b = await createAccount(ctxB, 'QREACT2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await send(a, aChat, 'react to me');
  const mid = ((await messages(a, aChat)) as any[]).find((m) => m.body === 'react to me').id as string;
  const bubble = await openChatAt(a, aChat, mid);

  // Tap the bottom-row reaction button → the quick-react popover.
  await bubble.locator('.react-btn').click();
  const bar = a.page.locator('.qr');
  await expect(bar).toBeVisible();

  // 7 emoji + a trailing "+" — and every one is actually visible (no scroll).
  await expect(bar.locator('.qr-emoji:not(.qr-more)')).toHaveCount(7);
  await expect(bar.locator('.qr-more')).toBeVisible();
  for (const e of await bar.locator('.qr-emoji').all()) await expect(e).toBeVisible();

  // Tapping the first emoji applies it and closes the popover.
  await bar.locator('.qr-emoji:not(.qr-more)').first().click();
  await expect(bar).toBeHidden();
  await expect.poll(() => getReactions(a, mid)).not.toEqual([]);

  await ctxA.close();
  await ctxB.close();
});

test('the reaction button hides once the 3-reaction cap is reached', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'QREACT5');
  const b = await createAccount(ctxB, 'QREACT6');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await send(a, aChat, 'cap me');
  const mid = ((await messages(a, aChat)) as any[]).find((m) => m.body === 'cap me').id as string;
  const bubble = await openChatAt(a, aChat, mid);

  // Button is present with room to react.
  await expect(bubble.locator('.react-btn')).toHaveCount(1);

  // Use all 3 allowed reactions → the button disappears for this message.
  for (const e of ['👍', '❤️', '😂']) {
    await a.page.evaluate((args: [string, string]) => (window as any).__ringTest.reactToMessage(args[0], args[1]), [mid, e]);
  }
  await expect(bubble.locator('.react-btn')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test('an open popover is dismissed when leaving the chat', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'QREACT3');
  const b = await createAccount(ctxB, 'QREACT4');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await send(a, aChat, 'leave me');
  const mid = ((await messages(a, aChat)) as any[]).find((m) => m.body === 'leave me').id as string;
  const bubble = await openChatAt(a, aChat, mid);

  await bubble.locator('.react-btn').click();
  await expect(a.page.locator('.qr')).toBeVisible();

  // Leaving the chat dismisses the popover — it must not linger over the previous view.
  await a.page.goBack();
  await expect(a.page.locator('.qr')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
