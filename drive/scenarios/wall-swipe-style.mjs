/**
 * Visual check for the restyled swipe actions (rounded, inset, revealed from behind
 * the card/row). Opens the sliding items programmatically and screenshots them.
 *
 *   HEADED=1 node drive/scenarios/wall-swipe-style.mjs
 * Screenshots land in .tmp/drive/.
 */
import path from 'node:path';
import { createAccount, pair, poll, sweep, done, SHOT_DIR } from '../driver.mjs';

const Q = '/src/db/queries.ts';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);

// Alice posts; Bob comments so we have a comment to swipe.
const postId = await alice.page.evaluate(async ([mod]) => {
  const q = await import(mod);
  const p = await q.createPost({ body: 'a sunny afternoon walk 🌞', audience: 'friends', lifetime: '24h' });
  return p.id;
}, [Q]);

await poll(
  () => bob.page.evaluate(async ([mod, id]) => {
    const q = await import(mod);
    await q.syncPosts();
    return !!(await q.getPost(id));
  }, [Q, postId]),
  Boolean,
  { label: 'bob has the post' },
);
await bob.page.evaluate(async ([mod, id]) => {
  const q = await import(mod);
  await q.commentOnPost(id, 'looks lovely!');
}, [Q, postId]);

// Open a sliding item to the given side and screenshot.
async function shotOpen(client, route, side, name) {
  await client.page.goto(route);
  await client.page.waitForSelector('ion-item-sliding', { timeout: 15_000 });
  await client.page.waitForTimeout(400);
  await client.page.evaluate(async (s) => {
    const el = document.querySelector('ion-item-sliding');
    if (el && el.open) await el.open(s);
  }, side);
  await client.page.waitForTimeout(500);
  const file = path.join(SHOT_DIR, `${name}.png`);
  await client.page.screenshot({ path: file });
  console.log('shot', file);
}

// Alice's own post → swipe end reveals Delete.
await shotOpen(alice, '/tabs/wall', 'end', 'swipe-own-delete');
// Bob viewing Alice's post → swipe start reveals Mute, end reveals Hide.
await shotOpen(bob, '/tabs/wall', 'end', 'swipe-other-hide');
await shotOpen(bob, '/tabs/wall', 'start', 'swipe-other-mute');
// Bob's comment on the detail page → swipe end reveals Delete.
await shotOpen(bob, `/wall/post/${postId}`, 'end', 'swipe-comment-delete');

await sweep([alice, bob]);
await done();
