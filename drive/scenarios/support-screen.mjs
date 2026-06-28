// Screenshot the new "Support Ring" settings screen (spec 1021) in light + dark.
import { createAccount, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Supporter', mobile: true });

await shot(a, 'support-light', { route: '/settings/support', fullPage: true });

await a.page.evaluate(() => window.__ringTest.setSetting('appearance.theme', 'dark'));
await a.page.waitForTimeout(700);
await shot(a, 'support-dark', { route: '/settings/support', fullPage: true });

await sweep([a]);
await done();
