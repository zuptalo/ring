/**
 * Swipe-deleting a contact from the Contacts list now asks for confirmation (with a hint about what
 * it does) instead of deleting instantly.
 *
 *   HEADED=1 node drive/scenarios/contact-delete-confirm.mjs
 */
import { preflight, createAccount, pair, shot, sweep, done, poll } from '../driver.mjs';

await preflight();
const [a, b] = [
  await createAccount({ name: 'Alice', mobile: true }),
  await createAccount({ name: 'Bob', mobile: true }),
];
await pair(a, b);

await a.page.goto('/tabs/contacts');
await poll(() => a.page.evaluate(() => !!document.querySelector('ion-item-sliding')), Boolean, { label: 'contacts list' });

// Open the swipe actions on the first contact and tap the delete option.
await a.page.evaluate(() => {
  const sliding = document.querySelector('ion-item-sliding');
  sliding?.open('end');
});
await a.page.waitForTimeout(300);
await a.page.evaluate(() => {
  document.querySelector('ion-item-option[color="danger"]')?.click();
});

// A confirmation alert should appear (not an instant delete).
await poll(() => a.page.evaluate(() => !!document.querySelector('ion-alert')), Boolean, { label: 'confirm alert' });
const alertText = await a.page.evaluate(() => {
  const al = document.querySelector('ion-alert');
  return {
    header: al?.querySelector('.alert-title, .alert-head h2')?.textContent?.trim() || al?.textContent?.slice(0, 60),
    buttons: [...(al?.querySelectorAll('.alert-button') || [])].map((b) => b.textContent.trim()),
  };
});
console.log('alert:', JSON.stringify(alertText));
await shot(a, 'contact-delete-confirm');

await sweep([a, b]);
await done();
