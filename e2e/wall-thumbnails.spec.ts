import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 1022 — US1: the feed must never show a blank/broken media box while the full media
 * loads. A post whose full blob hasn't downloaded still has its small poster (it rode the
 * sealed envelope), so the card shows the poster immediately.
 */

test('a post with only a poster (full media not downloaded) still shows a thumbnail', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await createAccount(ctx, 'WALLTHUMB1');

  // Seed an image post that has ONLY a poster tier (no full blob) — a received,
  // not-yet-downloaded post.
  await a.page.evaluate(() => (window as any).__ringTest.seedWallPosterOnlyImage());
  await a.page.goto('/tabs/wall');

  // The feed shows the poster as the thumbnail — a real <img> with a resolved blob URL,
  // not a blank box.
  const img = a.page.locator('.thumb img').first();
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect(img).toHaveAttribute('src', /^blob:/);

  await ctx.close();
});
