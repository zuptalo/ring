// Visual review of the polish pass: green tab bar, green floating audio player,
// and the consolidated About page (coffee + platforms).
import { createAccount, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Look', mobile: true });

// Green tab bar (light).
await shot(a, 'polish-1-tabbar', { route: '/tabs/chats' });

// Green floating audio player. Start a fake track, then stay on /tabs/chats (no reload).
await a.page.evaluate(() => window.__ringTest.playAudioTest('demo-chat', 'Demo Track'));
await a.page.waitForTimeout(400);
await shot(a, 'polish-2-floating-collapsed');
await a.page.evaluate(() => document.querySelector('.am-toggle')?.click());
await a.page.waitForTimeout(300);
await shot(a, 'polish-3-floating-expanded');

// Consolidated About page (coffee + Ko-fi/Liberapay/GitHub Sponsors).
await shot(a, 'polish-4-about', { route: '/settings/about', fullPage: true });

// Dark: tab bar + floating player.
await a.page.evaluate(() => window.__ringTest.setSetting('appearance.theme', 'dark'));
await a.page.waitForTimeout(600);
await a.page.evaluate(() => window.__ringTest.playAudioTest('demo-chat', 'Demo Track'));
await a.page.waitForTimeout(300);
await shot(a, 'polish-5-dark');

await sweep([a]);
await done();
