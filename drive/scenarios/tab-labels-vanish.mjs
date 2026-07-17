/**
 * Repro: desktop tab-bar labels reportedly disappear one by one as each tab is
 * clicked (installed Chrome PWA). Click every tab with real clicks and dump the
 * ion-tab-button classes + ion-label computed styles before/after each click.
 *
 *   node drive/scenarios/tab-labels-vanish.mjs
 */
import { createAccount, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'TabProbe' });
const page = a.page;

const dump = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('ion-tab-button')).map((b) => {
      const label = b.querySelector('ion-label');
      const cs = label ? getComputedStyle(label) : null;
      return {
        tab: b.getAttribute('tab'),
        dataOn: b.hasAttribute('data-on'), // the active marker (spec 2024) — exactly one true
        cls: b.className,
        btnH: b.clientHeight,
        label: label
          ? {
              text: label.textContent,
              display: cs.display,
              visibility: cs.visibility,
              opacity: cs.opacity,
              h: label.clientHeight,
              w: label.clientWidth,
              fontSize: cs.fontSize,
              transform: cs.transform,
            }
          : 'MISSING',
      };
    }),
  );

await shot(a, 'tabs-wherever'); // where did createAccount leave us?
await page.goto('http://localhost:5173/tabs/chats');
await page.waitForSelector('ion-tab-bar ion-tab-button', { state: 'attached' });
console.log('INITIAL', JSON.stringify(await dump()));
await shot(a, 'tabs-initial');

for (const t of ['Calls', 'Wall', 'Contacts', 'Settings', 'Chats']) {
  await page.click(`ion-tab-button:has-text("${t}")`);
  await page.waitForTimeout(600);
  console.log(`AFTER ${t}:`, JSON.stringify(await dump()));
  await shot(a, `tabs-after-${t}`);
}

await sweep([a]);
await done();
