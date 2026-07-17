import { createAccount, pair, shot, sweep, done } from '../driver.mjs';
const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);
const ids = (cli) => cli.page.evaluate(() => window.__ringTest.contactIds());
console.log('[before] %j', await ids(alice));

await alice.page.goto(`/contact/${bob.id}`);
await alice.page.waitForTimeout(1000);
await shot(alice, 'contact-page', {});
const hasDelete = await alice.page.evaluate(() => Array.from(document.querySelectorAll('ion-item')).some(i => /Delete contact/.test(i.textContent)));
console.log('[Delete contact item present]', hasDelete);

await alice.page.locator('ion-item', { hasText: 'Delete contact' }).first().click();
await alice.page.waitForTimeout(700);
const alertBtns = await alice.page.evaluate(() => Array.from(document.querySelectorAll('ion-alert button')).map(b => b.textContent.trim()));
console.log('[confirm alert]', JSON.stringify(alertBtns));
await alice.page.locator('ion-alert button', { hasText: 'Delete' }).click();
await alice.page.waitForTimeout(1500);
console.log('[after delete] url=%s contacts=%j', alice.page.url(), await ids(alice));
await sweep([alice, bob]); await done();
