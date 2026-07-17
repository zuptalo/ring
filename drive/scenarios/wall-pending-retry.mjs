/**
 * Spec 1024 (US2): the Wall's FAILED pending-post card — "Couldn't post" with Retry/Cancel.
 * Seeds a failed outbox record, screenshots the card, taps Cancel, confirms the outbox cleared.
 *
 *   HEADED=1 node drive/scenarios/wall-pending-retry.mjs
 * Screenshots land in .tmp/drive/.
 */
import { preflight, createAccount, shot, sweep, done, poll, SHOT_DIR } from '../driver.mjs';
import path from 'node:path';

await preflight();
const me = await createAccount({ name: 'Pending Pat', mobile: true });

// Reach the Wall, then make sure cold-start recovery has already run (it's once-per-load) before we
// seed an IN-SESSION failure — otherwise recovery would sweep our seed into a draft (correct in real
// life, but here we want the in-session Retry/Cancel card, which renders reactively).
await me.page.goto('/tabs/wall');
await me.page.waitForFunction(() => !!window.__ringTest, null, { timeout: 30_000 });
await me.page.evaluate(() => window.__ringTest.recoverPending());
const id = await me.page.evaluate(() => window.__ringTest.seedFailedPendingPost('My stuck post'));
console.log('seeded failed pending post', id);
await poll(
  () => me.page.evaluate(() => !!document.querySelector('.pending-post')),
  Boolean,
  { label: 'pending card visible' },
);
await shot(me, 'pending-failed-card');

// The card shows the two actions.
const labels = await me.page.evaluate(() =>
  Array.from(document.querySelectorAll('.pending-actions ion-button')).map((b) => b.textContent.trim()),
);
console.log('action buttons:', labels);

// Tap Cancel → the outbox record is discarded.
const before = await me.page.evaluate(() => window.__ringTest.pendingPostCount());
await me.page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.pending-actions ion-button'));
  btns.find((b) => b.textContent.trim() === 'Cancel')?.click();
});
await poll(
  () => me.page.evaluate(() => window.__ringTest.pendingPostCount()),
  (n) => n === 0,
  { label: 'outbox cleared after Cancel' },
);
const after = await me.page.evaluate(() => window.__ringTest.pendingPostCount());
console.log(`outbox count: ${before} -> ${after}`);
await shot(me, 'pending-after-cancel');

console.log('screenshots in', path.relative(process.cwd(), SHOT_DIR));
await sweep([me]);
await done();
