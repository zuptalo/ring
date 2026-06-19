import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 1012: the hovering "scroll to latest" control. It's hidden at the bottom, fades in once
 * scrolled up, taps to the first unread (or newest), and shows a count badge for incoming
 * messages received while scrolled up. The control is always in the DOM; visibility is the
 * `.jump-hidden` class (opacity fade), so we assert on that.
 */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);
const seed = (p: any, chatId: string, n: number) =>
  p.page.evaluate(({ id, count }: { id: string; count: number }) => (window as any).__ringTest.seedMessages(id, count), {
    id: chatId,
    count: n,
  });

async function scrollMetrics(p: any): Promise<{ top: number; height: number; client: number; dist: number }> {
  return p.page.evaluate(async () => {
    const el = await (document.querySelector('ion-content') as any).getScrollElement();
    return {
      top: el.scrollTop,
      height: el.scrollHeight,
      client: el.clientHeight,
      dist: el.scrollHeight - el.scrollTop - el.clientHeight,
    };
  });
}
async function setScrollTop(p: any, top: number): Promise<void> {
  await p.page.evaluate(async (t: number) => {
    const el = await (document.querySelector('ion-content') as any).getScrollElement();
    el.scrollTop = t;
  }, top);
}
// Scroll up so the viewport sits ~`fromBottomPx` from the bottom (well past the show threshold).
async function scrollUp(p: any, fromBottomPx = 2500): Promise<void> {
  const m = await scrollMetrics(p);
  await setScrollTop(p, Math.max(0, m.height - m.client - fromBottomPx));
  await p.page.waitForTimeout(250);
}
const fab = (p: any) => p.page.locator('.jump-fab');

async function openSeededChat(a: any, b: any, n: number): Promise<string> {
  const aChat = (await chatWith(a, b.id)) as string;
  await seed(a, aChat, n);
  await a.page.goto(`/chat/${aChat}`);
  await expect(a.page.locator('.bubble[data-mid]').first()).toBeVisible({ timeout: 30_000 });
  await a.page.waitForTimeout(400); // let it pin to newest
  return aChat;
}

test('the control is hidden at the bottom, fades in when scrolled up, and taps back to newest (US1)', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'JUMP1A');
  const b = await createAccount(ctxB, 'JUMP1B');
  await pair(a, b);
  await openSeededChat(a, b, 200);

  // B-1: hidden while resting at the newest.
  await expect(fab(a)).toHaveClass(/jump-hidden/);

  // B-2: fades in once scrolled up past the threshold.
  await scrollUp(a, 2500);
  await expect(fab(a)).not.toHaveClass(/jump-hidden/, { timeout: 5000 });

  // B-5: tapping (no unread) returns to the newest and the control hides again.
  await a.page.locator('.jump-fab ion-fab-button').click();
  await expect(fab(a)).toHaveClass(/jump-hidden/, { timeout: 5000 });
  expect((await scrollMetrics(a)).dist).toBeLessThan(120);

  await ctxA.close();
  await ctxB.close();
});

test('a count badge shows incoming messages while scrolled up; tap jumps to the first unread (US2)', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'JUMP2A');
  const b = await createAccount(ctxB, 'JUMP2B');
  await pair(a, b);
  const aChat = await openSeededChat(a, b, 200);
  const bChat = (await chatWith(b, a.id)) as string;

  // Scroll up into history (leaves the bottom → sets the unread boundary).
  await scrollUp(a, 2500);
  await expect(fab(a)).not.toHaveClass(/jump-hidden/, { timeout: 5000 });
  await expect(a.page.locator('.jump-badge')).toHaveCount(0); // nothing new yet

  // B sends 3 messages → the badge counts them (incoming only).
  for (const t of ['unread one', 'unread two', 'unread three']) {
    await b.page.evaluate(({ id, body }: { id: string; body: string }) => (window as any).__ringTest.sendChatMessage(id, body), {
      id: bChat,
      body: t,
    });
  }
  await expect(a.page.locator('.jump-badge')).toHaveText('3', { timeout: 10_000 });

  // Tapping jumps to the first unread message and clears the badge.
  const firstUnread = a.page.locator('.bubble[data-mid]', { hasText: 'unread one' });
  await a.page.locator('.jump-fab ion-fab-button').click();
  await expect(firstUnread).toBeVisible({ timeout: 5000 });
  await expect(a.page.locator('.jump-badge')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
