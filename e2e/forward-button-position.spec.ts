import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

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
