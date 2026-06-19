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

const seedUnseen = (p: any, chatId: string, n: number) =>
  p.page.evaluate(({ id, count }: { id: string; count: number }) => (window as any).__ringTest.seedMessages(id, count, { unseen: true }), {
    id: chatId,
    count: n,
  });
const allMsgs = (p: any, chatId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.messages(id), chatId) as Promise<any[]>;
async function statusOf(p: any, chatId: string, body: string): Promise<string | null> {
  return (await allMsgs(p, chatId)).find((m) => m.body === body)?.status ?? null;
}
const setSeenPref = (p: any, on: boolean) =>
  p.page.evaluate(async (v: boolean) => {
    await (window as any).__ringTest.setSetting('privacy.seenReceipts', v);
    await (window as any).__ringTest.applySeenPref();
  }, on);
async function scrollToBottom(p: any): Promise<void> {
  await p.page.evaluate(async () => {
    const el = await (document.querySelector('ion-content') as any).getScrollElement();
    el.scrollTop = el.scrollHeight;
  });
  await p.page.waitForTimeout(400);
}

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

  // Resting at the newest → the control is hidden (spec 1012 behavior, preserved).
  await expect(fab(a)).toHaveClass(/jump-hidden/);

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

test('Seen is sent only for messages actually viewed; off-screen and toggle-off send nothing (US2)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SEEN2A');
  const b = await createAccount(ctxB, 'SEEN2B');
  await pair(a, b);
  const aChat = (await chatWith(a, b.id)) as string;
  const bChat = (await chatWith(b, a.id)) as string;

  // A is in the chat with some already-seen history, scrolled UP so the bottom is off-screen.
  await seed(a, aChat, 60); // seeded ⇒ already seen-reported (pill starts at 0)
  await a.page.goto(`/chat/${aChat}`);
  await expect(a.page.locator('.bubble[data-mid]').first()).toBeVisible({ timeout: 30_000 });
  await a.page.waitForTimeout(400);
  await scrollUp(a, 2500);

  // B sends 3 → they land at A's (off-screen) bottom. They must NOT be reported Seen.
  for (const t of ['off one', 'off two', 'off three']) await send(b, bChat, t);
  await expect(btn(a)).toHaveClass(/jump-btn-pill/, { timeout: 10_000 }); // pill counts them
  await a.page.waitForTimeout(1500); // allow delivery (but they're off-screen → not seen)
  expect(await statusOf(b, bChat, 'off one')).not.toBe('seen');
  expect(await statusOf(b, bChat, 'off three')).not.toBe('seen');

  // Tapping the pill brings the unseen into view → now they ARE reported Seen.
  await btn(a).click();
  await expect.poll(() => statusOf(b, bChat, 'off one'), { timeout: 10_000 }).toBe('seen');
  await expect.poll(() => statusOf(b, bChat, 'off three'), { timeout: 10_000 }).toBe('seen');

  // Privacy toggle OFF → viewing a new message sends nothing (it arrives at the bottom where A is).
  await setSeenPref(a, false);
  await send(b, bChat, 'after off');
  await a.page.waitForTimeout(2000);
  expect(await statusOf(b, bChat, 'after off')).not.toBe('seen');

  // Own (outgoing) messages never carry a seen-reported flag (FR-011).
  await send(a, aChat, 'my own message');
  await a.page.waitForTimeout(500);
  const own = (await allMsgs(a, aChat)).find((m) => m.body === 'my own message');
  expect(own?.outgoing).toBe(true);
  expect(own?.seenReportedAt).toBeNull();

  await ctxA.close();
  await ctxB.close();
});

test('opens at the first unseen, catches up as you read, and persists across reload (US3)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SEEN3A');
  const b = await createAccount(ctxB, 'SEEN3B');
  await pair(a, b);
  const aChat = (await chatWith(a, b.id)) as string;

  // A sizeable UNSEEN backlog (seeded local-only, so it doesn't need the wire for the A-side UX).
  await seedUnseen(a, aChat, 40);
  await a.page.goto(`/chat/${aChat}`);
  await expect(a.page.locator('.bubble[data-mid]').first()).toBeVisible({ timeout: 30_000 });
  await a.page.waitForTimeout(600);

  // Open-at-first-unseen (FR-017): it does NOT land at the bottom, and the pill shows a count.
  await expect(btn(a)).toHaveClass(/jump-btn-pill/, { timeout: 10_000 });
  expect((await scrollMetrics(a)).dist).toBeGreaterThan(300);

  // Read down to the bottom → uniform catch-up reports the whole backlog Seen → pill shrinks to a
  // circle (count 0).
  await scrollToBottom(a);
  await expect(btn(a)).not.toHaveClass(/jump-btn-pill/, { timeout: 10_000 });

  // Persistence (FR-018): reload the app and reopen → the backlog stays Seen (pill is a circle,
  // not re-inflated to the whole history).
  await a.page.reload();
  await a.page.goto(`/chat/${aChat}`);
  await expect(a.page.locator('.bubble[data-mid]').first()).toBeVisible({ timeout: 30_000 });
  await a.page.waitForTimeout(600);
  await expect(btn(a)).not.toHaveClass(/jump-btn-pill/);

  await ctxA.close();
  await ctxB.close();
});
