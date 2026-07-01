/**
 * Spec 1024: a post interrupted by a full app close is recovered as a DRAFT. The Wall shows a
 * "Post didn't finish" card (Finish / Discard); Finish reopens the composer with the caption + voice
 * note restored and the library media dropped to re-add.
 *
 *   HEADED=1 node drive/scenarios/wall-interrupted-finish.mjs
 */
import { preflight, createAccount, shot, sweep, done, poll, SHOT_DIR } from '../driver.mjs';
import path from 'node:path';

await preflight();
const me = await createAccount({ name: 'Resume Rita', mobile: true });

// Seed an interrupted draft: caption + a voice note, with library media marked dropped.
const id = await me.page.evaluate(() => window.__ringTest.seedInterruptedPost('My recovered caption', true));
console.log('seeded interrupted draft', id);

await me.page.goto('/tabs/wall');
await poll(
  () => me.page.evaluate(() => !!document.querySelector('.pending-post')),
  Boolean,
  { label: 'interrupted card visible' },
);
const sub = await me.page.evaluate(() => document.querySelector('.pending-post .sub')?.textContent?.trim());
const actions = await me.page.evaluate(() =>
  Array.from(document.querySelectorAll('.pending-actions ion-button')).map((b) => b.textContent.trim()),
);
console.log('card sub:', sub, '| actions:', actions);
await shot(me, 'interrupted-card');

// Tap Finish → composer opens with the caption + voice note restored.
await me.page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.pending-actions ion-button'));
  btns.find((b) => b.textContent.trim() === 'Finish')?.click();
});
await poll(
  () => me.page.evaluate(() => location.hash.includes('/wall/compose') || location.pathname.includes('/wall/compose')),
  Boolean,
  { label: 'composer route' },
);
// Let the draft load + paint.
await poll(
  () => me.page.evaluate(() => {
    const ta = document.querySelector('ion-textarea');
    return !!ta && !!(ta.value || '').trim();
  }),
  Boolean,
  { label: 'caption restored' },
);
// Both attachments (the photo and the voice clip) should be staged in the composer.
await poll(
  () => me.page.evaluate(() => document.querySelectorAll('.stage-thumb').length),
  (n) => n === 2,
  { label: 'photo + voice restored' },
);
const restored = await me.page.evaluate(() => {
  const ta = document.querySelector('ion-textarea');
  return {
    caption: ta?.value || '',
    stagedTiles: document.querySelectorAll('.stage-thumb').length,
    hasImageTile: !!document.querySelector('.stage-thumb img'),
    hasVoiceTile: !!document.querySelector('.stage-voice'),
  };
});
console.log('restored in composer:', JSON.stringify(restored));
await shot(me, 'interrupted-composer');

console.log('screenshots in', path.relative(process.cwd(), SHOT_DIR));
await sweep([me]);
await done();
