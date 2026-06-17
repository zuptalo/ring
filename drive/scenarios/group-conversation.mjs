/**
 * Example scenario: three users, a group, a fanned-out conversation, captured.
 *
 *   node drive/scenarios/group-conversation.mjs
 *   HEADED=1 node drive/scenarios/group-conversation.mjs
 *
 * Demonstrates the multi-user pattern (spin N accounts, pair, group, converse) and
 * that GROUP ids are shared across devices (unlike per-device 1:1 chat ids).
 */
import {
  createAccount, pair, group, say, waitForMessage, shot, sweep, done,
} from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
const carol = await createAccount({ name: 'Carol', mobile: true });

// Pair the owner with each member (group fan-out reaches them; B↔C session is
// established on demand when they first message each other).
await pair(alice, bob);
await pair(alice, carol);

// Group id is SHARED — every member converges on the same id.
const trip = await group(alice, 'Trip', [bob, carol]);

await say(bob, trip, 'who is in? 🏔️', { isGroup: true });
await waitForMessage(alice, trip, 'who is in?', { isGroup: true });
await waitForMessage(carol, trip, 'who is in?', { isGroup: true });
await say(alice, trip, "I'm in 🙌", { isGroup: true });
await waitForMessage(carol, trip, "I'm in", { isGroup: true });

// Inspect the group from two perspectives (Carol on mobile).
await shot(alice, 'group-from-alice', { route: `/chat/${trip}` });
await shot(carol, 'group-from-carol-mobile', { route: `/chat/${trip}` });

await sweep([alice, bob, carol]);
await done();
