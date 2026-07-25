// spec 1062 light-theme fix — the pinned-tile tick chip + online dot + group count
// must NOT render as black blobs in light theme (#fff fallback for --ion-background-color).
import { createAccount, pair, group, chatWith, say, waitForMessage, shot, sweep } from '../driver.mjs';

const a = await createAccount({ name: 'Alice', mobile: true });
const b = await createAccount({ name: 'Bob', mobile: true });
const c = await createAccount({ name: 'Carol', mobile: true });
await pair(a, b);
await pair(a, c);
await pair(b, c);

// Force Alice into LIGHT theme.
await a.page.evaluate(() => window.__ringTest.setSetting('appearance.theme', 'light'));

// 1:1 with Bob: send + have Bob read it (seen tick), Bob online (dot).
const ab = await say(a, b.id, 'light theme tick');
await waitForMessage(b, a.id, 'light theme tick');
await b.page.goto(`/chat/${await chatWith(b, a.id)}`); // Bob reads → seen; Bob online

// A group so the tile shows the online count pill too.
const gid = await group(a, 'Team', [b, c]);
await say(b, gid, 'hi', { isGroup: true });
await waitForMessage(a, gid, 'hi', { isGroup: true });

await a.page.waitForTimeout(3000); // presence settle

// Pin both the 1:1 and the group, then screenshot Alice's light-theme chat list.
await a.page.evaluate((id) => window.__ringTest.pinChat(id, true), ab);
await a.page.evaluate((id) => window.__ringTest.pinChat(id, true), gid);
await a.page.waitForTimeout(500);
await shot(a, 'pin-tick-light', { route: '/tabs/chats' });

await sweep([a, b, c]);
