/**
 * Staged attachments are preserved in a chat draft: add a photo but don't send it, leave the chat
 * (and reload the app), and it's still staged when you come back. The Chats list shows the draft too.
 *
 *   HEADED=1 node drive/scenarios/chat-draft-media.mjs
 */
import { preflight, createAccount, pair, chatWith, shot, sweep, done, poll } from '../driver.mjs';

// A tiny 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

await preflight();
const [a, b] = [
  await createAccount({ name: 'Media Mia', mobile: true }),
  await createAccount({ name: 'Bo', mobile: true }),
];
await pair(a, b);
const chatId = await chatWith(a, b.id);

async function openChat() {
  await a.page.goto(`/chat/${chatId}`);
  await poll(() => a.page.evaluate(() => !!document.querySelector('ion-textarea')), Boolean, { label: 'composer present' });
}
const stagedCount = () => a.page.evaluate(() => document.querySelectorAll('.paste-thumb').length);

// Stage a photo (do not send).
await openChat();
await a.page.setInputFiles('input[type=file][multiple]', { name: 'holiday.png', mimeType: 'image/png', buffer: PNG });
await poll(() => stagedCount(), (n) => n === 1, { label: 'photo staged' });
await a.page.waitForTimeout(500); // let the debounced media-save flush
console.log('staged after add:', await stagedCount());
await shot(a, 'draftmedia-staged');

// Chats list should show the draft with a media label.
await a.page.goto('/tabs/chats');
await poll(() => a.page.evaluate(() => !!document.querySelector('.draft-tag')), Boolean, { label: 'draft tag' });
const listPreview = await a.page.evaluate(() => document.querySelector('.draft-tag')?.parentElement?.textContent?.trim());
console.log('chats-list draft:', JSON.stringify(listPreview));

// Return to the chat: the photo should still be staged.
await openChat();
await poll(() => stagedCount(), (n) => n === 1, { label: 'photo restored after leave' });
console.log('staged after leave+return:', await stagedCount());

// Full app reload, reopen: still staged.
await a.page.reload();
await poll(() => a.page.evaluate(() => !!window.__ringTest), Boolean, { label: 'app reloaded' });
await openChat();
await poll(() => stagedCount(), (n) => n === 1, { label: 'photo restored after reload' });
console.log('staged after reload:', await stagedCount());
await shot(a, 'draftmedia-restored');

// Remove it → the draft clears.
await a.page.evaluate(() => document.querySelector('.paste-x')?.click());
await poll(() => stagedCount(), (n) => n === 0, { label: 'removed' });
await a.page.waitForTimeout(500);
await a.page.goto('/tabs/chats');
await openChat();
console.log('staged after remove+reopen (should be 0):', await stagedCount());

await sweep([a, b]);
await done();
