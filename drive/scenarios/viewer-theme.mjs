// Spec 1014 US5 FR-023 visual check: the media viewer follows the app light/dark theme
// (light surface + dark chrome in light mode; dark surface + light chrome in dark mode).
//   node drive/scenarios/viewer-theme.mjs   (or HEADED=1 …)
import { createAccount, pair, chatWith, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Ada' });
const b = await createAccount({ name: 'Bel' });
await pair(a, b);
const aChat = await chatWith(a, b.id);

for (let i = 0; i < 3; i++) {
  await a.page.evaluate((id) => window.__ringTest.sendImage(id, 1000, 750), aChat);
}
await a.page.evaluate(async (id) => {
  for (let k = 0; k < 100; k++) {
    const ms = await window.__ringTest.messages(id);
    if (ms.filter((m) => m.kind === 'image').length >= 3) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}, aChat);

const surfaceBg = () =>
  a.page.evaluate(() =>
    getComputedStyle(document.querySelector('.viewer-content')).getPropertyValue('--background').trim(),
  );

// Open the viewer once, then toggle the theme live (no navigation, so the class survives).
await a.page.goto(`http://localhost:5173/chat/${aChat}`);
await a.page.waitForTimeout(900);
await a.page.locator('.bubble .bubble-image').first().click();
await a.page.waitForSelector('.viewer-track', { timeout: 10000 });
await a.page.waitForTimeout(600);

// LIGHT theme.
await a.page.evaluate(() => document.documentElement.classList.remove('ion-palette-dark'));
await a.page.waitForTimeout(300);
console.log('[theme] light viewer --background:', await surfaceBg());
await shot(a, 'theme-01-light', {});

// DARK theme — toggled while the viewer is open; CSS vars re-resolve live.
await a.page.evaluate(() => document.documentElement.classList.add('ion-palette-dark'));
await a.page.waitForTimeout(300);
console.log('[theme] dark viewer --background:', await surfaceBg());
await shot(a, 'theme-02-dark', {});

await a.page.evaluate(() => document.documentElement.classList.remove('ion-palette-dark'));
await sweep([a, b]);
await done();
