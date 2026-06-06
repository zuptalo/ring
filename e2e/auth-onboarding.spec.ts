import { test, expect } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Happy-path smoke test for the post-sign-in onboarding: register → set passcode
 * → "Stay in the loop" push step → Allow lands in Chats with the wizard gone.
 *
 * Background: on iOS the Allow tap left the onboarding stuck on screen because the
 * Auth page was a button-less child of <ion-tabs>, and leaving such a tab never
 * fires ion-tabs' leave transition on iOS WebKit (a 'root' useIonRouter navigation
 * wasn't enough). The fix moved Auth to a top-level route (/auth) OUTSIDE the tabs,
 * so entering the app is an ordinary root-outlet replacement that tears it down on
 * every platform. Desktop Chromium navigated fine either way, so this test guards
 * the flow end-to-end (advances to Chats, wizard gone) rather than the iOS symptom.
 *
 * Headless Chromium reports Notification.permission as 'denied' (which skips the
 * push step), so we override Notification to look undecided ('default') and have
 * the prompt grant - the realistic device state that surfaces the wizard.
 */

test('post-sign-in push onboarding enters Chats after Allow', async ({ page, context }) => {
  await context.addInitScript(() => {
    let perm: NotificationPermission = 'default';
    try {
      Object.defineProperty(window.Notification, 'permission', { configurable: true, get: () => perm });
      (window.Notification as any).requestPermission = async () => {
        perm = 'granted';
        return 'granted';
      };
    } catch {
      /* surfaced by the test if the override is rejected */
    }
  });

  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__ringTest, null, { timeout: 30_000 });

  // Mint a fresh invite code for this attempt. A hardcoded single-use code would
  // be consumed on a Playwright retry, leaving registration to fail and the
  // wizard to never appear (a 90s hang). The hook is already available above.
  const inviteCode = (await page.evaluate(() => (window as any).__ringTest.freshCode())) as string;

  // Real UI registration (NOT the test hook) so the onboarding wizard runs.
  await page.getByRole('button', { name: 'Have Invitation Code' }).click();
  const code = page.locator('ion-modal ion-input input').first();
  await code.waitFor({ state: 'visible', timeout: 30_000 });
  await code.click();
  // Real keystrokes so Ionic's ionInput fires (fill() bypasses ion-input's event).
  await code.pressSequentially(inviteCode, { delay: 20 });
  // The completed 8-char code AUTO-advances to the dedicated username step (no
  // Continue tap) - pick an immutable username on its own screen, then submit.
  const username = page.locator('ion-modal ion-input input').first();
  await username.waitFor({ state: 'visible', timeout: 30_000 });
  await username.click();
  await username.pressSequentially('ada.lovelace', { delay: 20 });
  await page.getByRole('button', { name: 'Create account' }).click();

  // The recovery code is shown BEFORE the server account exists: the invite code and
  // username are only consumed once we confirm here. Save it to finalize.
  await expect(page.getByText(/Save your recovery code/i)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /I.?ve saved it/i }).dispatchEvent('click');

  // Now the "Stay in the loop" push step is revealed; tap Allow. (dispatchEvent
  // fires the real button handler past Ionic's transient stacked transition
  // layers, which otherwise intercept a synthesized click in headless.)
  await expect(page.getByText('Stay in the loop')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Allow' }).dispatchEvent('click');

  // Must land on Chats, and the onboarding must be gone (the bug left it stuck).
  await page.waitForURL('**/tabs/chats', { timeout: 30_000 });
  await expect(page.getByText('Stay in the loop')).toBeHidden();
});
