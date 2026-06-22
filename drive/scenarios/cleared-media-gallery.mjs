/** spec 2007: media/docs DELETED to free space must vanish from the Media/Docs tabs,
 *  not leave empty placeholder tiles/rows. */
import { createAccount, pair, chatWith, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Alice' });
const b = await createAccount({ name: 'Bob' });
await pair(a, b);
const chatId = await chatWith(a, b.id);

await a.page.evaluate(async (cid) => {
  const t = window.__ringTest;
  await t.seedMedia(cid, 'image', 20_000_000);
  await t.seedMedia(cid, 'image', 20_000_000);
  await t.seedMedia(cid, 'video', 30_000_000);
  await t.seedMedia(cid, 'file', 15_000_000);
}, chatId);

const counts = (cid) =>
  a.page.evaluate(async (id) => {
    const q = await import('/src/db/queries.ts');
    return {
      media: (await q.listChatMedia(id)).length,
      docs: (await q.listChatDocs(id)).length,
    };
  }, cid);

const before = await counts(chatId);
await shot(a, 'cleared-before', { route: `/chat/${chatId}/media` });

// Delete everything larger than 10 MB (what the user did).
await a.page.evaluate((cid) => window.__ringTest.deleteMediaLargerThan(10_000_000, cid), chatId);
const after = await counts(chatId);
await shot(a, 'cleared-after', { route: `/chat/${chatId}/media` });

console.log('\n=== cleared-media gallery ===');
console.log('  before delete:', before, '(expect media:3, docs:1)');
console.log('  after  delete:', after, '(expect media:0, docs:0)');
console.log(
  after.media === 0 && after.docs === 0 && before.media === 3 && before.docs === 1
    ? '  ✅ deleted media/docs no longer appear in the tabs'
    : '  ❌ stale placeholders remain',
);

await sweep([a, b]);
await done();
