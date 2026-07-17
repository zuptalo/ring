import { test, expect } from '@playwright/test';
import { createAccount, pair, noticeBodies, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Owner-only Wall notifications (spec 1031) end-to-end. Three real accounts drive the
 * ACTUAL path: engagement → server fan-out (WS to the whole audience, activity push to
 * the owner only) → the recipient's live `post-engagement` handler → syncEngagement →
 * wall-activity-policy → in-app banner. Content sync and alerting are asserted
 * SEPARATELY: everyone must still see the comment/reaction; only the post owner may be
 * alerted (TC-01/02/05/07/08 + FR-003/004/005/007).
 *
 * The bystander's local comment/reaction list filling up (via its own WS frame) is the
 * proof that propagation reached it WITHOUT an alert — so the negative banner
 * assertions are deterministic, not timing guesses.
 */

const post = (c: RingClient, opts: { body?: string; audience?: 'friends' | 'close' }): Promise<string> =>
  c.page.evaluate((o) => (window as any).__ringTest.post(o), opts);
const syncPosts = (c: RingClient): Promise<void> => c.page.evaluate(() => (window as any).__ringTest.syncPosts());
const wallIds = (c: RingClient): Promise<string[]> => c.page.evaluate(() => (window as any).__ringTest.wallPostIds());
const react = (c: RingClient, id: string, emoji: string): Promise<string> =>
  c.page.evaluate(([i, e]) => (window as any).__ringTest.reactToPost(i, e), [id, emoji]);
const reactions = (c: RingClient, id: string): Promise<{ actor: string; emoji: string }[]> =>
  c.page.evaluate((i) => (window as any).__ringTest.postReactions(i), id);
const comment = (c: RingClient, id: string, text: string): Promise<void> =>
  c.page.evaluate(([i, t]) => (window as any).__ringTest.commentOnPost(i, t), [id, text]);
const comments = (c: RingClient, id: string): Promise<{ actor: string; text: string }[]> =>
  c.page.evaluate((i) => (window as any).__ringTest.postComments(i), id);
const setSetting = (c: RingClient, key: string, val: unknown): Promise<void> =>
  c.page.evaluate(([k, v]) => (window as any).__ringTest.setSetting(k, v), [key, val as any]);

const pulledWall = async (c: RingClient): Promise<string[]> => {
  await syncPosts(c);
  return wallIds(c);
};
// NO manual syncEngagement here: the observer's own live `post-engagement` WS frame
// must do the syncing (that is the code path under test).
const seenCommentTexts = (c: RingClient, id: string): Promise<string[]> =>
  comments(c, id).then((r) => r.map((x) => x.text));

async function threeFriends(browser: any, tag: string) {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, `${tag}1`);
  const b = await createAccount(ctxB, `${tag}2`);
  const c = await createAccount(ctxC, `${tag}3`);
  await pair(a, b);
  await pair(a, c);
  return { a, b, c, close: async () => { for (const x of [ctxA, ctxB, ctxC]) await x.close(); } };
}

test('wall activity: comments and reactions alert the post owner only; a removal never alerts', async ({ browser }) => {
  const { a, b, c, close } = await threeFriends(browser, 'WACTA');

  const id = await post(a, { body: 'my post 📣', audience: 'friends' });
  await expect.poll(() => pulledWall(b)).toContain(id);
  await expect.poll(() => pulledWall(c)).toContain(id);

  // --- TC-02: B comments → A is alerted; C (bystander) and B (actor) are not.
  await comment(b, id, 'nice one!');
  await expect.poll(() => noticeBodies(a), { timeout: 10_000 }).toContain('commented on your post');
  // C's copy filled in via its own WS frame — propagation reached C without an alert.
  await expect.poll(() => seenCommentTexts(c, id), { timeout: 10_000 }).toContain('nice one!');
  expect(await noticeBodies(c)).not.toContain('commented on your post');
  expect(await noticeBodies(b)).not.toContain('commented on your post');

  // Let A's banner auto-dismiss so the reaction assertions below are unambiguous.
  await expect.poll(() => noticeBodies(a), { timeout: 15_000 }).not.toContain('commented on your post');

  // --- TC-01: B reacts → A is alerted with the emoji; C and B are not.
  expect(await react(b, id, '❤️')).toBe('added');
  await expect.poll(() => noticeBodies(a), { timeout: 10_000 }).toContain('reacted ❤️ to your post');
  await expect.poll(async () => (await reactions(c, id)).length, { timeout: 10_000 }).toBe(1);
  expect(await noticeBodies(c)).not.toContain('reacted ❤️ to your post');
  expect(await noticeBodies(b)).not.toContain('reacted ❤️ to your post');

  // Wait out A's reaction banner, then remove the reaction → NO new alert anywhere.
  await expect.poll(() => noticeBodies(a), { timeout: 15_000 }).not.toContain('reacted ❤️ to your post');
  expect(await react(b, id, '❤️')).toBe('removed');
  await expect.poll(async () => (await reactions(c, id)).length, { timeout: 10_000 }).toBe(0);
  expect(await noticeBodies(a)).not.toContain('reacted ❤️ to your post');

  await close();
});

test('wall activity: self-actions are silent, the activity toggle gates alerts (content still syncs), mute stays posts-only', async ({ browser }) => {
  const { a, b, c, close } = await threeFriends(browser, 'WACTB');

  const id = await post(a, { body: 'settings post ⚙️', audience: 'friends' });
  await expect.poll(() => pulledWall(b)).toContain(id);
  await expect.poll(() => pulledWall(c)).toContain(id);

  // --- TC-07/08: A engages with A's own post → no alert for anyone.
  await comment(a, id, 'my own note');
  expect(await react(a, id, '👍')).toBe('added');
  await expect.poll(() => seenCommentTexts(b, id), { timeout: 10_000 }).toContain('my own note');
  await expect.poll(() => seenCommentTexts(c, id), { timeout: 10_000 }).toContain('my own note');
  for (const who of [a, b, c]) {
    const bodies = await noticeBodies(who);
    expect(bodies).not.toContain('commented on your post');
    expect(bodies.some((x) => x.startsWith('reacted'))).toBe(false);
  }

  // --- FR-007/FR-005: "Activity on your posts" OFF → B's comment syncs to A but never alerts.
  await setSetting(a, 'notifications.wall.activity', false);
  await comment(b, id, 'quiet one');
  await expect.poll(() => seenCommentTexts(a, id), { timeout: 10_000 }).toContain('quiet one');
  expect(await noticeBodies(a)).not.toContain('commented on your post');

  // --- Clarified mute semantics: per-person Wall mute governs NEW-POST alerts only —
  // a muted friend engaging with MY post still alerts me once the toggle is back on.
  await setSetting(a, 'notifications.wall.activity', true);
  await setSetting(a, 'wall.mutedUsers', { [b.id]: true });
  await comment(b, id, 'muted but it is your post');
  await expect.poll(() => noticeBodies(a), { timeout: 10_000 }).toContain('commented on your post');

  await close();
});
