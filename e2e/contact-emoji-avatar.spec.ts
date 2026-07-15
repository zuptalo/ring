import { test, expect, type Page } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 1054: the contact photo menu mirrors the profile-picture sheet —
 * Take photo / Choose photo / Pick an emoji — and, once the photo is locally
 * overridden, gains "Reset to their photo", which reverts ONLY the photo back
 * to what the contact published while a custom name survives.
 *
 * The emoji pick inside the shadow-DOM `emoji-picker` web component is driven
 * by dispatching its public `emoji-click` event (exactly what EmojiPickerModal
 * listens for) — clicking a specific glyph in the virtualised grid is flaky.
 */

async function openPhotoSheet(page: Page): Promise<void> {
  // A just-dismissed sheet lingers in the DOM during its leave animation; wait
  // it out so the click can't land on its backdrop and the locators can't
  // match the stale overlay.
  await page
    .locator('ion-action-sheet')
    .waitFor({ state: 'detached', timeout: 10_000 })
    .catch(() => {});
  await page.getByText('Change photo').click();
  await page.locator('ion-action-sheet button', { hasText: 'Take photo' }).waitFor({ timeout: 10_000 });
}

async function dismissSheet(page: Page): Promise<void> {
  await page.locator('ion-action-sheet button', { hasText: 'Cancel' }).click();
  await page.locator('ion-action-sheet').waitFor({ state: 'detached', timeout: 10_000 });
}

test('emoji contact photo via the sheet; reset returns their photo and keeps a custom name', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGTST4');
  const b = await createAccount(ctxB, 'RINGTST9');

  // B picks an emoji profile picture BEFORE pairing, so A's FIRST-learned
  // profile applies directly (avatar = remoteAvatar = the 😎 disc). A post-pair
  // change would arrive STAGED behind the adopt prompt instead.
  await b.page.evaluate(() => (window as any).__ringTest.setEmojiAvatar('😎'));
  await pair(a, b);
  await expect
    .poll(() => a.page.evaluate((id: string) => (window as any).__ringTest.contactAvatarEmoji(id), b.id), {
      timeout: 30_000,
    })
    .toBe('😎');

  // A opens B's contact page. The photo sheet offers the profile-picture
  // options — but no reset entry: nothing is overridden yet (FR-004).
  await a.page.goto(`/contact/${b.id}`);
  await openPhotoSheet(a.page);
  const sheet = a.page.locator('ion-action-sheet');
  await expect(sheet.locator('button', { hasText: 'Take photo' })).toBeVisible();
  await expect(sheet.locator('button', { hasText: 'Choose photo' })).toBeVisible();
  await expect(sheet.locator('button', { hasText: 'Pick an emoji' })).toBeVisible();
  await expect(sheet.locator('button', { hasText: 'Reset to their photo' })).toHaveCount(0);

  // Pick an emoji → the picker modal hosts `emoji-picker`; inject its pick
  // event. The override lands as B's displayed avatar on A's device (FR-002).
  await sheet.locator('button', { hasText: 'Pick an emoji' }).click();
  await a.page.locator('emoji-picker').waitFor({ timeout: 15_000 });
  await a.page.evaluate(() => {
    document
      .querySelector('emoji-picker')!
      .dispatchEvent(new CustomEvent('emoji-click', { detail: { unicode: '🐙' } }));
  });
  await expect
    .poll(() => a.page.evaluate((id: string) => (window as any).__ringTest.contactAvatarEmoji(id), b.id), {
      timeout: 15_000,
    })
    .toBe('🐙');

  // A also renames B locally — the photo reset must not undo this (FR-005).
  await a.page.evaluate((id: string) => (window as any).__ringTest.setContactLocalProfile(id, 'Octo Pal'), b.id);

  // With the photo overridden the sheet now ends with the reset entry; using
  // it reverts the photo to B's own 😎 while the custom name stays.
  await openPhotoSheet(a.page);
  await sheet.locator('button', { hasText: 'Reset to their photo' }).click();
  await expect
    .poll(() => a.page.evaluate((id: string) => (window as any).__ringTest.contactAvatarEmoji(id), b.id), {
      timeout: 15_000,
    })
    .toBe('😎');
  expect(await a.page.evaluate((id: string) => (window as any).__ringTest.contactName(id), b.id)).toBe('Octo Pal');

  // Nothing left to reset → the entry is gone again (FR-004).
  await openPhotoSheet(a.page);
  await expect(sheet.locator('button', { hasText: 'Pick an emoji' })).toBeVisible();
  await expect(sheet.locator('button', { hasText: 'Reset to their photo' })).toHaveCount(0);
  await dismissSheet(a.page);

  await ctxA.close();
  await ctxB.close();
});
