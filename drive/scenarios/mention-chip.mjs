import { createAccount, pair, group, shot, sweep, done } from '../driver.mjs';
const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
const carol = await createAccount({ name: 'Carol' });
await pair(alice, bob); await pair(alice, carol); await pair(bob, carol);
const gid = await group(alice, 'Squad', [bob, carol]);
const bobU = await bob.page.evaluate(() => window.__ringTest.selfUsername());
console.log('[bob username] %s', bobU);

await alice.page.evaluate(([id, u, bid]) => window.__ringTest.sendWithMentions(id, `hello @${u} look here`, [bid]), [gid, bobU, bob.id]);

const readChips = async (cli) => {
  await cli.page.goto(`/chat/${gid}`);
  await cli.page.waitForFunction(() => document.querySelector('.text'), null, { timeout: 10000 }).catch(()=>{});
  await cli.page.waitForTimeout(900);
  return cli.page.evaluate(() => Array.from(document.querySelectorAll('.mention')).map(e => ({ text: e.textContent.trim(), me: e.classList.contains('me') })));
};
const carolChips = await readChips(carol);
const bobChips = await readChips(bob);
console.log('[carol chips] %j', carolChips);
console.log('[bob   chips] %j', bobChips);
await shot(bob, 'mention-chip', {});

const pass =
  carolChips.some(c => /@Bob/.test(c.text) && !c.me) &&
  bobChips.some(c => c.me);
console.log(pass ? '[PASS] mention renders as a chip; self-mention emphasized on the mentioned user' : '[FAIL] see above');
await sweep([alice, bob, carol]); await done();
