// Verify the ?launch-reveal replay hook works even under automation (forced overrides the
// webdriver suppression), proving main.ts captures the query before the router strips it.
import { newClient, done } from '../driver.mjs';
const c = await newClient({ mobile: true, label: 'reveal' });
await c.page.goto('/?launch-reveal');
await c.page.waitForTimeout(700);
const shown = await c.page.evaluate(() => !!document.querySelector('.launch-reveal') && !!document.querySelector('.rv-skip'));
const flag = await c.page.evaluate(() => window.__ringLaunchReveal);
console.log(`[check] __ringLaunchReveal captured: ${flag} (expect true)`);
console.log(`[check] reveal shown via ?launch-reveal under automation: ${shown} (expect true)`);
await done();
