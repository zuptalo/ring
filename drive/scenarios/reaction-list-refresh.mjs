/**
 * REPRO: a reaction arriving while you are sitting on the Chats LIST does not refresh that
 * chat's preview row — you have to navigate away and back to see "X reacted …".
 *
 * The DB write clearly lands (it shows on return), so this checks the RENDERED row, not the
 * stored row, and reports both so we can tell a write problem from a re-render problem.
 *
 *   node drive/scenarios/reaction-list-refresh.mjs
 */
import { createAccount, pair, chatWith, say, waitForMessage, messageId, react, shot, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice', mobile: true });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);

const aliceChat = await chatWith(alice, bob.id);
await say(alice, bob.id, 'ping from alice');
await waitForMessage(bob, alice.id, 'ping from alice');

// Realistic flow: Alice OPENS the conversation first, then goes BACK to the list via the
// router (Ionic keeps the detail page mounted), instead of a fresh page load.
await alice.page.goto(`http://localhost:5173/chat/${aliceChat}`);
await alice.page.waitForTimeout(2500);
await alice.page.evaluate(() => window.history.back());
await alice.page.waitForTimeout(2500);

const rowText = async () =>
  alice.page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.preview'));
    return els.map((e) => e.textContent?.trim() ?? '').filter(Boolean);
  });
const dbRow = async () => alice.page.evaluate((c) => window.__ringTest.chatRow(c), aliceChat);

console.log('[repro] BEFORE  rendered:', JSON.stringify(await rowText()));
console.log('[repro] BEFORE  stored  :', JSON.stringify((await dbRow())?.lastMessage));

// Bob's device clock runs an hour SLOW (the stale-tzdata phone from spec 2056).
await bob.page.evaluate(() => { const r = Date.now.bind(Date); Date.now = () => r() - 3600000; });
// Bob reacts while Alice sits on the list.
const bobChat = await chatWith(bob, alice.id);
const mid = await messageId(bob, bobChat, 'ping from alice');
await react(bob, mid, '👍');

// Watch for up to ~15s WITHOUT navigating.
let renderedSaw = false;
for (let i = 0; i < 15; i++) {
  await alice.page.waitForTimeout(1000);
  const rendered = await rowText();
  if (rendered.some((t) => /reacted/.test(t))) {
    console.log(`[repro] rendered updated after ~${i + 1}s:`, JSON.stringify(rendered));
    renderedSaw = true;
    break;
  }
}

const stored = await dbRow();
const times = await alice.page.evaluate(async (c) => {
  const ms = await window.__ringTest.messages(c);
  const row = await window.__ringTest.chatRow(c);
  const mine = ms.filter((m) => m.body === 'ping from alice')[0];
  return { myMsg: mine?.timestamp, rowTime: row?.lastMessageTime };
}, aliceChat);
const drift = Math.round((times.rowTime - times.myMsg) / 60000);
console.log(`[repro] chat row lastMessageTime vs my own message: ${drift} min (negative = went BACKWARDS)`);
console.log('[repro] AFTER   rendered:', JSON.stringify(await rowText()));
console.log('[repro] AFTER   stored  :', JSON.stringify(stored?.lastMessage));

if (!renderedSaw && /reacted/.test(stored?.lastMessage ?? '')) {
  console.log('[repro] REPRODUCED — the row was written but the list never re-rendered');
} else if (renderedSaw) {
  console.log('[repro] list refreshed live ✓');
} else {
  console.log('[repro] INCONCLUSIVE — the reaction never reached the stored row either');
}

await shot(alice, 'reaction-list-refresh');

await sweep([alice, bob]);
await done();
