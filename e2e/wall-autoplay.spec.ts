import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 1022 — in-feed media autoplay (the shared `v-autoplay-visible` coordinator).
 *
 * On the Wall, a video plays inline once its card is on screen and stops when scrolled off,
 * and AT MOST ONE video plays at a time. The directive reflects the active element with
 * `data-autoplaying="true"`, which we assert against scroll position — deterministic, and
 * independent of whether the (stub) bytes actually decode.
 */

const active = (p: any) => p.page.locator('.thumb video[data-autoplaying]');

test('feed videos autoplay one at a time and hand off when scrolled', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await createAccount(ctx, 'WALLAUTO1');

  // Seed three tall video posts straight into the feed (no real transcode).
  await a.page.evaluate(() => (window as any).__ringTest.seedWallVideoPosts(3));
  await a.page.goto('/tabs/wall');
  await expect(a.page.locator('.thumb video')).toHaveCount(3, { timeout: 30_000 });

  // Settle at the top: exactly one video is autoplaying.
  await expect(active(a)).toHaveCount(1, { timeout: 10_000 });
  const firstSrc = await active(a).getAttribute('src');
  expect(firstSrc).toBeTruthy();

  // Scroll to the bottom — playback hands off to a DIFFERENT video, still exactly one.
  await a.page.evaluate(async () => {
    const el = await (document.querySelector('ion-content') as any).getScrollElement();
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
  });
  await expect
    .poll(
      async () => {
        const count = await active(a).count();
        const src = count === 1 ? await active(a).getAttribute('src') : null;
        return count === 1 && !!src && src !== firstSrc;
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  // Never more than one playing at any settled point.
  await expect(active(a)).toHaveCount(1);

  await ctx.close();
});

test('autoplay is suppressed under prefers-reduced-motion (tap-to-play fallback)', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const a = await createAccount(ctx, 'WALLAUTO2');

  await a.page.evaluate(() => (window as any).__ringTest.seedWallVideoPosts(2));
  await a.page.goto('/tabs/wall');
  await expect(a.page.locator('.thumb video')).toHaveCount(2, { timeout: 30_000 });

  // With reduced-motion on, nothing autoplays — the play glyph stays and no video is active.
  await expect(a.page.locator('.thumb .play').first()).toBeVisible();
  await expect(active(a)).toHaveCount(0);

  await ctx.close();
});
