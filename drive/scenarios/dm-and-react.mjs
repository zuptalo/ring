/**
 * Example scenario: a 1:1 conversation + a reaction, captured on mobile.
 *
 *   node drive/scenarios/dm-and-react.mjs        (headless)
 *   HEADED=1 node drive/scenarios/dm-and-react.mjs   (watch it)
 *
 * Copy this as a starting point for your own investigation. Screenshots land in
 * .tmp/drive/ — Read them back to inspect the UI.
 */
import {
  createAccount, pair, chatWith, say, waitForMessage, messageId, react, shot, sweep, done,
} from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
await pair(alice, bob);

// 1:1 — pass the PEER id; say()/waitForMessage() resolve each side's own chat id.
await say(alice, bob.id, 'hey from Alice 👋');
await waitForMessage(bob, alice.id, 'hey from Alice');

// Bob reacts to Alice's message (resolve the message id on Bob's device first).
const bobChat = await chatWith(bob, alice.id);
const mid = await messageId(bob, bobChat, 'hey from Alice');
await react(bob, mid, '🔥');
await waitForMessage(alice, bob.id, 'hey from Alice'); // ensure A's copy exists before shooting

// Inspect: Bob's mobile chat (with the reaction) and Alice's desktop chat.
await shot(bob, 'bob-mobile-chat', { route: `/chat/${bobChat}` });
await shot(alice, 'alice-chat', { route: `/chat/${await chatWith(alice, bob.id)}` });

await sweep([alice, bob]);
await done();
