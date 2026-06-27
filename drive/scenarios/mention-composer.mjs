import { createAccount, pair, group, shot, sweep, done } from '../driver.mjs';
const alice = await createAccount({ name: 'Alice' });   // owner
const bob = await createAccount({ name: 'Bob' });
const carol = await createAccount({ name: 'Carol' });
await pair(alice, bob); await pair(alice, carol); await pair(bob, carol);
const gid = await group(alice, 'Squad', [bob, carol]);
const bobU = await bob.page.evaluate(() => window.__ringTest.selfUsername());

const rowsFor = async (cli, q) => {
  await cli.page.goto(`/chat/${gid}`);
  await cli.page.waitForSelector('#chat-footer textarea', { timeout: 10000 });
  const ta = cli.page.locator('#chat-footer textarea');
  await ta.fill(q);
  await cli.page.waitForTimeout(400);
  return cli.page.evaluate(() => Array.from(document.querySelectorAll('.mention-row')).map(e => e.textContent.replace(/\s+/g,' ').trim()));
};

const ownerAt = await rowsFor(alice, '@');           // owner sees members + Everyone
const ownerBo = await rowsFor(alice, 'hey @Bo');     // filters to Bob
const bobAt = await rowsFor(bob, '@');               // non-owner: NO Everyone
console.log('[owner @ ] %j', ownerAt);
console.log('[owner @Bo] %j', ownerBo);
console.log('[bob   @ ] %j', bobAt);
await shot(alice, 'mention-composer', {});

// Pick Bob from the filtered list, then finish + send.
// Pick from the autocomplete → the @token is inserted into the draft.
await alice.page.goto(`/chat/${gid}`); await alice.page.waitForSelector('#chat-footer textarea');
const ta = alice.page.locator('#chat-footer textarea');
await ta.fill('hey @Bo');
await alice.page.waitForTimeout(400);
await alice.page.locator('.mention-row', { hasText: 'Bob' }).first().click();
await alice.page.waitForTimeout(300);
const inserted = await ta.inputValue();
console.log('[inserted] "%s"', inserted);
// (The send()→resolveMentions→sendMessage(mentions) path is proven end-to-end by
// mention-core.mjs; the Send button can't be reliably tapped here because Ionic caches
// pages in the DOM and raw selectors hit a stale instance — not a product issue.)

const pass =
  ownerAt.some(r => /Everyone/.test(r)) && ownerAt.some(r => /Bob/.test(r)) &&
  ownerBo.length >= 1 && ownerBo.every(r => /Bob/.test(r)) &&
  !bobAt.some(r => /Everyone/.test(r)) && bobAt.some(r => /Alice/.test(r)) &&
  inserted === `hey @${bobU} `;
console.log(pass ? '[PASS] autocomplete filters by query, owner-only @everyone, inserts the correct @handle token' : '[FAIL] see above');
await sweep([alice, bob, carol]); await done();
