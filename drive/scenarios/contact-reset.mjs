import { createAccount, pair, sweep, done } from '../driver.mjs';
const bob = await createAccount({ name: 'Bob' });
const alice = await createAccount({ name: 'Alice' });
await pair(bob, alice);
const AV = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
const readC = (id) => bob.page.evaluate((aid) => new Promise((res) => {
  const r = indexedDB.open('ring'); r.onsuccess = () => { const c = r.result.transaction('contacts','readonly').objectStore('contacts').get(aid);
    c.onsuccess = () => res(c.result ? { name: c.result.name, remoteName: c.result.remoteName ?? null, localProfile: !!c.result.localProfile } : null); }; }), id);

await bob.page.evaluate(() => window.__ringTest.syncDirectory());
await bob.page.waitForTimeout(500);
console.log('[1 baseline    ]', JSON.stringify(await readC(alice.id)));

// Bob overrides the name locally.
await bob.page.evaluate((id) => window.__ringTest.setContactLocalProfile(id, 'My Nickname', undefined), alice.id);
console.log('[2 overridden  ]', JSON.stringify(await readC(alice.id)));

// Meanwhile Alice changes her server name to something NEW (different from the cached remoteName).
await alice.page.evaluate((av) => window.__ringTest.setProfile('Alice Current', av), AV);
await bob.page.waitForTimeout(400);

// Reset → must pull Alice's CURRENT server value ("Alice Current"), not stale cache or the override.
await bob.page.evaluate((id) => window.__ringTest.resetContactProfile(id), alice.id);
await bob.page.waitForTimeout(800);
const afterReset = await readC(alice.id);
console.log('[3 after reset ]', JSON.stringify(afterReset));

const pass = afterReset.name === 'Alice Current' && afterReset.localProfile === false;
console.log(pass ? '[PASS] reset pulled the peer’s CURRENT name from the server and dropped the override' : '[FAIL] see above');
await sweep([bob, alice]); await done();
