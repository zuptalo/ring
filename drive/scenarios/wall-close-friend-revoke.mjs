/**
 * Spec 0003 revocation: removing someone from close friends revokes your close-only
 * posts from them. Alice posts a close-friends-only post; Bob (a close friend) receives
 * it; Alice un-close-friends Bob; Bob's local copy must disappear.
 *
 *   node drive/scenarios/wall-close-friend-revoke.mjs
 *   HEADED=1 node drive/scenarios/wall-close-friend-revoke.mjs
 *
 * Drives the live `queries` module directly (Vite serves the same singleton the app
 * uses) since there is no __ringTest wall helper.
 */
import { createAccount, pair, poll, sweep, done } from '../driver.mjs';

const Q = '/src/db/queries.ts';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });

// Friends + Alice marks Bob a CLOSE friend.
await pair(alice, bob);
await alice.page.evaluate(async ([mod, id]) => {
  const q = await import(mod);
  await q.setCloseFriend(id, true);
}, [Q, bob.id]);

// Alice posts a close-friends-only post.
const postId = await alice.page.evaluate(async ([mod]) => {
  const q = await import(mod);
  const p = await q.createPost({ body: 'secret for close friends 🤫', audience: 'close', lifetime: '24h' });
  return p.id;
}, [Q]);
console.log('[alice] posted close-only', postId);

// Bob pulls and should see it.
await poll(
  () => bob.page.evaluate(async ([mod]) => {
    const q = await import(mod);
    await q.syncPosts();
    return (await q.listWallPosts()).length;
  }, [Q]),
  (n) => n >= 1,
  { label: 'bob receives the close-only post' },
);
console.log('[bob] sees the post ✓');

// Alice removes Bob from close friends → revokes the post from him.
await alice.page.evaluate(async ([mod, id]) => {
  const q = await import(mod);
  await q.setCloseFriend(id, false);
}, [Q, bob.id]);
console.log('[alice] un-close-friended bob');

// Bob's local copy must vanish (live post-revoke nudge, with a syncPosts fallback).
await poll(
  () => bob.page.evaluate(async ([mod]) => {
    const q = await import(mod);
    await q.syncPosts();
    return (await q.listWallPosts()).length;
  }, [Q]),
  (n) => n === 0,
  { label: 'bob loses the revoked post' },
);
console.log('[bob] post revoked ✓');

await sweep([alice, bob]);
await done();
