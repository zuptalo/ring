import { createAccount, pair, shot, done, poll } from '../driver.mjs';
const a = await createAccount({ name: 'Alice' });
const b = await createAccount({ name: 'Bob' });
const c = await createAccount({ name: 'Carol' });
for (const x of [a, b, c]) { const t = x.page.getByText("I'VE SAVED IT"); if (await t.count()) await t.click(); }
await pair(a, b); await pair(a, c);
const go = async (x, p) => { await x.page.evaluate((q) => { void window.__ringTest.navigate(q); }, p); await x.page.waitForTimeout(900); };
const pid = await a.page.evaluate(() => window.__ringTest.post({ body: 'ridge line at dawn' }));
for (const m of [b, c]) await poll(() => m.page.evaluate(() => window.__ringTest.wallPostIds()), (ids) => ids.includes(pid), { label: `${m.label} has post` });

await b.page.evaluate((id) => window.__ringTest.reactToPost(id, '👍'), pid);
await c.page.evaluate((id) => window.__ringTest.reactToPost(id, '❤️'), pid);
await new Promise(r => setTimeout(r, 1500));
// Bob changes his mind: 👍 -> 🎉 (must show ONCE, with 🎉)
await b.page.evaluate((id) => window.__ringTest.reactToPost(id, '👍'), pid);
await b.page.evaluate((id) => window.__ringTest.reactToPost(id, '🎉'), pid);
await new Promise(r => setTimeout(r, 2000));

await go(a, `/wall/post/${pid}`);
await a.page.waitForTimeout(1200);
await a.page.getByText('See who reacted').click();
await a.page.waitForTimeout(900);
await shot(a, 'us3-reactors-sheet');

await go(b, `/wall/post/${pid}`);
await b.page.waitForTimeout(900);
console.log('non-author sees "See who reacted":', await b.page.getByText('See who reacted').count());
await shot(b, 'us3-as-non-author');
await done();
