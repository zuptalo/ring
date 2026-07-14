/** Spec 2034: a tall 9:16 VIDEO post alone — the capped 4:5 box must show the whole
 *  clip pillarboxed with the player's bottom control bar visible. */
import { createAccount, pair, shot, sweep, done } from '../driver.mjs';

const kim = await createAccount({ name: 'Kim', mobile: true });
const pal = await createAccount({ name: 'Pal' });
await pair(kim, pal);

await kim.page.evaluate(() => window.__ringTest.postTallMedia('video'));
await kim.page.waitForTimeout(2500);
await shot(kim, 'wall-tall-video', { route: '/tabs/wall' });

await sweep([kim, pal]);
await done();
