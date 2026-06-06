import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Granular media cleanup: delete by type and by size, freeing exactly the
 * matching blobs and updating the storage totals.
 */
test('media cleanup: delete by type, then by size', async ({ browser }) => {
  const a = await createAccount(await browser.newContext(), 'MEDIACLN');
  const chat = 'chat-x';
  const seed = (kind: string, bytes: number) =>
    a.page.evaluate(([c, k, b]) => (window as any).__ringTest.seedMedia(c, k, b), [chat, kind, bytes] as const);
  const byType = (): Promise<{ total: number; byKind: Record<string, number> }> =>
    a.page.evaluate(() => (window as any).__ringTest.storageByType());

  await seed('image', 1_000_000); // 1 MB photo
  await seed('image', 2_000_000); // 2 MB photo
  await seed('video', 50_000_000); // 50 MB video (large)
  await seed('file', 500_000); // 0.5 MB doc

  let s = await byType();
  expect(s.byKind.image).toBe(3_000_000);
  expect(s.byKind.video).toBe(50_000_000);
  expect(s.byKind.file).toBe(500_000);

  // Delete all photos → only image bytes go to zero.
  await a.page.evaluate(() => (window as any).__ringTest.deleteMediaByKind(['image']));
  s = await byType();
  expect(s.byKind.image).toBe(0);
  expect(s.byKind.video).toBe(50_000_000);

  // Delete files larger than 10 MB → removes the video, keeps the small doc.
  await a.page.evaluate(() => (window as any).__ringTest.deleteMediaLargerThan(10 * 1024 * 1024));
  s = await byType();
  expect(s.byKind.video).toBe(0);
  expect(s.byKind.file).toBe(500_000);
});
