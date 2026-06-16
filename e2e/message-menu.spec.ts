import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Message action menu (spec 1004): a single tap anywhere on a bubble — text or the
 * full image/video/album area — opens the unified menu (a horizontally-scrolling
 * quick-react row with an always-visible "+" on top, actions below). These tests
 * drive the real popover via taps, and verify usage-based reordering of the row.
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

test('single tap on a text bubble opens the menu; the emoji row + "+" work', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MSGMENU1');
  const b = await createAccount(ctxB, 'MSGMENU2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await send(a, aChat, 'tap me');
  const mid = ((await messages(a, aChat)) as any[]).find((m) => m.body === 'tap me').id as string;

  await a.page.goto(`/chat/${aChat}`);
  const bubble = a.page.locator(`.bubble[data-mid="${mid}"]`);
  await bubble.waitFor({ state: 'visible', timeout: 30_000 });

  // A single tap opens the action menu (no long-press needed).
  await bubble.click();
  const menu = a.page.locator('.ma');
  await expect(menu).toBeVisible();

  // The reaction row scrolls (its own track) and the trailing "+" is fully visible.
  await expect(a.page.locator('.ma .ma-emoji-track')).toBeVisible();
  await expect(a.page.locator('.ma .ma-more')).toBeVisible();

  // Tapping the first quick emoji applies it as a reaction, then dismisses the menu.
  await a.page.locator('.ma .ma-emoji-track .ma-emoji').first().click();
  await expect(menu).toBeHidden();
  await expect.poll(() => getReactions(a, mid)).not.toEqual([]);

  await ctxA.close();
  await ctxB.close();
});

test('single tap on an image bubble opens the menu with a "View" action', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MSGMENU3');
  const b = await createAccount(ctxB, 'MSGMENU4');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.goto(`/chat/${aChat}`);

  // Paste + send a 1×1 PNG so a real image bubble renders (no precise edge-tapping).
  const composer = a.page.locator('ion-textarea.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  await composer.click();
  await a.page.evaluate(() => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    const ta = document.querySelector('ion-textarea.composer textarea')!;
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await a.page.getByRole('button', { name: 'Send' }).click();
  await a.page.getByText('Original quality').click();

  const image = a.page.locator('.bubble .bubble-image').last();
  await expect(image).toBeVisible({ timeout: 30_000 });

  // Tapping anywhere on the image opens the menu (the whole bubble is the hit
  // target), and the viewer is reachable from there via "View".
  await image.click();
  await expect(a.page.locator('.ma')).toBeVisible();
  await expect(a.page.getByText('View', { exact: true })).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

test('the reaction row reorders by usage — a more-used emoji surfaces first', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MSGMENU5');
  const b = await createAccount(ctxB, 'MSGMENU6');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await send(a, aChat, 'react here');
  const mid = ((await messages(a, aChat)) as any[]).find((m) => m.body === 'react here').id as string;

  // Reacting with a custom (non-default) emoji records a use; it should then lead
  // the quick-react order ahead of the zero-use defaults (FR-006 / SC-005).
  const quickFirst = async (): Promise<string> => {
    const q = (await a.page.evaluate(() => (window as any).__ringTest.quickReactEmojis(12))) as string[];
    return q[0];
  };
  expect(await quickFirst()).not.toBe('🔥'); // a fresh account leads with a default
  await a.page.evaluate((id: string) => (window as any).__ringTest.reactToMessage(id, '🔥'), mid);
  await expect.poll(quickFirst).toBe('🔥');

  await ctxA.close();
  await ctxB.close();
});
