/**
 * Spec 2056 — a sender whose device clock is wrong must not sort into the recipient's past.
 *
 * Reproduces the report: an Android phone with stale timezone data reports a wall clock that
 * looks right to its owner while its UTC is an hour behind, so every message it sends claimed a
 * time an hour earlier and landed ABOVE older messages instead of at the end of the chat.
 *
 * Bob's page has Date.now() shifted -1h to stand in for that device.
 *
 *   node drive/scenarios/skewed-clock-2056.mjs
 */
import { createAccount, pair, chatWith, say, waitForMessage, poll, shot, sweep, done } from '../driver.mjs';

const HOUR = 3600_000;

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);

const aliceChat = await chatWith(alice, bob.id);

// Alice (correct clock) speaks first.
await say(alice, bob.id, 'alice-first');
await waitForMessage(bob, alice.id, 'alice-first');

// Bob's device clock now runs an hour SLOW (stale-tzdata phone).
await bob.page.evaluate((h) => {
  const realNow = Date.now.bind(Date);
  // eslint-disable-next-line no-extend-native
  Date.now = () => realNow() - h;
}, HOUR);

await say(bob, alice.id, 'bob-from-a-skewed-clock');
await waitForMessage(alice, bob.id, 'bob-from-a-skewed-clock');

// The decisive check: on ALICE's device Bob's reply must come LAST, not an hour into the past.
const rows = await poll(
  () => alice.page.evaluate((c) => window.__ringTest.messages(c), aliceChat),
  (ms) => ms.some((m) => m.body === 'bob-from-a-skewed-clock') && ms.some((m) => m.body === 'alice-first'),
  { timeout: 20_000, label: "both messages present on Alice's device" },
);

const ordered = [...rows].sort((a, b) => a.timestamp - b.timestamp).map((m) => m.body);
const first = rows.find((m) => m.body === 'alice-first');
const reply = rows.find((m) => m.body === 'bob-from-a-skewed-clock');
const gapMin = Math.round((reply.timestamp - first.timestamp) / 60000);

console.log('[2056] order by timestamp:', ordered.join('  →  '));
console.log(`[2056] reply is ${gapMin} min after Alice's message (negative = sorted into the past)`);

if (reply.timestamp < first.timestamp) {
  throw new Error(`FAIL: the skewed sender's reply sorted BEFORE the message it answers (${gapMin} min)`);
}
if (ordered[ordered.length - 1] !== 'bob-from-a-skewed-clock') {
  throw new Error(`FAIL: the reply is not last — order was ${ordered.join(', ')}`);
}
console.log('[2056] PASS — the reply sits at the end of the chat, where it belongs ✓');

await shot(alice, 'skewed-clock-order', { route: `/chat/${aliceChat}` });

await sweep([alice, bob]);
await done();
