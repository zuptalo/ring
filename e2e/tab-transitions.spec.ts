import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Smooth tab transitions (spec 1001). The four bottom tabs must appear FULLY
 * FORMED on switch — header (search + action buttons), structure, and data all
 * present together — rather than rendering in pieces (title, then controls, then
 * data), and Settings must show the REAL identity, not the "You"/initials
 * placeholder. These are driven through the real tab bar so we exercise the warm
 * stores + eager-loaded pages + keep-alive, not the test hook.
 *
 * Frame-by-frame "no pop-in" is verified manually (quickstart.md); here we assert
 * the observable consequences: controls + content are present together, the empty
 * state never shows on a populated account, returning a tab restores its content
 * instantly, and Settings never shows "You".
 */

const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

const tabBtn = (page: any, label: string) => page.locator('ion-tab-button', { hasText: label });

test.describe('tab transitions', () => {
  test('Settings shows the real identity on first paint, never the "You" placeholder', async ({ browser }) => {
    const ctx = await browser.newContext();
    const a = await createAccount(ctx, 'TABTRAN1');
    await a.page.evaluate((av) => (window as any).__ringTest.setProfile('Kamran Real', av), AVATAR);

    // Enter on Chats, then switch to Settings via the tab bar (the warm path).
    await a.page.goto('/tabs/chats');
    await tabBtn(a.page, 'Settings').waitFor({ state: 'visible', timeout: 30_000 });
    await tabBtn(a.page, 'Settings').click();
    await a.page.waitForURL('**/tabs/settings');

    // Real name present; the generic placeholder name is never shown.
    await expect(a.page.getByText('Kamran Real')).toBeVisible();
    await expect(a.page.locator('ion-content').getByText('You', { exact: true })).toHaveCount(0);

    await ctx.close();
  });

  test('populated tabs appear fully formed with no empty-state flash, and restore on return', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await createAccount(ctxA, 'TABTRAN2');
    const b = await createAccount(ctxB, 'TABTRAN3');
    await a.page.evaluate((av) => (window as any).__ringTest.setProfile('Aria', av), AVATAR);
    await b.page.evaluate((av) => (window as any).__ringTest.setProfile('Bahar', av), AVATAR);
    await pair(a, b); // gives A a contact "Bahar" and a 1:1 chat with her

    await a.page.goto('/tabs/chats');
    await tabBtn(a.page, 'Contacts').waitFor({ state: 'visible', timeout: 30_000 });

    // --- Contacts: header controls + content present together; no empty flash ---
    await tabBtn(a.page, 'Contacts').click();
    await a.page.waitForURL('**/tabs/contacts');
    await expect(a.page.getByRole('button', { name: 'Add contact' })).toBeVisible(); // action button
    await expect(a.page.locator('ion-searchbar').first()).toBeVisible(); // search bar
    await expect(a.page.getByText('Bahar')).toBeVisible(); // list content
    await expect(a.page.getByText('No contacts found')).toHaveCount(0); // never flashes empty

    // --- Chats: fully formed, the chat is present ---
    await tabBtn(a.page, 'Chats').click();
    await a.page.waitForURL('**/tabs/chats');
    await expect(a.page.getByRole('button', { name: 'New chat' })).toBeVisible();
    await expect(a.page.getByText('Bahar')).toBeVisible();

    // --- Return to Contacts: content restored instantly, still no empty flash ---
    await tabBtn(a.page, 'Contacts').click();
    await a.page.waitForURL('**/tabs/contacts');
    await expect(a.page.getByText('Bahar')).toBeVisible();
    await expect(a.page.getByText('No contacts found')).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
  });

  test('rapid tab switching leaves every tab fully rendered', async ({ browser }) => {
    const ctx = await browser.newContext();
    const a = await createAccount(ctx, 'TABTRAN4');
    await a.page.evaluate((av) => (window as any).__ringTest.setProfile('Speedy', av), AVATAR);

    await a.page.goto('/tabs/chats');
    await tabBtn(a.page, 'Calls').waitFor({ state: 'visible', timeout: 30_000 });

    // Cycle quickly across all four tabs without waiting between taps.
    for (const t of ['Calls', 'Contacts', 'Settings', 'Chats', 'Calls', 'Settings'] as const) {
      await tabBtn(a.page, t).click();
    }
    // After the burst, the last tab (Settings) must be fully rendered, not stuck
    // in a placeholder/partial state.
    await a.page.waitForURL('**/tabs/settings');
    await expect(a.page.getByText('Speedy')).toBeVisible();

    // And each tab still renders its own page marker when selected.
    await tabBtn(a.page, 'Calls').click();
    await expect(a.page.getByRole('button', { name: 'New call' })).toBeVisible();
    await tabBtn(a.page, 'Contacts').click();
    await expect(a.page.getByRole('button', { name: 'Add contact' })).toBeVisible();

    await ctx.close();
  });
});
