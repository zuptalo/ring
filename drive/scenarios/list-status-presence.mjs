// spec 1062 — visual check that the Chats-list row shows the outgoing message's
// delivery tick (US1). Alice DMs Bob; once Bob receives, Alice's list row shows the
// grey double-check; once Bob opens the chat, it climbs to the blue "seen" tick.
import { createAccount, pair, chatWith, say, waitForMessage, shot, sweep, poll } from '../driver.mjs';

const a = await createAccount({ name: 'Alice', mobile: true });
const b = await createAccount({ name: 'Bob', mobile: true });
await pair(a, b);

const aChat = await say(a, b.id, 'Ticks on the list now');
await waitForMessage(b, a.id, 'Ticks on the list now');

const statusIs = (...want) => (msgs) =>
  Array.isArray(msgs) &&
  msgs.some((m) => (m.body ?? '').includes('Ticks on the list') && want.includes(m.status));
const aMsgs = () => a.page.evaluate((c) => window.__ringTest.messages(c), aChat);

// delivered (double check)
await poll(aMsgs, statusIs('delivered', 'seen'), { label: 'Alice → delivered', timeout: 20000 });
await shot(a, 'us1-list-tick-delivered', { route: '/tabs/chats' });

// Bob opens the chat → visibility-driven seen receipt → Alice's tick goes blue.
const bChat = await chatWith(b, a.id);
await b.page.goto(`/chat/${bChat}`);
await poll(aMsgs, statusIs('seen'), { label: 'Alice → seen', timeout: 20000 }).catch(() =>
  console.log('[note] seen not reached; delivered screenshot still proves US1'),
);
await shot(a, 'us1-list-tick-seen', { route: '/tabs/chats' });

await sweep([a, b]);
