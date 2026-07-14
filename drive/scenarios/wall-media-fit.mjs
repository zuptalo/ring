/**
 * Spec 2034 visual check: tall (9:16-ish) single media on the Wall — image AND
 * video — must letterbox WHOLE inside a 4:5 capped box (blurred fill, controls
 * visible), while landscape media keeps its true ratio. Mobile viewport.
 *
 *   node drive/scenarios/wall-media-fit.mjs
 */
import { createAccount, pair, shot, sweep, done } from '../driver.mjs';

const kim = await createAccount({ name: 'Kim', mobile: true });
const pal = await createAccount({ name: 'Pal' });
await pair(kim, pal); // a post needs an audience

// Tall image + tall video + a landscape video, through the REAL createPost path.
await kim.page.evaluate(() => window.__ringTest.postTallMedia('image'));
await kim.page.evaluate(() => window.__ringTest.postTallMedia('video'));
await kim.page.evaluate(() => window.__ringTest.postVideo());

// Let posters/blobs settle, then inspect the feed (newest first: landscape video,
// tall video, tall image — scroll for the last).
await kim.page.waitForTimeout(2500);
await shot(kim, 'wall-top', { route: '/tabs/wall' });
await kim.page.evaluate(() => {
  const sc = document.querySelector('ion-content');
  sc?.scrollToBottom?.(0);
});
await kim.page.waitForTimeout(800);
await shot(kim, 'wall-bottom');

await sweep([kim, pal]);
await done();
