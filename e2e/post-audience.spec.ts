import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

test('post audience is author-only, first-seen is stable, and author reaction pills show attribution', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const a = await createAccount(ctxA, 'POSTAUD1');
    const b = await createAccount(ctxB, 'POSTAUD2');
    for (const person of [a, b]) {
      const recovery = person.page.getByText("I'VE SAVED IT");
      if (await recovery.count()) await recovery.click();
    }
    await a.page.evaluate(([name, avatar]) => (window as any).__ringTest.setProfile(name, avatar), ['Alice', AVATAR]);
    await b.page.evaluate(([name, avatar]) => (window as any).__ringTest.setProfile(name, avatar), ['Bob', AVATAR]);
    await pair(a, b);

    const postId = await a.page.evaluate(() => (window as any).__ringTest.post({ body: 'Audience contract', audience: 'friends' }));
    await expect.poll(async () => {
      await b.page.evaluate(() => (window as any).__ringTest.syncPosts());
      return b.page.evaluate(() => (window as any).__ringTest.wallPostIds());
    }).toContain(postId);

    await b.page.evaluate((id) => (window as any).__ringTest.recordPostView(id), postId);
    const first = await expect.poll(
      () => a.page.evaluate((id) => (window as any).__ringTest.postViews(id), postId),
    ).toHaveLength(1).then(() => a.page.evaluate((id) => (window as any).__ringTest.postViews(id), postId));
    expect(first[0].viewer).toBe(b.id);
    expect(first.some((row: { viewer: string }) => row.viewer === a.id)).toBe(false);
    await b.page.evaluate((id) => (window as any).__ringTest.recordPostView(id), postId);
    expect(await a.page.evaluate((id) => (window as any).__ringTest.postViews(id), postId)).toEqual(first);

    // The data-layer deliberately turns the server's author-only 403 into an empty
    // offline-safe result. Handler tests separately pin the literal status code.
    expect(await b.page.evaluate((id) => (window as any).__ringTest.postViews(id), postId)).toEqual([]);

    expect(await b.page.evaluate(([id, emoji]) => (window as any).__ringTest.reactToPost(id, emoji), [postId, '❤️'])).toBe('added');
    await expect.poll(async () => {
      await a.page.evaluate((id) => (window as any).__ringTest.syncEngagement(id), postId);
      return a.page.evaluate((id) => (window as any).__ringTest.postReactions(id), postId);
    }).toHaveLength(1);

    await a.page.evaluate((path) => { void (window as any).__ringTest.navigate(path); }, `/wall/post/${postId}`);
    await expect(a.page.locator('.seen-row')).toContainText('Seen by 1');
    await a.page.locator('.seen-row').click();
    await expect(a.page.locator('ion-modal.show-modal')).toContainText('Bob');
    await a.page.locator('ion-modal.show-modal').evaluate((modal: any) => modal.dismiss());

    await a.page.locator('.rpill').click();
    await expect(a.page.locator('ion-modal.show-modal')).toContainText('Bob');

    await b.page.evaluate((path) => { void (window as any).__ringTest.navigate(path); }, `/wall/post/${postId}`);
    await expect(b.page.locator('.seen-row')).toHaveCount(0);
    await expect(b.page.getByText('See who reacted')).toHaveCount(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
