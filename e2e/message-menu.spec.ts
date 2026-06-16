import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Message gestures (spec 1008): a single tap opens media directly (no menu step) and
 * does nothing on text; the full action menu opens on a LONG-PRESS. Reactions moved to
 * the bottom-row quick-react button (see quick-react.spec.ts). These tests drive real
 * taps + a synthesized long-press, and verify usage-based reordering of the quick set.
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

/** Press-and-hold the center of a locator long enough to trip the 500ms long-press. */
async function longPress(page: any, locator: any): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test('long-press opens the full menu; a plain tap on text does nothing', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MSGMENU1');
  const b = await createAccount(ctxB, 'MSGMENU2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await send(a, aChat, 'hold me');
  const mid = ((await messages(a, aChat)) as any[]).find((m) => m.body === 'hold me').id as string;

  await a.page.goto(`/chat/${aChat}`);
  const bubble = a.page.locator(`.bubble[data-mid="${mid}"]`);
  await bubble.waitFor({ state: 'visible', timeout: 30_000 });

  // A plain tap on a text bubble does nothing (no menu, no viewer).
  await bubble.click();
  await expect(a.page.locator('.ma')).toHaveCount(0);

  // A long-press opens the full action menu with its actions.
  await longPress(a.page, bubble);
  await expect(a.page.locator('.ma')).toBeVisible();
  await expect(a.page.getByText('Reply', { exact: true })).toBeVisible();
  await expect(a.page.getByText('Forward', { exact: true })).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

test('a single tap on an image opens the viewer directly (no menu step)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MSGMENU3');
  const b = await createAccount(ctxB, 'MSGMENU4');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.goto(`/chat/${aChat}`);

  // Paste + send a 1×1 PNG so a real image bubble renders.
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

  // One tap → the viewer opens directly; no action menu appears.
  await image.click();
  await expect(a.page.locator('.viewer-modal')).toBeVisible({ timeout: 10_000 });
  await expect(a.page.locator('.ma')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test('the quick set reorders by usage — a more-used emoji surfaces first', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MSGMENU5');
  const b = await createAccount(ctxB, 'MSGMENU6');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await send(a, aChat, 'react here');
  const mid = ((await messages(a, aChat)) as any[]).find((m) => m.body === 'react here').id as string;

  // Reacting with a custom emoji records a use; it then leads the quick-react order
  // ahead of the zero-use defaults (FR-005).
  const quickFirst = async (): Promise<string> => {
    const q = (await a.page.evaluate(() => (window as any).__ringTest.quickReactEmojis(7))) as string[];
    return q[0];
  };
  expect(await quickFirst()).not.toBe('🔥'); // a fresh account leads with a default
  await a.page.evaluate((id: string) => (window as any).__ringTest.reactToMessage(id, '🔥'), mid);
  await expect.poll(quickFirst).toBe('🔥');

  await ctxA.close();
  await ctxB.close();
});
