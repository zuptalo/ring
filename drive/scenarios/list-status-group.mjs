// spec 1062 US3+US4 — group online count (header, list row, pinned tile) and
// per-member online dots on avatars in the conversation. Alice is in a group with
// Bob + Carol (both her contacts, both foregrounded → online), so she should see
// "2 online" and dots on Bob's and Carol's avatars.
import { createAccount, pair, group, say, waitForMessage, shot, sweep } from '../driver.mjs';

const a = await createAccount({ name: 'Alice', mobile: true });
const b = await createAccount({ name: 'Bob', mobile: true });
const c = await createAccount({ name: 'Carol', mobile: true });
await pair(a, b);
await pair(a, c);
await pair(b, c);

const gid = await group(a, 'Team', [b, c]);

// Bob and Carol both post, so both their avatars (with dots) appear in Alice's view.
await say(b, gid, 'Bob here', { isGroup: true });
await say(c, gid, 'Carol here', { isGroup: true });
await waitForMessage(a, gid, 'Bob here', { isGroup: true });
await waitForMessage(a, gid, 'Carol here', { isGroup: true });

// Let presence propagate (Bob + Carol are foregrounded contacts → online to Alice).
await a.page.waitForTimeout(3500);

// US4 + US3-header: inside the group — header "2 online" + dots on member avatars.
await shot(a, 'us4-group-convo', { route: `/chat/${gid}` });

// US3: group row in the chat list shows the compact count.
await shot(a, 'us3-group-list', { route: '/tabs/chats' });

// US3: pinned group tile shows the count pill.
await a.page.evaluate((g) => window.__ringTest.pinChat(g, true), gid);
await a.page.waitForTimeout(500);
await shot(a, 'us3-group-tile', { route: '/tabs/chats' });

await sweep([a, b, c]);
