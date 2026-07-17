import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

/**
 * Bidi: the composer and message bubbles resolve their direction from the text itself
 * (dir="auto" / unicode-bidi:plaintext), so a Persian/Arabic/Hebrew entry flows
 * right-to-left and an English one left-to-right — including a mix, by first strong char.
 */
test('composer and bubbles are direction-aware (RTL / LTR)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'BIDITST1');
  const b = await createAccount(ctxB, 'BIDITST2');
  await pair(a, b);
  const aChat = (await chatWith(a, b.id)) as string;
  expect(aChat).toBeTruthy();

  await a.page.goto(`/chat/${aChat}`);
  const composer = a.page.locator('ion-textarea.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });

  // The native textarea carries dir="auto" (Ionic doesn't forward it; we set it on mount).
  await expect(composer).toHaveAttribute('dir', 'auto');
  const composerDir = () => composer.evaluate((el) => getComputedStyle(el).direction);

  // Persian content → the editor resolves right-to-left.
  await composer.click();
  await composer.pressSequentially('سلام دوست من', { delay: 10 });
  expect(await composerDir()).toBe('rtl');

  // Replace with English → left-to-right.
  await composer.fill('');
  await composer.pressSequentially('hello my friend', { delay: 10 });
  expect(await composerDir()).toBe('ltr');

  // Send one RTL message and one LTR message; each bubble renders in its own direction.
  await composer.fill('');
  await composer.pressSequentially('سلام', { delay: 10 });
  await a.page.getByRole('button', { name: 'Send' }).click();
  await composer.pressSequentially('hello', { delay: 10 });
  await a.page.getByRole('button', { name: 'Send' }).click();

  const rtlBubble = a.page.locator('.bubble .text', { hasText: 'سلام' }).last();
  const ltrBubble = a.page.locator('.bubble .text', { hasText: 'hello' }).last();
  await expect(rtlBubble).toBeVisible({ timeout: 30_000 });
  await expect(ltrBubble).toBeVisible({ timeout: 30_000 });
  expect(await rtlBubble.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  expect(await ltrBubble.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');

  await ctxA.close();
  await ctxB.close();
});
