/**
 * Spec 1065 US4/US5: one-level comment threads and comment reactions.
 *
 *   node drive/scenarios/comment-threads.mjs
 *   HEADED=1 node drive/scenarios/comment-threads.mjs
 */
import { createAccount, pair, shot, sweep, done, poll } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
const carol = await createAccount({ name: 'Carol' });
const dave = await createAccount({ name: 'Dave' });
for (const person of [alice, bob, carol, dave]) {
  const button = person.page.getByText("I'VE SAVED IT");
  if (await button.count()) await button.click();
}
for (const friend of [bob, carol, dave]) await pair(alice, friend);

const postId = await alice.page.evaluate(() => window.__ringTest.post({
  body: 'Where should we meet?', audience: 'friends',
}));
for (const person of [bob, carol, dave]) {
  await poll(
    async () => { await person.page.evaluate(() => window.__ringTest.syncPosts()); return person.page.evaluate(() => window.__ringTest.wallPostIds()); },
    (ids) => ids.includes(postId),
    { label: `${person.label} has the post` },
  );
}

await bob.page.evaluate((id) => window.__ringTest.commentOnPost(id, 'By the station'), postId);
await poll(
  async () => { await carol.page.evaluate((id) => window.__ringTest.syncEngagement(id, true), postId); return carol.page.evaluate((id) => window.__ringTest.postComments(id), postId); },
  (rows) => rows.some((row) => row.text === 'By the station'),
  { label: 'top-level comment' },
);
const top = (await carol.page.evaluate((id) => window.__ringTest.postComments(id), postId))
  .find((row) => row.text === 'By the station');

await carol.page.evaluate(
  ([id, parent]) => window.__ringTest.replyToComment(id, parent, 'Works for me'),
  [postId, top.id],
);
await poll(
  async () => { await dave.page.evaluate((id) => window.__ringTest.syncEngagement(id, true), postId); return dave.page.evaluate((id) => window.__ringTest.postComments(id), postId); },
  (rows) => rows.some((row) => row.text === 'Works for me'),
  { label: 'first reply' },
);
const firstReply = (await dave.page.evaluate((id) => window.__ringTest.postComments(id), postId))
  .find((row) => row.text === 'Works for me');

await dave.page.evaluate(
  ([id, parent]) => window.__ringTest.replyToComment(id, parent, 'I will bring coffee'),
  [postId, firstReply.id],
);
await carol.page.evaluate(
  ([id, parent]) => window.__ringTest.reactToComment(id, parent, '❤️'),
  [postId, top.id],
);

await alice.page.evaluate((path) => { void window.__ringTest.navigate(path); }, `/wall/post/${postId}`);
await alice.page.waitForTimeout(1500);
await shot(alice, 'us4-thread-and-comment-reaction');

await alice.page.evaluate(
  ([id, target]) => window.__ringTest.deletePostComment(id, target),
  [postId, top.id],
);
await dave.page.evaluate((id) => window.__ringTest.syncEngagement(id, true), postId);
await dave.page.evaluate((path) => { void window.__ringTest.navigate(path); }, `/wall/post/${postId}`);
await dave.page.waitForTimeout(1200);
await shot(dave, 'us4-deleted-parent-placeholder');

await sweep([alice, bob, carol, dave]);
await done();
