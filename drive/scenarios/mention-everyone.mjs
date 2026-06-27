import { createAccount, pair, group, sweep, done } from '../driver.mjs';
const alice = await createAccount({ name: 'Alice' });   // owner
const bob = await createAccount({ name: 'Bob' });
const carol = await createAccount({ name: 'Carol' });
await pair(alice, bob); await pair(alice, carol); await pair(bob, carol);
const gid = await group(alice, 'Squad', [bob, carol]);
await new Promise(r => setTimeout(r, 1500)); // let the 'create' card (createdBy) settle on members
const um = (cli) => cli.page.evaluate((id) => window.__ringTest.unreadMentions(id), gid);

// 1) Owner @everyone → every member is mentioned.
await alice.page.evaluate((id) => window.__ringTest.sendWithMentions(id, 'all hands meeting', [], true), gid);
await new Promise(r => setTimeout(r, 1800));
const bobUM = await um(bob), carolUM = await um(carol);
console.log('[owner @everyone] bobUM=%d carolUM=%d', bobUM, carolUM);

// chat-row "@" marker on Bob's list
await bob.page.goto('/tabs/chats'); await bob.page.waitForTimeout(900);
const bobMarker = await bob.page.evaluate(() => document.querySelectorAll('.mention-badge').length);
console.log('[row marker] bob .mention-badge count=%d', bobMarker);

// 2) NON-owner @everyone (Bob) → recipients must IGNORE it (re-validate sender == owner).
await bob.page.evaluate((id) => window.__ringTest.sendWithMentions(id, 'bob broadcast', [], true), gid);
await new Promise(r => setTimeout(r, 1800));
const carolUM2 = await um(carol), aliceUM = await um(alice);
console.log('[non-owner @everyone] carolUM=%d (should stay 1) aliceUM=%d (should be 0)', carolUM2, aliceUM);

const pass = bobUM === 1 && carolUM === 1 && bobMarker >= 1 && carolUM2 === 1 && aliceUM === 0;
console.log(pass ? '[PASS] owner @everyone mentions all + row marker; non-owner @everyone is rejected on receive' : '[FAIL] see above');
await sweep([alice, bob, carol]); await done();
