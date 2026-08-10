/**
 * Spec 1065 US2: author-only post view count, stamped with each person's FIRST sighting.
 *
 *   node drive/scenarios/post-views.mjs
 *   HEADED=1 node drive/scenarios/post-views.mjs
 *
 * Alice posts. Bob opens it, Carol only scrolls it into view in her feed, Dave
 * never looks. Alice should see "Seen by 2" with both times; nobody else sees a
 * count at all, including by asking the server directly.
 */
import { createAccount, pair, shot, sweep, done, poll } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
const carol = await createAccount({ name: 'Carol' });
const dave = await createAccount({ name: 'Dave' });

for (const c of [alice, bob, carol, dave]) {
  const btn = c.page.getByText("I'VE SAVED IT");
  if (await btn.count()) await btn.click();
}
for (const m of [bob, carol, dave]) await pair(alice, m);

const go = async (c, path) => {
  await c.page.evaluate((p) => {
    void window.__ringTest.navigate(p);
  }, path);
  await c.page.waitForTimeout(900);
};

// Alice posts to her wall.
const postId = await alice.page.evaluate(() => window.__ringTest.post({ body: 'sunrise over the ridge' }));
console.log('[post]', postId);

for (const m of [bob, carol, dave]) {
  await poll(
    () => m.page.evaluate(() => window.__ringTest.wallPostIds()),
    (ids) => Array.isArray(ids) && ids.includes(postId),
    { label: `${m.label} has the post` },
  );
}

// Bob opens the post itself.
await go(bob, `/wall/post/${postId}`);
await bob.page.waitForTimeout(1200);

// Carol only lets it rest in her feed — past the dwell, so it counts.
await go(carol, '/tabs/wall');
await carol.page.waitForTimeout(2500);

await poll(
  () => alice.page.evaluate((id) => window.__ringTest.postViews(id), postId),
  (vs) => Array.isArray(vs) && vs.length === 2,
  { label: 'two viewers recorded' },
);

const views = await alice.page.evaluate((id) => window.__ringTest.postViews(id), postId);
console.log('views:', JSON.stringify(views, null, 1));

// A repeat look must not move the stamp or the count (FR-013).
const before = JSON.stringify(views);
await go(bob, '/tabs/wall');
await go(bob, `/wall/post/${postId}`);
await bob.page.waitForTimeout(1500);
const after = await alice.page.evaluate((id) => window.__ringTest.postViews(id), postId);
console.log(
  JSON.stringify(after) === before
    ? 'OK: a repeat view changed neither the count nor the first-seen stamp'
    : `REGRESSION: views moved\n  before ${before}\n  after  ${JSON.stringify(after)}`,
);

// Dave never looked, so he must be absent.
console.log(
  after.some((v) => v.viewer === dave.id) ? 'REGRESSION: Dave counted without looking' : 'OK: Dave absent',
);

// Author-only, enforced by the server, not just hidden in the app.
const asBob = await bob.page.evaluate(async (id) => {
  try {
    return await window.__ringTest.postViews(id);
  } catch (e) {
    return `error: ${String(e)}`;
  }
}, postId);
console.log('bob asking for the viewer list:', JSON.stringify(asBob));

await go(alice, '/tabs/wall');
await alice.page.waitForTimeout(1200);
await shot(alice, 'us2-feed-seen-chip');

await go(alice, `/wall/post/${postId}`);
await alice.page.waitForTimeout(900);
await shot(alice, 'us2-post-seen-row');
await alice.page.locator('ion-item.seen-row').click();
await alice.page.waitForTimeout(900);
await shot(alice, 'us2-viewer-sheet');

// A non-author must see no count and no row anywhere.
await go(bob, `/wall/post/${postId}`);
await bob.page.waitForTimeout(900);
await shot(bob, 'us2-post-as-non-author');

await sweep([alice, bob, carol, dave]);
await done();
