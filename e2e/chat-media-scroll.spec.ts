import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Chat-history media (spec 1005): the chat resolves media object URLs only for the
 * rendered window (bounded, look-ahead paged), while the full-screen viewer still
 * spans the whole chat's media — it resolves and pins them on open. This guards
 * that opening the viewer after the list only resolved its window still works.
 */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

async function pasteImage(p: any): Promise<void> {
  const composer = p.page.locator('ion-textarea.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  await composer.click();
  await p.page.evaluate(() => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    const ta = document.querySelector('ion-textarea.composer textarea')!;
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await p.page.getByRole('button', { name: 'Send' }).click();
  await p.page.getByText('Original quality').click();
}

test('image renders in the list and the full-screen viewer opens on tap', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MEDSCRL1');
  const b = await createAccount(ctxB, 'MEDSCRL2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.goto(`/chat/${aChat}`);
  await pasteImage(a);

  // The image resolves for the rendered window and shows in the list.
  const image = a.page.locator('.bubble .bubble-image').last();
  await expect(image).toBeVisible({ timeout: 30_000 });

  // Tapping a media bubble opens the action menu (spec 1004); "View" opens the
  // full-screen viewer, which resolves+pins the chat's media on open (spec 1005).
  await image.click();
  await expect(a.page.locator('.ma')).toBeVisible({ timeout: 10_000 });
  await a.page.getByText('View', { exact: true }).click();
  await expect(a.page.locator('.viewer-modal')).toBeVisible({ timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});
