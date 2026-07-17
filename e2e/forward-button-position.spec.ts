import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

// A 1×1 PNG for the composer's picker (same bytes the caption tests use).
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);
const pngFile = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from(PNG) });
const photoInput = (p: any) => p.page.locator('input[type="file"][multiple]');

/**
 * Spec 2028 regression: the quick-forward button beside incoming media must anchor
 * to the BOTTOM edge of the message column. With the old `align-self: center` it
 * floated vertically centered — roughly half the image height above the caption on
 * a tall portrait photo (the user-reported "forward icon in wrong position").
 */
test('quick-forward button aligns with the bottom edge of a tall media message', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'FWDPOSA1');
  const b = await createAccount(ctxB, 'FWDPOSB1');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  expect(aChat).toBeTruthy();

  // A sends a PORTRAIT image — tall enough that centered-vs-bottom differ by far
  // more than the assertion tolerance once rendered in the bubble.
  await a.page.evaluate((id) => (window as any).__ringTest.sendImage(id, 720, 1280), aChat);

  // B opens the chat and waits for the media bubble and its floating forward button.
  const bChat = (await chatWith(b, a.id)) as string;
  await b.page.goto(`/chat/${bChat}`);
  const fwd = b.page.locator('.fwd-float').first();
  await expect(fwd).toBeVisible({ timeout: 30_000 });

  // The button must hug the bottom of the message column it accompanies. Compare
  // bottom edges of the button and its sibling bubble column within the same row.
  const delta = await b.page.evaluate(() => {
    const btn = document.querySelector('.fwd-float') as HTMLElement;
    const col = btn?.closest('.bubble-row')?.querySelector('.bubble-col') as HTMLElement;
    if (!btn || !col) return null;
    return Math.abs(btn.getBoundingClientRect().bottom - col.getBoundingClientRect().bottom);
  });
  expect(delta).not.toBeNull();
  // Old CSS centers the button: delta ≈ half the rendered media height (hundreds of px).
  expect(delta as number).toBeLessThanOrEqual(8);

  await ctxA.close();
  await ctxB.close();
});

/**
 * The horizontal half of the same bug: a LONG caption's unwrapped line inflates the
 * bubble COLUMN's intrinsic max-content toward its 78% cap (spec 2027 capped the
 * bubble's used width with max-width, which does NOT cap the intrinsic size), so the
 * forward button — which follows the column — trailed ~100px away from the visible
 * bubble. It must hug the bubble's edge, caption or not.
 */
test('quick-forward button hugs a captioned photo horizontally', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'FWDCAPA1');
  const b = await createAccount(ctxB, 'FWDCAPB1');
  await pair(a, b);

  // A sends a photo with a caption whose single-line width far exceeds the media frame.
  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.goto(`/chat/${aChat}`);
  const composer = a.page.locator('ion-textarea.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  await photoInput(a).setInputFiles([pngFile('wide-caption.png')]);
  await expect(a.page.locator('.paste-thumb img')).toBeVisible({ timeout: 10_000 });
  await composer.click();
  await composer.pressSequentially(
    'a genuinely long caption that would stretch the media bubble far past the photo frame',
    { delay: 5 },
  );
  await a.page.getByRole('button', { name: 'Send' }).click();

  // B receives it: the forward button must sit just past the bubble's inline edge.
  const bChat = (await chatWith(b, a.id)) as string;
  await b.page.goto(`/chat/${bChat}`);
  const fwd = b.page.locator('.fwd-float').first();
  await expect(fwd).toBeVisible({ timeout: 30_000 });
  const gap = await b.page.evaluate(() => {
    const btn = document.querySelector('.fwd-float') as HTMLElement;
    const bubble = btn?.closest('.bubble-row')?.querySelector('.bubble') as HTMLElement;
    if (!btn || !bubble) return null;
    return btn.getBoundingClientRect().left - bubble.getBoundingClientRect().right;
  });
  expect(gap).not.toBeNull();
  // margin-inline-start is 8px; allow a little slack. The bug put this at 100px+.
  expect(gap as number).toBeLessThanOrEqual(16);

  await ctxA.close();
  await ctxB.close();
});
