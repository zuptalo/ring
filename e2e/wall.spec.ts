import { test, expect } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Zero-Knowledge Social Wall (spec 0003) end-to-end. Drives real accounts through the
 * ACTUAL encrypt → upload → fan-out → receive/open path (via __ringTest, which calls the
 * same queries.ts orchestration the UI does), so these exercise behavior, not shortcuts.
 *
 * Coverage (closes the spec's e2e tasks): audience delivery + isolation (US2/US3),
 * audience-visible reactions with reactor identity (US4), comments + moderation (US6),
 * the close-friends audience + un-close-friend revocation (US5), and author-only view
 * receipts with seen-receipts reciprocity (US7).
 */

const post = (c: RingClient, opts: { body?: string; audience?: 'friends' | 'close'; lifetime?: '1h' | '24h' | '72h' }): Promise<string> =>
  c.page.evaluate((o) => (window as any).__ringTest.post(o), opts);
const syncPosts = (c: RingClient): Promise<void> => c.page.evaluate(() => (window as any).__ringTest.syncPosts());
const wallIds = (c: RingClient): Promise<string[]> => c.page.evaluate(() => (window as any).__ringTest.wallPostIds());
const getPost = (c: RingClient, id: string): Promise<any> => c.page.evaluate((i) => (window as any).__ringTest.getPost(i), id);
const react = (c: RingClient, id: string, emoji: string): Promise<string> =>
  c.page.evaluate(([i, e]) => (window as any).__ringTest.reactToPost(i, e), [id, emoji]);
const syncEng = (c: RingClient, id: string): Promise<void> => c.page.evaluate((i) => (window as any).__ringTest.syncEngagement(i), id);
const reactions = (c: RingClient, id: string): Promise<{ actor: string; emoji: string }[]> =>
  c.page.evaluate((i) => (window as any).__ringTest.postReactions(i), id);
const comment = (c: RingClient, id: string, text: string): Promise<void> =>
  c.page.evaluate(([i, t]) => (window as any).__ringTest.commentOnPost(i, t), [id, text]);
const comments = (c: RingClient, id: string): Promise<{ id: string; actor: string; text: string; deleted: boolean }[]> =>
  c.page.evaluate((i) => (window as any).__ringTest.postComments(i), id);
const delComment = (c: RingClient, id: string, cid: string): Promise<void> =>
  c.page.evaluate(([i, x]) => (window as any).__ringTest.deletePostComment(i, x), [id, cid]);
const recordView = (c: RingClient, id: string): Promise<void> => c.page.evaluate((i) => (window as any).__ringTest.recordPostView(i), id);
const views = async (c: RingClient, id: string): Promise<string[]> =>
  ((await c.page.evaluate((i) => (window as any).__ringTest.postViews(i), id)) as Array<{ viewer: string }>).map((row) => row.viewer);
const setClose = (c: RingClient, id: string, v: boolean): Promise<void> =>
  c.page.evaluate(([i, val]) => (window as any).__ringTest.setCloseFriend(i, val), [id, v as any]);
const closeIds = (c: RingClient): Promise<string[]> => c.page.evaluate(() => (window as any).__ringTest.closeFriendIds());
const setSetting = (c: RingClient, key: string, val: unknown): Promise<void> =>
  c.page.evaluate(([k, v]) => (window as any).__ringTest.setSetting(k, v), [key, val as any]);

// Pull + return the observer's feed; used inside expect.poll so propagation is retried.
const pulledWall = async (c: RingClient): Promise<string[]> => {
  await syncPosts(c);
  return wallIds(c);
};
const pulledReactions = async (c: RingClient, id: string): Promise<string[]> => {
  await syncEng(c, id);
  return (await reactions(c, id)).map((r) => `${r.actor}:${r.emoji}`);
};
const pulledComments = async (c: RingClient, id: string): Promise<{ id: string; actor: string; text: string; deleted: boolean }[]> => {
  await syncEng(c, id);
  return comments(c, id);
};

test('wall: a post reaches its friend audience and no one else; author identity travels', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const ctxD = await browser.newContext();
  const a = await createAccount(ctxA, 'WALL01');
  const b = await createAccount(ctxB, 'WALL02');
  const c = await createAccount(ctxC, 'WALL03');
  const d = await createAccount(ctxD, 'WALL04');
  await pair(a, b);
  await pair(a, c);
  // d is intentionally NOT a friend of a.

  const id = await post(a, { body: 'hello friends 👋', audience: 'friends' });

  // B and C (the friend audience) receive it, with A as the incoming author.
  for (const f of [b, c]) {
    await expect.poll(() => pulledWall(f)).toContain(id);
    expect(await getPost(f, id)).toMatchObject({ id, body: 'hello friends 👋', author: a.id, outgoing: false });
  }
  // A's own copy is outgoing.
  expect(await getPost(a, id)).toMatchObject({ author: a.id, outgoing: true });

  // D (not in the audience) never receives it — the server has no envelope for them.
  await syncPosts(d);
  expect(await wallIds(d)).not.toContain(id);

  for (const ctx of [ctxA, ctxB, ctxC, ctxD]) await ctx.close();
});

