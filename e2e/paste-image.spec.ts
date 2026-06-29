import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

/**
 * Pasting an image into the chat composer (iOS long-press → Paste, desktop
 * Ctrl/Cmd+V) stages it as a thumbnail above the textarea; the text typed below
 * goes out as the photo's caption on Send, and the peer receives image + caption.
 * The paste is synthesized as a real ClipboardEvent carrying a PNG File — the
 * same shape the browser delivers for a native paste.
 */
test('pasted image sends with the typed caption', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'PASTECP1');
  const b = await createAccount(ctxB, 'PASTECP2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  expect(aChat).toBeTruthy();

  // Open the real chat page and paste a 1×1 PNG into the composer.
  await a.page.goto(`/chat/${aChat}`);
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

  // The image stages as a removable thumbnail; the composer asks for a caption.
  await expect(a.page.locator('.paste-thumb img')).toBeVisible({ timeout: 10_000 });
  await expect(composer).toHaveAttribute('placeholder', 'Add a caption');

  // Type the caption below the thumbnail and send. HD-only (spec 1023): there is NO
  // quality picker — the send goes through directly at the HD tier.
  await composer.pressSequentially('From my clipboard', { delay: 15 });
  await a.page.getByRole('button', { name: 'Send' }).click();
  // The old "Send quality" action sheet must not appear anymore.
  await expect(a.page.getByText('Send quality')).toHaveCount(0);

  // Sender side: an image bubble with the caption under the photo, staging row gone.
  await expect(a.page.locator('.bubble .bubble-image').last()).toBeVisible({ timeout: 30_000 });
  await expect(a.page.locator('.bubble .text', { hasText: 'From my clipboard' })).toBeVisible();
  await expect(a.page.locator('.paste-thumb')).toHaveCount(0);

  // Receiver side: the message arrives as an image carrying the caption in body.
  await b.page.waitForFunction(
    async (aid) => {
      const id = await (window as any).__ringTest.chatWith(aid);
      if (!id) return false;
      const ms = await (window as any).__ringTest.messages(id);
      return ms.some((m: any) => m.kind === 'image' && m.body === 'From my clipboard');
    },
    a.id,
    { timeout: 30_000 },
  );

  await ctxA.close();
  await ctxB.close();
});
