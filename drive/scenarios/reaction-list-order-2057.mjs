/**
 * Spec 2057 — with a realistic multi-chat list, a reaction from a SKEWED-clock contact must lift
 * that chat to the TOP and refresh its row live.
 *
 * Before the fix the reaction wrote the sender's own (hour-behind) clock into the chat summary,
 * so the chat sank down the list — the row did change, but not where the reader was looking,
 * which reads as "the list didn't update".
 *
 *   node drive/scenarios/reaction-list-order-2057.mjs
 */
import { createAccount, pair, chatWith, say, waitForMessage, messageId, react, shot, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice', mobile: true });
const bob = await createAccount({ name: 'Bob' });      // the skewed-clock contact
const carol = await createAccount({ name: 'Carol' });
const dave = await createAccount({ name: 'Dave' });
await pair(alice, bob);
await pair(alice, carol);
await pair(alice, dave);

// Alice talks to Bob FIRST, so his chat starts at the BOTTOM of the list…
const bobChatA = await chatWith(alice, bob.id);
await say(alice, bob.id, 'ping bob');
await waitForMessage(bob, alice.id, 'ping bob');
// …then Carol and Dave chat more recently, pushing Bob down.
await say(carol, alice.id, 'hi from carol');
await waitForMessage(alice, carol.id, 'hi from carol');
await say(dave, alice.id, 'hi from dave');
await waitForMessage(alice, dave.id, 'hi from dave');

const order = async () =>
  alice.page.evaluate(() =>
    Array.from(document.querySelectorAll('ion-item h2, .chat-name, .row-name'))
      .map((e) => e.textContent?.trim())
      .filter(Boolean),
  );

await alice.page.goto('http://localhost:5173/tabs/chats');
await alice.page.waitForTimeout(3000);
console.log('[2057] list BEFORE reaction:', JSON.stringify(await order()));

// Bob's clock runs an hour slow, then he reacts to Alice's message.
await bob.page.evaluate(() => { const r = Date.now.bind(Date); Date.now = () => r() - 3600000; });
const bobChatB = await chatWith(bob, alice.id);
const mid = await messageId(bob, bobChatB, 'ping bob');
await react(bob, mid, '👍');

// Watch the list WITHOUT navigating.
let seen = false;
for (let i = 0; i < 15; i++) {
  await alice.page.waitForTimeout(1000);
  const previews = await alice.page.evaluate(() =>
    Array.from(document.querySelectorAll('.preview')).map((e) => e.textContent?.trim() ?? ''),
  );
  if (previews.some((t) => /reacted/.test(t))) { seen = true; break; }
}

const row = await alice.page.evaluate((c) => window.__ringTest.chatRow(c), bobChatA);
const all = await alice.page.evaluate(async () => {
  const ids = await window.__ringTest.chatOrder();
  return ids;
});
const pos = all.indexOf(bobChatA);

console.log('[2057] list AFTER  reaction:', JSON.stringify(await order()));
console.log(`[2057] preview refreshed live: ${seen}; Bob's chat position: ${pos} (0 = top of ${all.length})`);
console.log('[2057] Bob row preview:', JSON.stringify(row?.lastMessage));

if (!seen) throw new Error('FAIL: the row preview never refreshed while sitting on the list');
if (pos !== 0) throw new Error(`FAIL: the reacted chat is at position ${pos}, not the top`);
console.log('[2057] PASS — reaction lifted the chat to the top and the row refreshed live ✓');

await shot(alice, 'reaction-list-order-2057', { route: '/tabs/chats' });
await sweep([alice, bob, carol, dave]);
await done();
