/**
 * Spec 1048 verification: reaction notifications + reply escalation, live.
 *
 *   node drive/scenarios/reaction-notify-1048.mjs
 *
 * Bob reacts to Alice's message → Alice (on the Chats tab) should show the
 * in-app banner "Reacted ❤️ to: …". Then in a muted group, Bob replies to
 * Alice's message → the banner pierces the mute. Screenshots in .tmp/drive/.
 */
import {
  createAccount, pair, group, chatWith, say, waitForMessage, messageId, react, shot, sweep, done,
} from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
const cara = await createAccount({ name: 'Cara' });
await pair(alice, bob);
await pair(alice, cara);

// --- US1: reaction to Alice's 1:1 message banners on Alice's device ---
await say(alice, bob.id, 'my painting is done');
await waitForMessage(bob, alice.id, 'my painting is done');
const bobChat = await chatWith(bob, alice.id);
const mid = await messageId(bob, bobChat, 'my painting is done');

// Park Alice on the Chats tab so the banner (not the open chat) shows the reaction.
await alice.page.evaluate(() => window.__ringTest.navigate('/tabs/chats'));
await react(bob, mid, '❤️');
await alice.page.waitForFunction(
  () => window.__ringTest.notices().some((n) => String(n.body).includes('Reacted ❤️')),
  undefined,
  { timeout: 30_000 },
);
await shot(alice, 'alice-reaction-banner');

// --- US2: a reply to Alice pierces her muted group ---
const gid = await group(alice, 'Mural crew', [bob, cara]);
await say(alice, gid, 'sketch is ready', { isGroup: true });
await waitForMessage(bob, gid, 'sketch is ready', { isGroup: true });
await alice.page.evaluate((id) => window.__ringTest.muteChat(id, Date.now() + 3_600_000), gid);
const gm = await messageId(bob, gid, 'sketch is ready');
await bob.page.evaluate(
  ([id, q]) => window.__ringTest.sendReply(id, 'love it, adding clouds', q),
  [gid, gm],
);
await alice.page.waitForFunction(
  () => window.__ringTest.notices().some((n) => String(n.body).includes('love it, adding clouds')),
  undefined,
  { timeout: 30_000 },
);
await shot(alice, 'alice-muted-group-reply-banner');
console.log('unreadMentions:', await alice.page.evaluate((id) => window.__ringTest.unreadMentions(id), gid));

// --- Settings: the new Reactions sound page renders ---
await shot(alice, 'alice-notifications-settings', { route: '/settings/notifications' });
await shot(alice, 'alice-reaction-sound-page', { route: '/settings/notifications-reactions-sound' });

await sweep([alice, bob, cara]);
await done();
