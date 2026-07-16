/**
 * Verify: typing a link in the composer resolves + shows a preview BEFORE send,
 * and the sent bubble shows only the rich card (no duplicate raw-URL text) once a
 * preview exists.
 *
 *   node drive/scenarios/link-preview-compose.mjs
 *   HEADED=1 node drive/scenarios/link-preview-compose.mjs
 */
import { createAccount, pair, chatWith, poll, shot, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);

const chatId = await chatWith(alice, bob.id);
await alice.page.goto(`/chat/${chatId}`);
await alice.page.waitForTimeout(600);

const composer = alice.page.locator('ion-textarea.composer textarea');
await composer.click();
await composer.fill('https://example.com');
// Nudge Vue's v-model (fill() sets the value but ion-textarea listens for ionInput,
// which our onComposerInput handler needs to fire the debounced preview check).
await alice.page.locator('ion-textarea.composer').evaluate((el) => {
  el.dispatchEvent(new CustomEvent('ionInput', { detail: { value: el.querySelector('textarea').value } }));
});

console.log('[test] waiting for composer preview to resolve...');
await poll(
  () => alice.page.locator('.lp-compose-card, .lp-compose-empty').count(),
  (n) => n > 0,
  { timeout: 15_000, label: 'composer preview resolved' },
);
await shot(alice, 'lp-01-composer-preview', {});

const cardCount = await alice.page.locator('.lp-compose-card').count();
console.log(`[test] composer shows rich preview card: ${cardCount > 0}`);

await alice.page.getByRole('button', { name: 'Send' }).click();
console.log('[test] sent');

await poll(
  () => alice.page.locator('.bubble .link-card.rich').count(),
  (n) => n > 0,
  { timeout: 15_000, label: 'sent bubble shows rich preview' },
);
await alice.page.waitForTimeout(500);
await shot(alice, 'lp-02-sent-bubble', {});

const bubbleText = await alice.page.locator('.bubble-row').last().locator('.text').count();
console.log(`[test] redundant .text span present on the link bubble: ${bubbleText > 0} (expect false)`);

// Bob's side (recipient): the deferred/inline preview should also render without duplication.
await bob.page.goto(`/chat/${await chatWith(bob, alice.id)}`);
await poll(
  () => bob.page.locator('.bubble .link-card.rich, .bubble .link-card:not(.rich)').count(),
  (n) => n > 0,
  { timeout: 20_000, label: 'bob sees a link card' },
);
await bob.page.waitForTimeout(500);
await shot(bob, 'lp-03-bob-received', {});

// Link + a caption AFTER it: the card shows, the caption shows, the raw link does not.
await alice.page.locator('ion-textarea.composer textarea').fill('https://example.com\n\nGive this link a try');
await alice.page.locator('ion-textarea.composer').evaluate((el) => {
  el.dispatchEvent(new CustomEvent('ionInput', { detail: { value: el.querySelector('textarea').value } }));
});
await poll(
  () => alice.page.locator('.lp-compose-card, .lp-compose-empty').count(),
  (n) => n > 0,
  { timeout: 15_000, label: 'composer preview resolved (captioned)' },
);
await alice.page.getByRole('button', { name: 'Send' }).click();
console.log('[test] sent captioned link');
await alice.page.waitForTimeout(1500);
await shot(alice, 'lp-04-captioned-link-bubble', {});

const lastBubble = alice.page.locator('.bubble-row').last();
const captionText = await lastBubble.locator('.text').innerText().catch(() => '');
console.log(`[test] caption text rendered: ${JSON.stringify(captionText)}`);
console.log(`[test] caption contains raw url: ${captionText.includes('https://example.com')} (expect false)`);
console.log(`[test] caption contains "Give this link a try": ${captionText.includes('Give this link a try')} (expect true)`);

await sweep([alice, bob]);
await done();
