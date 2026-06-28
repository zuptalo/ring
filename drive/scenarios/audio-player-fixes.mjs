// Verify the floating audio controller fixes:
//  - while INSIDE the owning chat the floating controller is hidden (the in-message
//    player owns the controls)
//  - after leaving the chat it appears COLLAPSED, and expands on demand
//  - it follows the dark theme (was stuck light due to undefined Ionic step colors)
import { createAccount, pair, chatWith, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Aud', mobile: true });
const b = await createAccount({ name: 'Bob', mobile: true });
await pair(a, b);
const aChat = await chatWith(a, b.id);

// Create a (music) audio message locally and open the chat.
await a.page.evaluate((cid) => window.__ringTest.sendAudio(cid, 'demo.mp3', 'Demo Track', 'Ring'), aChat);
await a.page.waitForTimeout(700);
await shot(a, 'audio-1-inchat-before', { route: `/chat/${aChat}` });

// Navigate INTO the chat via the SPA (no reload, so audio state persists), then start audio.
await a.page.evaluate((cid) => window.__ringTest.navigate(`/chat/${cid}`), aChat);
await a.page.waitForTimeout(700);
await a.page.evaluate((cid) => window.__ringTest.playAudioTest(cid, 'Demo Track'), aChat);
await a.page.waitForTimeout(500);
await shot(a, 'audio-2-inchat-hidden'); // still in chat → floating controller must NOT show

// Leave the chat via SPA nav → floating controller appears COLLAPSED.
await a.page.evaluate(() => window.__ringTest.navigate('/tabs/chats'));
await a.page.waitForTimeout(700);
const dbg = await a.page.evaluate(() => ({ mini: document.querySelectorAll('.audio-mini').length }));
console.log('DEBUG', JSON.stringify(dbg));
await shot(a, 'audio-3-left-collapsed');

// Expand it.
await a.page.evaluate(() => document.querySelector('.am-toggle')?.click());
await a.page.waitForTimeout(300);
await shot(a, 'audio-4-expanded');

// Dark theme.
await a.page.evaluate(() => window.__ringTest.setSetting('appearance.theme', 'dark'));
await a.page.waitForTimeout(800);
await shot(a, 'audio-5-dark');

await sweep([a, b]);
await done();
