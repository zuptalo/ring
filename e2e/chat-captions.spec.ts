import { test, expect } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 2019 (hotfix) — the shared composer caption applies to EVERY staged attachment
 * that has no per-item caption (album or individual); a per-item caption always wins
 * for its item. Previously an album carried the shared caption on its FIRST item only,
 * so the rest went out silently uncaptioned.
 */

// A tiny decodable PNG pasted as a file (same approach as chat-media-scroll's pasteImage).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function pasteImage(c: RingClient, name: string): Promise<void> {
  const ta = c.page.locator('ion-textarea.composer textarea');
  await ta.click();
  await c.page.evaluate(
    ([b64, fname]) => {
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const file = new File([bytes], fname, { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const el = document.querySelector('ion-textarea.composer textarea') as HTMLTextAreaElement;
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    [PNG_B64, name],
  );
}

test('the composer caption reaches every uncaptioned attachment; a per-item caption wins', async ({ browser }) => {
  test.setTimeout(180_000); // media-heavy UI flow + account-creation invite retries
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CAPBAT01');
  const b = await createAccount(ctxB, 'CAPBAT02');
  await pair(a, b);
  const aChat = (await a.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  await a.page.goto(`/chat/${aChat}`);

  // Stage three images via paste.
  await pasteImage(a, 'one.png');
  await pasteImage(a, 'two.png');
  await pasteImage(a, 'three.png');
  await expect(a.page.locator('.paste-thumb')).toHaveCount(3, { timeout: 10_000 });

  // Give the FIRST item its own caption via the per-item caption modal.
  await a.page.locator('.paste-thumb .paste-tap').first().click();
  const capInput = a.page.locator('.caption-modal ion-textarea textarea');
  await capInput.fill('solo caption');
  await a.page.locator('.caption-modal ion-button', { hasText: 'Save' }).click();
  await expect(a.page.locator('.caption-modal')).toBeHidden({ timeout: 5_000 });

  // Type the shared caption (pressSequentially fires the per-char input events that
  // drive the composer's `draft` ref via onComposerInput) and send.
  const composer = a.page.locator('ion-textarea.composer textarea');
  await composer.click();
  await composer.pressSequentially('shared caption');
  const sendBtn = a.page.getByRole('button', { name: 'Send', exact: true });
  await expect(sendBtn).toBeVisible({ timeout: 10_000 });
  await sendBtn.click();

  // Every image message carries a caption: the per-item one on its item, the shared
  // caption on BOTH remaining items (not just the first — the spec-2019 fix).
  await expect
    .poll(
      async () => {
        const ms = (await a.page.evaluate((id: string) => (window as any).__ringTest.messages(id), aChat)) as any[];
        return ms
          .filter((m) => m.kind === 'image')
          .map((m) => m.body)
          .sort();
      },
      { timeout: 30_000 },
    )
    .toEqual(['shared caption', 'shared caption', 'solo caption']);

  await ctxA.close();
  await ctxB.close();
});
