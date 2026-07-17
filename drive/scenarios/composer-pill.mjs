/**
 * Verify: composer has no "Message" placeholder and shows a pill boundary that
 * grows with content, both empty and while typing a multi-line message.
 *
 *   node drive/scenarios/composer-pill.mjs
 *   HEADED=1 node drive/scenarios/composer-pill.mjs
 */
import { createAccount, pair, chatWith, shot, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);

for (const theme of ['light', 'dark']) {
  const chatId = await chatWith(alice, bob.id);
  await alice.page.goto(`/chat/${chatId}`);
  await alice.page.waitForTimeout(500);
  await alice.page.evaluate((t) => document.documentElement.classList.toggle('ion-palette-dark', t === 'dark'), theme);
  await alice.page.waitForTimeout(200);

  await shot(alice, `composer-${theme}-01-empty`, {});

  const composer = alice.page.locator('ion-textarea.composer textarea');
  await composer.click();
  await composer.fill('This is a longer message\nthat wraps across\nseveral lines to show\nthe pill growing with it.');
  await alice.page.locator('ion-textarea.composer').evaluate((el) => {
    el.dispatchEvent(new CustomEvent('ionInput', { detail: { value: el.querySelector('textarea').value } }));
  });
  await alice.page.waitForTimeout(300);
  await shot(alice, `composer-${theme}-02-multiline`, {});
  await composer.fill('');
}

await sweep([alice, bob]);
await done();
