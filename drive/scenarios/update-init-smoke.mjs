// Smoke test: after wiring useInstallGuard into useAppUpdate, the app still boots
// cleanly (no init error from the update composable) and reaches Chats. The install-gate
// AUTO-UPDATE path itself can't run here — it needs a production SW, the public origin
// (localhost is exempt from the gate), and a second deploy — so this only guards startup.
import { createAccount, shot, sweep } from '../driver.mjs';

const a = await createAccount({ mobile: true, name: 'Alice', label: 'alice' });
const errors = [];
a.page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
a.page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await a.page.reload({ waitUntil: 'domcontentloaded' });
await a.page.waitForTimeout(2500);
const path = await a.page.evaluate(() => location.pathname);
const relevant = errors.filter((e) => /update|install|serviceworker|registerSW|InstallGuard|useAppUpdate/i.test(e));
console.log(`[check] landed on: ${path} (expect /tabs/chats)`);
console.log(`[check] update/install-related console errors: ${relevant.length} ${JSON.stringify(relevant.slice(0, 3))}`);
await shot(a, 'update-init-smoke');
await sweep([a]);
