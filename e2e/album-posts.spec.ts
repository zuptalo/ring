import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 1022 — FR-019 album posts (plumbing): a single post can carry an ordered set of
 * media. This drives the REAL createPost → seal-N-refs → upload → register path and the
 * receive path, asserting the album round-trips with all its media (E2EE end-to-end).
 */

const mediaCount = (p: any, postId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.postMediaCount(id), postId) as Promise<number>;

test('an album post round-trips with all of its media', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ALBUMPOST1');
  const b = await createAccount(ctxB, 'ALBUMPOST2');
  await pair(a, b);

  // A shares a 3-photo album through the real compose/seal/upload path.
  const postId = (await a.page.evaluate(() => (window as any).__ringTest.postAlbum(3, 'our trip'))) as string;
  expect(postId).toBeTruthy();

  // The author has all three media locally right away.
  expect(await mediaCount(a, postId)).toBe(3);

  // B pulls posts → receives the album with ALL three media (not just the cover).
  await expect
    .poll(
      async () => {
        await b.page.evaluate(() => (window as any).__ringTest.syncPosts());
        return mediaCount(b, postId);
      },
      { timeout: 30_000 },
    )
    .toBe(3);

  await ctxA.close();
  await ctxB.close();
});
