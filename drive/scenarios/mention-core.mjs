import { createAccount, pair, group, sweep, done } from '../driver.mjs';
const alice = await createAccount({ name: 'Alice' });   // group owner
const bob = await createAccount({ name: 'Bob' });
const carol = await createAccount({ name: 'Carol' });
await pair(alice, bob); await pair(alice, carol); await pair(bob, carol);
const gid = await group(alice, 'Squad', [bob, carol]);   // shared group id

// Bob sets the group to "Badge only" (content:none) — normally NO banner.
await bob.page.evaluate((id) => window.__ringTest.setChatNotify(id, { content: 'none' }), gid);
await bob.page.goto('/tabs/chats');
await bob.page.waitForFunction(() => !!window.__ringTest, null, { timeout: 15000 });
await bob.page.waitForTimeout(800);

const banners = (cli) => cli.page.evaluate(() => Array.from(document.querySelectorAll('.nb')).map(e => e.textContent.replace(/\s+/g,' ').trim()));
const um = (cli) => cli.page.evaluate((id) => window.__ringTest.unreadMentions(id), gid);
const watchBanner = async (cli, ms) => { let seen = []; for (let t=0;t<ms;t+=150){ const n = await banners(cli); if (n.length>seen.length) seen=n; await new Promise(r=>setTimeout(r,150)); } return seen; };

// Alice @mentions Bob → escalates past content:none → Bob gets a banner; Carol does not.
await alice.page.evaluate(([id, bid]) => window.__ringTest.sendWithMentions(id, 'ping for you', [bid]), [gid, bob.id]);
const bobBanner = await watchBanner(bob, 2500);
console.log('[mention] bobBanner=%j  bobUnreadMentions=%d  carolUnreadMentions=%d', bobBanner, await um(bob), await um(carol));

await bob.page.waitForTimeout(5500); // let banners + settle clear
// A PLAIN (no-mention) message → content:none suppresses it → no banner, mention count unchanged.
await alice.page.evaluate((id) => window.__ringTest.sendChatMessage(id, 'just chatter'), gid);
const bobPlain = await watchBanner(bob, 2500);
console.log('[plain  ] bobBanner=%j  bobUnreadMentions=%d', bobPlain, await um(bob));

// Opening the group clears the unread-mentions.
await bob.page.goto(`/chat/${gid}`); await bob.page.waitForTimeout(1200);
const afterOpen = await um(bob);
console.log('[read   ] bobUnreadMentions=%d', afterOpen);

const pass =
  bobBanner.some(t => /mentioned you|ping for you/.test(t)) &&
  (await um(carol)) === 0 &&
  bobPlain.length === 0 &&
  afterOpen === 0;
console.log(pass ? '[PASS] mention escalates past badge-only + counts; non-mention stays silent; read clears it' : '[FAIL] see above');
await sweep([alice, bob, carol]); await done();
