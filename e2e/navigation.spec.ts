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

  // Empty Chats now hints to Contacts to start a conversation (spec 1003). That's a
  // tab switch (replace), so history must NOT grow.
  await a.page.getByRole('button', { name: /start a conversation/i }).click();
  await a.page.waitForURL('**/tabs/contacts');
  expect(await a.page.evaluate(() => history.length)).toBe(h0);

  // Drill-down still PUSHES: Contacts' "Browse user directory" → /directory adds an
  // entry, and back must return to Contacts.
  await a.page.getByRole('button', { name: /browse user directory/i }).click();
  await a.page.waitForURL('**/directory');
  expect(await a.page.evaluate(() => history.length)).toBe(h0 + 1);

  await a.page.goBack();
  await a.page.waitForURL('**/tabs/contacts');

  await ctx.close();
});

/**
 * Regression: switching tabs must actually transition the page, even when the tab you
 * came from has leftover FORWARD history from a drill-down you backed out of. The old
 * bare-`replace` router guard desynced the nested tabs outlet here — the tapped tab
 * highlighted but its page never swapped in until you visited another tab first. Tab
 * switches now go through Ionic's router with a 'root' direction, which transitions
 * cleanly. We assert the destination page is genuinely VISIBLE, not merely that the URL
 * changed (the bug left the URL right but the page wrong).
 */
test('switching tabs transitions the page after a drill-down + back', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await createAccount(ctx, 'NAVTERM2');
  const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
  await a.page.evaluate((av) => (window as any).__ringTest.setProfile('Nav', av), AVATAR);

  const tabBtn = (label: string) => a.page.locator('ion-tab-button', { hasText: label });
  // Unique, page-specific controls: visible only when that tab's page is the active
  // (non-hidden) ion-page. A backgrounded tab page is display:none, so these go invisible.
  const chatsMarker = a.page.getByRole('button', { name: 'New chat' });
  const contactsMarker = a.page.getByRole('button', { name: 'Add contact' });

  // Land on Contacts and confirm its page is the visible one.
  await a.page.goto('/tabs/contacts');
  await a.page.waitForURL('**/tabs/contacts');
  await tabBtn('Chats').waitFor({ state: 'visible', timeout: 30_000 });
  await expect(contactsMarker).toBeVisible();

  // Drill down into the directory (a real push), then back out to Contacts. This leaves
  // /directory in forward history — the exact state that used to wedge the tab outlet.
  await a.page.getByRole('button', { name: /browse user directory/i }).click();
  await a.page.waitForURL('**/directory');
  await a.page.goBack();
  await a.page.waitForURL('**/tabs/contacts');

  // Now switch to Chats: the page must actually become visible (not just the URL change),
  // on the FIRST tap, with no need to bounce through another tab.
  await tabBtn('Chats').click();
  await a.page.waitForURL('**/tabs/chats');
  await expect(chatsMarker).toBeVisible();
  await expect(contactsMarker).toBeHidden();

  await ctx.close();
});

/**
 * Spec 2010 — navigation robustness. The installed iOS PWA's OS edge-swipe can't be disabled and, at
 * history depth 1, underflows past start_url into a blank browser view. Two guarantees: (1) any path
 * that doesn't match a real screen redirects to the main list (catch-all) — never a blank view; and
 * (2) a back navigation at a tab root keeps the user on an in-app screen (the app stays mounted),
 * thanks to the catch-all + the base-entry seed.
 */
test('unknown paths redirect into the app; back at a tab root stays in-app', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await createAccount(ctx, 'NAVROBUST');
  const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
  await a.page.evaluate((av) => (window as any).__ringTest.setProfile('Nav', av), AVATAR);

  // (1) Catch-all: an unknown path resolves to the main list, not a blank document.
  await a.page.goto('/this/path/does/not/exist');
  await a.page.waitForURL('**/tabs/chats');
  expect(await a.page.evaluate(() => !!document.querySelector('ion-router-outlet'))).toBe(true);

  // (2) From a tab root, a back navigation must stay in-app (an in-app route + the app still mounted),
  // never about:blank / browser chrome.
  await a.page.goto('/tabs/chats');
  await a.page.waitForURL('**/tabs/chats');
  expect(await a.page.evaluate(() => history.length)).toBeGreaterThanOrEqual(2);
  await a.page.goBack();
  // Landing on the catch-all entry remounts the app via a FULL document load —
  // let the navigation settle before touching the page (an evaluate fired
  // mid-navigation dies with "execution context was destroyed"), then poll for
  // the mount (the guarantee is "stays in-app", not "remounts instantly").
  await a.page.waitForLoadState('domcontentloaded').catch(() => {});
  expect(a.page.url()).not.toContain('about:blank');
  await a.page.waitForFunction(() => !!document.querySelector('ion-app, ion-router-outlet'), undefined, {
    timeout: 15_000,
  });
  expect(await a.page.evaluate(() => location.pathname)).not.toBe('');

  await ctx.close();
});
