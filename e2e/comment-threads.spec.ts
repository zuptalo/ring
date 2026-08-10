import { test, expect } from '@playwright/test';
import { createAccount, noticeBodies, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

type CommentRow = {
  id: string;
  actor: string;
  text: string;
  parent?: string;
  replyToActor?: string;
  replyToName?: string;
  deleted: boolean;
};

const post = (c: RingClient, body: string): Promise<string> =>
  c.page.evaluate((text) => (window as any).__ringTest.post({ body: text, audience: 'friends' }), body);
const syncPosts = (c: RingClient): Promise<void> => c.page.evaluate(() => (window as any).__ringTest.syncPosts());
const wallIds = (c: RingClient): Promise<string[]> => c.page.evaluate(() => (window as any).__ringTest.wallPostIds());
const sync = (c: RingClient, postId: string): Promise<void> =>
  c.page.evaluate((id) => (window as any).__ringTest.syncEngagement(id, true), postId);
const comment = (c: RingClient, postId: string, text: string): Promise<void> =>
  c.page.evaluate(([id, body]) => (window as any).__ringTest.commentOnPost(id, body), [postId, text]);
const reply = (c: RingClient, postId: string, commentId: string, text: string): Promise<void> =>
  c.page.evaluate(([id, parent, body]) => (window as any).__ringTest.replyToComment(id, parent, body), [postId, commentId, text]);
const comments = (c: RingClient, postId: string): Promise<CommentRow[]> =>
  c.page.evaluate((id) => (window as any).__ringTest.postComments(id), postId);
const react = (c: RingClient, postId: string, commentId: string, emoji: string): Promise<string> =>
  c.page.evaluate(([id, parent, value]) => (window as any).__ringTest.reactToComment(id, parent, value), [postId, commentId, emoji]);
const reactions = (c: RingClient, postId: string): Promise<Array<{ actor: string; emoji: string; parent: string }>> =>
  c.page.evaluate((id) => (window as any).__ringTest.commentReactions(id), postId);
const remove = (c: RingClient, postId: string, commentId: string): Promise<void> =>
  c.page.evaluate(([id, target]) => (window as any).__ringTest.deletePostComment(id, target), [postId, commentId]);
const setting = (c: RingClient, key: string, value: unknown): Promise<void> =>
  c.page.evaluate(([name, next]) => (window as any).__ringTest.setSetting(name, next), [key, value as any]);

async function pullComments(c: RingClient, postId: string): Promise<CommentRow[]> {
  await sync(c, postId);
  return comments(c, postId);
}

test('comment threads stay one level, retain deleted parents, target reactions, and alert exact recipients', async ({ browser }) => {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  const [a, b, c, d] = await Promise.all([
    createAccount(contexts[0], 'THRD01'),
    createAccount(contexts[1], 'THRD02'),
    createAccount(contexts[2], 'THRD03'),
    createAccount(contexts[3], 'THRD04'),
  ]);
  await pair(a, b);
  await pair(a, c);
  await pair(a, d);

  const postId = await post(a, 'Thread contract');
  for (const viewer of [b, c, d]) await expect.poll(async () => { await syncPosts(viewer); return wallIds(viewer); }).toContain(postId);

  // Keep the initial top-level comment from occupying A's single banner slot. The
  // setting is restored before the reply whose exact routing is under test.
  await setting(a, 'notifications.wall.activity', false);
  await comment(b, postId, 'top level');
  await expect.poll(async () => (await pullComments(c, postId)).some((row) => row.text === 'top level')).toBe(true);
  const top = (await comments(c, postId)).find((row) => row.text === 'top level')!;
  await setting(a, 'notifications.wall.activity', true);

  // Answering B names and wakes B plus the post owner, while D merely receives content.
  await reply(c, postId, top.id, 'first reply');
  await expect.poll(() => noticeBodies(a), { timeout: 10_000 }).toContain('commented on your post');
  await expect.poll(() => noticeBodies(b), { timeout: 10_000 }).toContain('replied to you');
  await expect.poll(async () => (await pullComments(d, postId)).some((row) => row.text === 'first reply')).toBe(true);
  expect(await noticeBodies(d)).not.toContain('replied to you');
  const firstReply = (await comments(d, postId)).find((row) => row.text === 'first reply')!;
  expect(firstReply).toMatchObject({ parent: top.id, replyToActor: b.id });

  // A reply to a reply remains under the same top-level parent but records the
  // exact person answered for copy and routing.
  await reply(d, postId, firstReply.id, 'reply to reply');
  await expect.poll(async () => (await pullComments(a, postId)).some((row) => row.text === 'reply to reply')).toBe(true);
  const nested = (await comments(a, postId)).find((row) => row.text === 'reply to reply')!;
  expect(nested).toMatchObject({ parent: top.id, replyToActor: c.id });

  // A reaction attaches only to the selected comment and is visible to every device.
  expect(await react(c, postId, top.id, '❤️')).toBe('added');
  await expect.poll(async () => { await sync(d, postId); return reactions(d, postId); }).toContainEqual({ actor: c.id, emoji: '❤️', parent: top.id });
  expect((await reactions(d, postId)).some((row) => row.parent === firstReply.id)).toBe(false);

  // Author moderation emits one comment tombstone. The parent remains locally as
  // a placeholder because its replies still need an anchor, and its reactions vanish.
  await remove(a, postId, top.id);
  await expect.poll(async () => (await pullComments(d, postId)).find((row) => row.id === top.id)?.deleted).toBe(true);
  expect(await reactions(d, postId)).toHaveLength(0);

  await d.page.goto(`/wall/post/${postId}`);
  await expect(d.page.getByText('This comment was deleted')).toBeVisible();
  await expect(d.page.getByText('first reply')).toBeVisible();
  await expect(d.page.getByText('reply to reply')).toBeVisible();
  await expect(d.page.getByText(/Replying to/).first()).toBeVisible();

  for (const context of contexts) await context.close();
});
