import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 1013: the scroll-to-latest control becomes an EXPANDING PILL (circle when caught up →
 * stadium with the count inline when behind), and "Seen" receipts become visibility-driven.
 * This file grows by user story: US1 (the pill) first; US2/US3 (visibility Seen + catch-up)
 * append later. The control is always in the DOM; `.jump-hidden` is the fade, `.jump-btn-pill`
 * is the expanded (count ≥ 1) shape, and the inline count is `.jump-count`.
 */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);
const seed = (p: any, chatId: string, n: number) =>
  p.page.evaluate(({ id, count }: { id: string; count: number }) => (window as any).__ringTest.seedMessages(id, count), {
    id: chatId,
    count: n,
  });
const send = (p: any, chatId: string, body: string) =>
  p.page.evaluate(({ id, b }: { id: string; b: string }) => (window as any).__ringTest.sendChatMessage(id, b), {
    id: chatId,
    b: body,
  });

async function scrollMetrics(p: any): Promise<{ height: number; client: number; dist: number }> {
  return p.page.evaluate(async () => {
    const el = await (document.querySelector('ion-content') as any).getScrollElement();
    return { height: el.scrollHeight, client: el.clientHeight, dist: el.scrollHeight - el.scrollTop - el.clientHeight };
  });
}
async function scrollUp(p: any, fromBottomPx = 2500): Promise<void> {
  const m = await scrollMetrics(p);
  await p.page.evaluate(async (t: number) => {
    const el = await (document.querySelector('ion-content') as any).getScrollElement();
    el.scrollTop = t;
  }, Math.max(0, m.height - m.client - fromBottomPx));
  await p.page.waitForTimeout(250);
}
const fab = (p: any) => p.page.locator('.jump-fab');
const btn = (p: any) => p.page.locator('.jump-btn');

async function openSeededChat(a: any, b: any, n: number): Promise<string> {
  const aChat = (await chatWith(a, b.id)) as string;
  await seed(a, aChat, n);
  await a.page.goto(`/chat/${aChat}`);
  await expect(a.page.locator('.bubble[data-mid]').first()).toBeVisible({ timeout: 30_000 });
  await a.page.waitForTimeout(400); // let it pin to newest
  return aChat;
}

test('the control is a circle when caught up and an inline-count pill when behind (US1)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'PILL1A');
  const b = await createAccount(ctxB, 'PILL1B');
  await pair(a, b);
  await openSeededChat(a, b, 200);
  const bChat = (await chatWith(b, a.id)) as string;

  // Scrolled up, nothing new → the control is shown but is a plain circle (no pill, no count).
  await scrollUp(a, 2500);
  await expect(fab(a)).not.toHaveClass(/jump-hidden/, { timeout: 5000 });
  await expect(btn(a)).not.toHaveClass(/jump-btn-pill/);

  // Peer sends 3 → the control becomes a pill showing the inline count "3".
  for (const t of ['pill one', 'pill two', 'pill three']) await send(b, bChat, t);
  await expect(btn(a)).toHaveClass(/jump-btn-pill/, { timeout: 10_000 });
  await expect(a.page.locator('.jump-count')).toHaveText('3', { timeout: 10_000 });

  // Tapping jumps to the first message to catch up on (1012 behavior) and the count clears, so
  // the pill shrinks back to a circle.
  const firstUnread = a.page.locator('.bubble[data-mid]', { hasText: 'pill one' });
  await btn(a).click();
  await expect(firstUnread).toBeVisible({ timeout: 5000 });
  await expect(btn(a)).not.toHaveClass(/jump-btn-pill/, { timeout: 5000 });

  await ctxA.close();
  await ctxB.close();
});
