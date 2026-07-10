/**
 * Verify the WhatsApp-style left gutter on 1:1 incoming bubbles (reply-swipe /
 * back-swipe separation). Compares a 1:1 chat (should now have a left inset on
 * incoming bubbles) with a group chat (avatar already provides the inset).
 *
 *   HEADED=1 node drive/scenarios/reply-swipe-gutter.mjs
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  createAccount, pair, group, chatWith, say, waitForMessage, sweep, done, SHOT_DIR,
} from '../driver.mjs';

// Navigate to a chat, wait for real bubbles to paint (not the loading spinner),
// then screenshot. shot()'s fixed 600ms settle can catch the skeleton on a cold
// direct-nav, so gate on the bubble row instead.
async function shotChat(client, name, chatId) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await client.page.goto(`/chat/${chatId}`);
  await client.page.waitForSelector('.bubble[data-mid]', { timeout: 15000 });
  await client.page.waitForTimeout(500);
  const file = path.join(SHOT_DIR, `${name}.png`);
  await client.page.screenshot({ path: file });
  console.log(`[shot] ${file}`);
}

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
const cara = await createAccount({ name: 'Cara' });
await pair(alice, bob);
await pair(alice, cara);
await pair(bob, cara);

// 1:1 — a few incoming messages so Bob (mobile) sees the left gutter.
await say(alice, bob.id, 'hey from Alice 👋');
await say(alice, bob.id, 'swipe me to reply');
await say(alice, bob.id, 'but the left edge is for going back');
await waitForMessage(bob, alice.id, 'left edge is for going back');
const bobDm = await chatWith(bob, alice.id);
await shotChat(bob, 'gutter-1to1', bobDm);

// Group — avatars should still provide the inset (unchanged).
const g = await group(alice, 'Trip', [bob, cara]);
await say(alice, g, 'group hello', { isGroup: true });
await say(cara, g, 'hi from Cara', { isGroup: true });
await waitForMessage(bob, g, 'hi from Cara', { isGroup: true });
await shotChat(bob, 'gutter-group', g);

await sweep([alice, bob, cara]);
await done();
