/**
 * Desktop Enter-to-send in the chat composer. Alice types into the message composer
 * and presses Enter (no shift); the message must send (Bob receives it). Then she
 * types a line, presses Shift+Enter, and the draft must keep a newline (not send).
 *
 *   node drive/scenarios/chat-enter-send.mjs
 */
import { createAccount, pair, chatWith, waitForMessage, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);

const aliceChat = await chatWith(alice, bob.id);
await alice.page.goto(`/chat/${aliceChat}`);
await alice.page.waitForSelector('ion-textarea.composer', { timeout: 15_000 });
await alice.page.waitForTimeout(400);

// Type a message and press Enter (desktop → should SEND).
await alice.page.locator('ion-textarea.composer').click();
await alice.page.keyboard.type('hello via enter key');
await alice.page.waitForTimeout(200);
await alice.page.keyboard.press('Enter');

await waitForMessage(bob, alice.id, 'hello via enter key');
console.log('[bob] received the Enter-sent message ✓');

// Shift+Enter must NOT send — it inserts a newline and leaves a draft.
await alice.page.locator('ion-textarea.composer').click();
await alice.page.keyboard.type('first line');
await alice.page.keyboard.down('Shift');
await alice.page.keyboard.press('Enter');
await alice.page.keyboard.up('Shift');
await alice.page.keyboard.type('second line');
await alice.page.waitForTimeout(200);
const draft = await alice.page.evaluate(() => {
  const ta = document.querySelector('ion-textarea.composer');
  return ta ? ta.value : null;
});
if (!draft || !draft.includes('\n') || !draft.includes('first line') || !draft.includes('second line')) {
  throw new Error(`Shift+Enter did not keep a multi-line draft: ${JSON.stringify(draft)}`);
}
console.log('[alice] Shift+Enter kept a multi-line draft ✓');

await sweep([alice, bob]);
await done();
