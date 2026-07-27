/**
 * Spec 2054 — no delivery tick beside an INCOMING activity preview.
 *
 * Reproduces the report: Alice sends a message (her row shows a tick), Bob reacts to it, and
 * Alice's chat-list row preview becomes "Bob reacted 👍 to …". That preview describes BOB's
 * activity, so the row must NOT keep the tick from Alice's outgoing message.
 *
 *   node drive/scenarios/incoming-tick-2054.mjs
 *   HEADED=1 node drive/scenarios/incoming-tick-2054.mjs
 */
import {
  createAccount, pair, chatWith, say, waitForMessage, messageId, react, shot, poll, sweep, done,
} from '../driver.mjs';

const alice = await createAccount({ name: 'Alice', mobile: true });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);

// Alice sends → her row gets a real outgoing tick.
await say(alice, bob.id, 'Finally done bowwo');
await waitForMessage(bob, alice.id, 'Finally done bowwo');

const aliceChat = await chatWith(alice, bob.id);
const tickAfterSend = await alice.page.evaluate(
  (c) => window.__ringTest.chatRow(c).then((r) => r?.lastTick),
  aliceChat,
);
console.log('[2054] Alice lastTick after her own send:', tickAfterSend);
if (tickAfterSend === 'none') throw new Error('setup FAIL: expected a tick on her own outgoing message');

// Bob reacts to it → Alice's row preview becomes Bob's activity.
const bobChat = await chatWith(bob, alice.id);
const mid = await messageId(bob, bobChat, 'Finally done bowwo');
await react(bob, mid, '👍');

// The preview must flip to the reaction AND the tick must clear.
await poll(
  () => alice.page.evaluate((c) => window.__ringTest.chatRow(c), aliceChat),
  (row) => !!row && /reacted/.test(row.lastMessage ?? ''),
  { timeout: 20_000, label: "Alice's row preview shows Bob's reaction" },
);

const row = await alice.page.evaluate(
  (c) => window.__ringTest.chatRow(c),
  aliceChat,
);
console.log('[2054] preview:', JSON.stringify(row.lastMessage), '| lastTick:', row.lastTick);
if ((row.lastTick ?? 'none') !== 'none') {
  throw new Error(`FAIL: incoming reaction preview still carries a tick (${row.lastTick})`);
}
console.log('[2054] PASS — no tick beside the incoming reaction ✓');

await shot(alice, 'incoming-reaction-no-tick', { route: '/tabs/chats' });

await sweep([alice, bob]);
await done();
