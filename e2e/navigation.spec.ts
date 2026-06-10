import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Tabs are terminal (WhatsApp-style): the iOS PWA back-swipe walks the browser
 * history, so navigations into a tab root must REPLACE the current entry instead of
 * pushing (the router guard in src/router/index.ts). Hopping between the four main
 * tabs therefore never grows the history, while drill-down pages still push (and so
 * still swipe back to their list).
 */
test('tab switches replace history; drill-downs still push', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await createAccount(ctx, 'NAVTERM1');
  const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
  await a.page.evaluate((av) => (window as any).__ringTest.setProfile('Nav', av), AVATAR);

  await a.page.goto('/tabs/chats');
  await a.page.waitForURL('**/tabs/chats');
  // Ionic consumes ion-tab-button's `tab` as a prop (not a DOM attribute), so
  // target the buttons by their visible label.
  const tabBtn = (label: string) => a.page.locator('ion-tab-button', { hasText: label });
  await tabBtn('Contacts').waitFor({ state: 'visible', timeout: 30_000 });

  const h0 = (await a.page.evaluate(() => history.length)) as number;

  // Hop across every tab (real tab-bar clicks). Before the guard each hop pushed an
  // entry; now each one replaces, so history.length must not grow.
  for (const t of ['Contacts', 'Calls', 'Settings', 'Chats', 'Settings', 'Chats'] as const) {
    await tabBtn(t).click();
    await a.page.waitForURL(`**/tabs/${t.toLowerCase()}`);
  }
  expect(await a.page.evaluate(() => history.length)).toBe(h0);

  // Drill-down still PUSHES: a fresh account's empty Chats offers "Browse the
  // directory" → /directory. That must add an entry, and back must return to Chats.
  await a.page.getByRole('button', { name: /browse the directory/i }).click();
  await a.page.waitForURL('**/directory');
  expect(await a.page.evaluate(() => history.length)).toBe(h0 + 1);

  await a.page.goBack();
  await a.page.waitForURL('**/tabs/chats');

  await ctx.close();
});
