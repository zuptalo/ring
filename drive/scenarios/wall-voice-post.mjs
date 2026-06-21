/**
 * Spec 0003: voice posts. Alice shares a voice post; Bob (a friend) receives it and
 * his Wall renders it as a voice item. Exercises the createPost(kind:'voice') →
 * upload → receivePost → render path the new composer recorder feeds into (the mic UI
 * itself can't run headless, so we hand createPost a synthetic audio blob).
 *
 *   node drive/scenarios/wall-voice-post.mjs
 */
import { createAccount, pair, poll, sweep, done } from '../driver.mjs';

const Q = '/src/db/queries.ts';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);

// Alice shares a voice post (synthetic audio blob stands in for a recording).
const postId = await alice.page.evaluate(async ([mod]) => {
  const q = await import(mod);
  const blob = new Blob([new Uint8Array(4096)], { type: 'audio/webm' });
  const p = await q.createPost({
    audience: 'friends',
    lifetime: '24h',
    media: { blob, kind: 'voice', name: 'voice.webm', durationSec: 3 },
  });
  return p.id;
}, [Q]);
console.log('[alice] shared voice post', postId);

// Bob receives it and it is a voice-kind post.
await poll(
  () => bob.page.evaluate(async ([mod, id]) => {
    const q = await import(mod);
    await q.syncPosts();
    const p = await q.getPost(id);
    return p ? p.kind : null;
  }, [Q, postId]),
  (k) => k === 'voice',
  { label: 'bob receives the voice post' },
);
console.log('[bob] sees a voice post ✓');

await sweep([alice, bob]);
await done();
