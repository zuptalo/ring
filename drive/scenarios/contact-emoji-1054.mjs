/**
 * Spec 1054: the contact "Change photo" action sheet — Take photo / Choose
 * photo / Pick an emoji / Reset to their photo. Verifies the real file-chooser
 * path (a real PNG through pickImageFile → downscale), the emoji override, and
 * the photo-only reset, with screenshots of the sheet and resulting avatars.
 *
 *   node drive/scenarios/contact-emoji-1054.mjs
 */
import { createAccount, pair, poll, shot, sweep, done } from '../driver.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PNG = path.join(ROOT, 'public', 'apple-touch-icon.png');

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });

// Alice picks an emoji profile picture BEFORE pairing so Bob's first-learned
// profile applies directly (avatar = remoteAvatar = the 😎 disc).
await alice.page.evaluate(() => window.__ringTest.setEmojiAvatar('😎'));
await pair(bob, alice);
await poll(
  () => bob.page.evaluate((id) => window.__ringTest.contactAvatarEmoji(id), alice.id),
  (v) => v === '😎',
  { label: "Alice's 😎 landed as Bob's contact avatar" },
);

const openSheet = async () => {
  await bob.page.locator('ion-action-sheet').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  await bob.page.getByText('Change photo').click();
  await bob.page.locator('ion-action-sheet button', { hasText: 'Take photo' }).waitFor({ timeout: 8000 });
};

await bob.page.goto(`/contact/${alice.id}`);
await bob.page.getByText('Change photo').waitFor({ timeout: 15000 });
await shot(bob, '1054-1-contact-baseline');

// The sheet: three sources, no reset entry yet (nothing overridden).
await openSheet();
await shot(bob, '1054-2-sheet-no-reset');

// Real photo path: "Choose photo" → OS file chooser → a real PNG.
const chooser = bob.page.waitForEvent('filechooser');
await bob.page.locator('ion-action-sheet button', { hasText: 'Choose photo' }).click();
await (await chooser).setFiles(PNG);
await poll(
  () => bob.page.evaluate((id) => window.__ringTest.contactName(id).then(() => window.__ringTest.contactAvatarEmoji(id)), alice.id),
  (v) => v === null, // a JPEG photo decodes to no emoji → the photo landed
  { label: 'chosen photo applied as the contact avatar' },
);
await shot(bob, '1054-3-photo-override');

// Now overridden → the sheet gains "Reset to their photo".
await openSheet();
await shot(bob, '1054-4-sheet-with-reset');

// Pick an emoji instead.
await bob.page.locator('ion-action-sheet button', { hasText: 'Pick an emoji' }).click();
await bob.page.locator('emoji-picker').waitFor({ timeout: 15000 });
await bob.page.evaluate(() => {
  document.querySelector('emoji-picker').dispatchEvent(new CustomEvent('emoji-click', { detail: { unicode: '🐙' } }));
});
await poll(
  () => bob.page.evaluate((id) => window.__ringTest.contactAvatarEmoji(id), alice.id),
  (v) => v === '🐙',
  { label: '🐙 override applied' },
);
await shot(bob, '1054-5-emoji-override');

// Reset → back to Alice's own 😎.
await openSheet();
await bob.page.locator('ion-action-sheet button', { hasText: 'Reset to their photo' }).click();
await poll(
  () => bob.page.evaluate((id) => window.__ringTest.contactAvatarEmoji(id), alice.id),
  (v) => v === '😎',
  { label: 'reset restored Alice’s own 😎' },
);
await shot(bob, '1054-6-after-reset');

console.log('[PASS] photo via file chooser, emoji override, and photo-only reset all behaved');
await sweep([bob, alice]);
await done();
