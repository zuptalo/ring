import { createAccount, pair, shot, sweep, done } from '../driver.mjs';
const bob = await createAccount({ name: 'Bob' });
const alice = await createAccount({ name: 'Alice' });
await pair(bob, alice);

const AV = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
const readContact = (id) => bob.page.evaluate((aid) => new Promise((res) => {
  const r = indexedDB.open('ring');
  r.onsuccess = () => { const db = r.result; const c = db.transaction('contacts','readonly').objectStore('contacts').get(aid);
    c.onsuccess = () => res(c.result ? { name: c.result.name, pendingName: c.result.pendingName ?? null, remoteName: c.result.remoteName ?? null, localProfile: !!c.result.localProfile } : null); }; }), id);
const banners = () => bob.page.evaluate(() => Array.from(document.querySelectorAll('.nb')).map(e => e.textContent.replace(/\s+/g,' ').trim()));

// Bootstrap: pull Alice's current profile so remoteName is recorded (applies directly).
await bob.page.evaluate(() => window.__ringTest.syncDirectory());
await bob.page.waitForTimeout(600);
console.log('[baseline]', JSON.stringify(await readContact(alice.id)));

// Alice renames + republishes; Bob pulls → should STAGE a pending change (not auto-apply).
await alice.page.evaluate((av) => window.__ringTest.setProfile('Alice Renamed', av), AV);
await bob.page.evaluate(() => window.__ringTest.syncDirectory());
await bob.page.waitForTimeout(800);
const staged = await readContact(alice.id);
console.log('[staged  ]', JSON.stringify(staged), 'banners=', JSON.stringify(await banners()));

// Adopt via the banner's "Use it" button.
await bob.page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.nb .nb-action'));
  const use = btns.find(b => /use it/i.test(b.textContent));
  if (use) use.click();
});
await bob.page.waitForTimeout(600);
const adopted = await readContact(alice.id);
console.log('[adopted ]', JSON.stringify(adopted));

// Dismiss path + no re-prompt: rename again, dismiss, re-sync same value → no new pending.
await alice.page.evaluate((av) => window.__ringTest.setProfile('Alice Third', av), AV);
await bob.page.evaluate(() => window.__ringTest.syncDirectory());
await bob.page.waitForTimeout(700);
const staged2 = await readContact(alice.id);
await bob.page.evaluate(() => { const b = Array.from(document.querySelectorAll('.nb .nb-action')).find(x=>/not now/i.test(x.textContent)); if (b) b.click(); });
await bob.page.waitForTimeout(500);
await bob.page.evaluate(() => window.__ringTest.syncDirectory()); // same value again
await bob.page.waitForTimeout(700);
const afterDismiss = await readContact(alice.id);
console.log('[staged2 ]', JSON.stringify(staged2));
console.log('[dismiss ]', JSON.stringify(afterDismiss), 'banners=', JSON.stringify(await banners()));

const pass =
  staged.name === 'Alice' && staged.pendingName === 'Alice Renamed' &&
  adopted.name === 'Alice Renamed' && adopted.pendingName === null &&
  staged2.pendingName === 'Alice Third' &&
  afterDismiss.name === 'Alice Renamed' && afterDismiss.pendingName === null;
console.log(pass ? '[PASS] rename stages a prompt; adopt applies; dismiss keeps old + no re-prompt' : '[FAIL] see above');
await shot(bob, 'contact-rename-banner', {});
await sweep([bob, alice]); await done();
