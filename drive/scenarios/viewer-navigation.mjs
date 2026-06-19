// Spec 1014 US3 visual verification: position indicator + zoom-exit affordance.
//   node drive/scenarios/viewer-navigation.mjs   (or HEADED=1 …)
import { createAccount, pair, chatWith, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Ada', mobile: true });
const b = await createAccount({ name: 'Bel', mobile: true });
await pair(a, b);
const aChat = await chatWith(a, b.id);

for (const [w, h] of [[1280, 960], [1024, 1024], [900, 1600], [1200, 800], [800, 800]]) {
  await a.page.evaluate(([id, ww, hh]) => window.__ringTest.sendImage(id, ww, hh), [aChat, w, h]);
}
await a.page.evaluate(async (id) => {
  for (let k = 0; k < 150; k++) {
    const ms = await window.__ringTest.messages(id);
    if (ms.filter((m) => m.kind === 'image').length >= 5) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}, aChat);

await a.page.goto(`http://localhost:5173/chat/${aChat}`);
await a.page.waitForTimeout(1000);
await a.page.locator('.bubble .bubble-image').first().click();
await a.page.waitForSelector('.viewer-track', { timeout: 10000 });
await a.page.waitForTimeout(700);

// Indicator visible at "1 / 5".
console.log('[nav] count:', await a.page.evaluate(() => document.querySelector('.v-count')?.textContent));
await shot(a, 'us3-01-indicator', {});

// Zoom in (double-tap) → the exit-zoom affordance appears.
await a.page.locator('.viewer-slide img').first().dblclick();
await a.page.waitForTimeout(500);
console.log('[nav] zoom-exit visible:', await a.page.locator('.v-zoom-exit').isVisible());
await shot(a, 'us3-02-zoom-exit', {});

await sweep([a, b]);
await done();
