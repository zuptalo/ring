import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Message gestures (spec 1008): a single tap on media opens it directly (no menu step);
 * a tap on a text bubble (or the empty/footer area of a media bubble) opens the action
 * menu — no long-press. Reactions moved to the bottom-row quick-react button (see
 * quick-react.spec.ts). These tests drive real taps + verify usage reordering.
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

test('a tap on a text bubble opens the full action menu', async ({ browser }) => {
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

  // A single tap on a text bubble opens the full action menu (no long-press).
  await bubble.click();
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
  // HD-only (spec 1023): no quality picker — the send goes through directly.

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
