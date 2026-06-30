import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 1022 — FR-019 album posts (UI): the composer stages several photos into one album,
 * the feed shows the cover with a count badge, and the full post is a swipeable gallery.
 */

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);
const pngFile = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from(PNG) });

test('an album shows a count badge in the feed and a swipeable gallery in the post', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ALBUMUI1');
  const b = await createAccount(ctxB, 'ALBUMUI2');
  await pair(a, b);

  // A shares a 3-photo album.
  const postId = (await a.page.evaluate(() => (window as any).__ringTest.postAlbum(3, 'our trip'))) as string;

  // Feed: the album renders inline as a swipeable gallery — three slides + a "1 / 3" counter
  // (the cover+badge was replaced by showing the whole album right in the feed).
  await a.page.goto('/tabs/wall');
  await expect(a.page.locator('.album-slide')).toHaveCount(3, { timeout: 30_000 });
  await expect(a.page.locator('.album-count')).toContainText('1 / 3');

  // The full-post route still renders the same swipeable gallery.
  await a.page.goto(`/wall/post/${postId}`);
  await expect(a.page.locator('.album-slide')).toHaveCount(3, { timeout: 30_000 });
  await expect(a.page.locator('.album-count')).toContainText('1 / 3');

  await ctxA.close();
  await ctxB.close();
});

test('the post composer stages several photos and shares them as one album', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ALBUMUI3');
  const b = await createAccount(ctxB, 'ALBUMUI4');
  await pair(a, b);

  // Open the composer from the Wall and pick three photos. (The header button carries the
  // aria-label; the empty-state button only has visible text, so getByLabel is unambiguous.)
  await a.page.goto('/tabs/wall');
  await a.page.getByLabel('New post').click();
  const input = a.page.locator('input[type="file"]');
  await input.waitFor({ state: 'attached', timeout: 30_000 });
  await input.setInputFiles([pngFile('a.png'), pngFile('b.png'), pngFile('c.png')]);

  // They stage as three removable thumbnails.
  await expect(a.page.locator('.stage-thumb')).toHaveCount(3, { timeout: 10_000 });

  // Share → back on the Wall, the post renders as an inline swipeable album ("1 / 3" counter).
  await a.page.getByRole('button', { name: 'Share' }).click();
  await expect(a.page.locator('.album-count')).toContainText('1 / 3', { timeout: 30_000 });

  await ctxA.close();
  await ctxB.close();
});
