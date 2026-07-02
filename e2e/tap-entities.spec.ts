import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1029 — a phone number and an email in a received message render as tappable
// entities; tapping opens the OS-handoff action sheet; Copy places the value on the
// clipboard (native tel:/sms:/mailto: launch itself isn't invocable headless, so we
// assert the rendered hrefs + the action menu + the copy confirmation).

test('phone + email in a message render tappable with the right actions (US1/US2)', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await createAccount(await browser.newContext(), 'ENT01');
  // B reads/writes the clipboard to verify Copy (headless needs the grant).
  const ctxB = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const b = await createAccount(ctxB, 'ENT02');
  await pair(a, b);

  // A sends B a message containing a phone number and an email.
  const body = 'reach me on +1 415 555 0134 or hi@example.com anytime';
  const aChat = await a.page.evaluate((peer) => (window as any).__ringTest.startChat(peer), b.id);
  await a.page.evaluate(([c, t]) => (window as any).__ringTest.sendChatMessage(c, t), [aChat, body] as const);

  // B opens the chat and waits for the message to arrive + render.
  const bChat = await b.page.evaluate((peer) => (window as any).__ringTest.chatWith(peer), a.id);
  await b.page.goto(`/chat/${bChat}`);
  await b.page.waitForFunction(() => (window as any).__ringTest?.isUnlocked() === true, null, { timeout: 30_000 });

  const phone = b.page.locator('a.msg-link[href^="tel:"]');
  const email = b.page.locator('a.msg-link[href^="mailto:"]');
  await expect(phone).toBeVisible({ timeout: 20_000 });
  await expect(email).toBeVisible();
  // Normalized hand-off targets.
  await expect(phone).toHaveAttribute('href', 'tel:+14155550134');
  await expect(email).toHaveAttribute('href', 'mailto:hi@example.com');
  // The visible text is the number/address as written.
  await expect(phone).toHaveText('+1 415 555 0134');
  await expect(email).toHaveText('hi@example.com');

  // Tapping the phone opens the action sheet with Call / Message / Copy.
  await phone.click();
  const sheet = b.page.locator('ion-action-sheet');
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  for (const label of ['Call', 'Message', 'Copy']) {
    await expect(sheet.locator('.action-sheet-button', { hasText: label })).toBeVisible();
  }

  // Copy places the raw number on the clipboard.
  await sheet.locator('.action-sheet-button', { hasText: 'Copy' }).click();
  await expect
    .poll(() => b.page.evaluate(() => navigator.clipboard.readText()), { timeout: 8_000 })
    .toBe('+1 415 555 0134');
  await expect(b.page.locator('ion-action-sheet')).toHaveCount(0); // dismissed before the next tap

  // The email offers Email / Copy (no Call/Message).
  await email.click();
  const emailSheet = b.page.locator('ion-action-sheet');
  await expect(emailSheet).toBeVisible({ timeout: 10_000 });
  await expect(emailSheet.locator('.action-sheet-button', { hasText: 'Email' })).toBeVisible();
  await expect(emailSheet.locator('.action-sheet-button', { hasText: 'Call' })).toHaveCount(0);
});