test('wall: reactions are audience-visible with the reactor identity, and toggling removes them', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'WALL11');
  const b = await createAccount(ctxB, 'WALL12');
  const c = await createAccount(ctxC, 'WALL13');
  await pair(a, b);
  await pair(a, c);

  const id = await post(a, { body: 'rate this 🎬', audience: 'friends' });
  await expect.poll(() => pulledWall(b)).toContain(id);
  await expect.poll(() => pulledWall(c)).toContain(id);

  // B reacts. The author (A) AND another audience member (C) both see it, attributed to B.
  expect(await react(b, id, '❤️')).toBe('added');
  for (const obs of [a, c]) {
    await expect.poll(() => pulledReactions(obs, id)).toContain(`${b.id}:❤️`);
  }

  // B toggles the same emoji off → it's removed for the whole audience.
  expect(await react(b, id, '❤️')).toBe('removed');
  for (const obs of [a, c]) {
    await expect.poll(() => pulledReactions(obs, id)).toHaveLength(0);
  }

  for (const ctx of [ctxA, ctxB, ctxC]) await ctx.close();
});

test('wall: comments are audience-visible and removable by the commenter or the post author', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'WALL21');
  const b = await createAccount(ctxB, 'WALL22');
  const c = await createAccount(ctxC, 'WALL23');
  await pair(a, b);
  await pair(a, c);

  const id = await post(a, { body: 'thread starter', audience: 'friends' });
  await expect.poll(() => pulledWall(b)).toContain(id);
  await expect.poll(() => pulledWall(c)).toContain(id);

  // B comments → the author sees it attributed to B.
  await comment(b, id, 'first!');
  await expect.poll(async () => (await pulledComments(a, id)).filter((x) => !x.deleted).map((x) => `${x.actor}:${x.text}`)).toContain(`${b.id}:first!`);

  // The COMMENTER removes their own comment → the tombstone propagates and it vanishes
  // from the author's thread (a deleted comment is filtered out, not shown crossed-out).
  const bComment = (await comments(b, id)).find((x) => x.actor === b.id && x.text === 'first!')!;
  await delComment(b, id, bComment.id);
  await expect.poll(async () => (await pulledComments(a, id)).some((x) => x.id === bComment.id)).toBe(false);

  // C comments → the POST AUTHOR (A) can moderate it away (present, then removed).
  await comment(c, id, 'mine too');
  await expect.poll(async () => (await pulledComments(a, id)).some((x) => x.actor === c.id && x.text === 'mine too')).toBe(true);
  const cComment = (await comments(a, id)).find((x) => x.actor === c.id && x.text === 'mine too')!;
  await delComment(a, id, cComment.id); // A authored the post → allowed to remove others' comments
  await expect.poll(async () => (await comments(a, id)).some((x) => x.id === cComment.id)).toBe(false);

  for (const ctx of [ctxA, ctxB, ctxC]) await ctx.close();
});

test('wall: close-friends audience excludes other friends, and un-close-friending revokes the post', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'WALL31');
  const b = await createAccount(ctxB, 'WALL32');
  const c = await createAccount(ctxC, 'WALL33');
  await pair(a, b);
  await pair(a, c);

  // A curates B as a close friend (C stays a regular friend).
  await setClose(a, b.id, true);
  expect(await closeIds(a)).toContain(b.id);
  expect(await closeIds(a)).not.toContain(c.id);

  // A close-only post reaches B but NOT C (a regular friend).
  const id = await post(a, { body: 'close circle only 🤫', audience: 'close' });
  await expect.poll(() => pulledWall(b)).toContain(id);
  await syncPosts(c);
  expect(await wallIds(c)).not.toContain(id);

  // Demote B from close friends → A's close-only post is revoked from B's device.
  await setClose(a, b.id, false);
  await expect.poll(() => pulledWall(b)).not.toContain(id);

  for (const ctx of [ctxA, ctxB, ctxC]) await ctx.close();
});

test('wall: view receipts are author-only and honor seen-receipts reciprocity', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'WALL41');
  const b = await createAccount(ctxB, 'WALL42');
  const c = await createAccount(ctxC, 'WALL43');
  await pair(a, b);
  await pair(a, c);

  const id = await post(a, { body: 'who saw this?', audience: 'friends' });
  await expect.poll(() => pulledWall(b)).toContain(id);
  await expect.poll(() => pulledWall(c)).toContain(id);

  // B (seen-receipts on by default) views it → the author A sees B in the view list.
  await recordView(b, id);
  await expect.poll(() => views(a, id)).toContain(b.id);

  // C turns seen-receipts OFF, then views → C's receipt is NOT sent (reciprocity), so A
  // never sees C even though C opened the post.
  await setSetting(c, 'privacy.seenReceipts', false);
  await recordView(c, id);
  await expect.poll(() => views(a, id)).not.toContain(c.id);
  expect(await views(a, id)).toContain(b.id); // B is still there

  // Author-side reciprocity: if A turns its OWN seen-receipts off, A forfeits the view
  // list entirely (it returns empty), even though receipts exist on the server.
  await setSetting(a, 'privacy.seenReceipts', false);
  expect(await views(a, id)).toHaveLength(0);

  for (const ctx of [ctxA, ctxB, ctxC]) await ctx.close();
});
