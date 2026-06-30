/**
 * Per-chat composer drafts: an unsent message is restored when you leave the chat and come back,
 * and after a full app reload. Two accounts so there's a real 1:1 chat.
 *
 *   HEADED=1 node drive/scenarios/chat-draft.mjs
 */
import { preflight, createAccount, pair, chatWith, shot, sweep, done, poll } from '../driver.mjs';

await preflight();
const [a, b] = [
  await createAccount({ name: 'Drafty Dana', mobile: true }),
  await createAccount({ name: 'Bo', mobile: true }),
];
await pair(a, b);
const chatId = await chatWith(a, b.id);

async function openChat() {
  await a.page.goto(`/chat/${chatId}`);
  await poll(() => a.page.evaluate(() => !!document.querySelector('ion-textarea')), Boolean, { label: 'composer present' });
}
const composerValue = () =>
  a.page.evaluate(() => document.querySelector('ion-textarea')?.value || '');

// Type a draft, but do NOT send it.
await openChat();
const native = a.page.locator('ion-textarea textarea').first();
await native.click();
await native.pressSequentially('half typed message', { delay: 10 });
console.log('typed draft:', JSON.stringify(await composerValue()));
await a.page.waitForTimeout(700); // let the debounced draft-save flush to IndexedDB
await shot(a, 'draft-typed');

// Leave the chat (back to the list), then return — the draft should be restored.
await a.page.goto('/tabs/chats');
await poll(() => a.page.evaluate(() => !document.querySelector('ion-textarea')), Boolean, { label: 'left chat' });
await openChat();
const afterReturn = await composerValue();
console.log('after leave+return:', JSON.stringify(afterReturn));
await shot(a, 'draft-restored');

// Simulate a full app close: reload the page, then open the chat again.
await a.page.reload();
await poll(() => a.page.evaluate(() => !!window.__ringTest), Boolean, { label: 'app reloaded' });
await openChat();
const afterReload = await composerValue();
console.log('after reload:', JSON.stringify(afterReload));
await shot(a, 'draft-after-reload');

// Clear the text and leave — an emptied composer must not leave a stale draft behind.
await a.page.locator('ion-textarea textarea').first().click();
await a.page.locator('ion-textarea textarea').first().fill('');
await a.page.waitForTimeout(700); // debounced save sees empty text → clears the stored draft
await a.page.goto('/tabs/chats');
await openChat();
const afterClear = await composerValue();
console.log('after clearing+reopen (should be empty):', JSON.stringify(afterClear));

await sweep([a, b]);
await done();
