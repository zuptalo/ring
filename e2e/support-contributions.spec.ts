import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Support Ring (spec 1021): the About screen lists the funding options with a one-line
 * description each (FR-002), and offers to SHARE the canonical support URL — the repository,
 * where FUNDING.yml surfaces every option (FR-010, US3). No payment data or tracking is
 * involved; the links only open on tap.
 */
test('Support: About lists funding options and shares the canonical support URL', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await createAccount(ctx, 'SUPPORT1');

  await a.page.goto('/settings/about');

  // Each option shows its name + a plain-language one-liner (FR-002).
  await expect(a.page.getByText('Ko-fi', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(a.page.getByText('One-off or monthly, no fees taken.')).toBeVisible();
  await expect(a.page.getByText('Liberapay', { exact: true })).toBeVisible();
  await expect(a.page.getByText('Recurring donations, open-source friendly.')).toBeVisible();
  await expect(a.page.getByText('GitHub Sponsors', { exact: true })).toBeVisible();

  // Stub Web Share to capture what gets shared, then tap Share (FR-010): it must be the
  // canonical support URL (the repo).
  await a.page.evaluate(() => {
    (window as any).__shared = null;
    (navigator as any).share = (d: any) => {
      (window as any).__shared = d;
      return Promise.resolve();
    };
  });
  await a.page.getByText('Share a link to support Ring').click();
  const shared = await a.page.evaluate(() => (window as any).__shared);
  expect(shared?.url).toBe('https://github.com/zuptalo/ring');

  await ctx.close();
});
