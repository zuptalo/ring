import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Spec 0008 T044 (FR-027): an emoji profile picture travels to the peer as an
// ordinary picture through the E2EE profile card, and the peer's device can
// recover the emoji from it (that's what upgrades it to the animated version).
test('an emoji profile picture reaches the peer and decodes back to the emoji', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGTST4');
  const b = await createAccount(ctxB, 'RINGTST9');
  await pair(a, b);

  // A picks 😎 as their profile picture (the same path the UI uses) and
  // re-shares the profile into the chat with B.
  await a.page.evaluate(() => (window as any).__ringTest.setEmojiAvatar('😎'));
  const aChat = (await a.page.evaluate((id) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  await a.page.evaluate((id: string) => (window as any).__ringTest.shareProfileUpdate(id), aChat);

  // B's stored contact avatar is a normal picture that decodes to the emoji.
  await expect
    .poll(
      () => b.page.evaluate((id: string) => (window as any).__ringTest.contactAvatarEmoji(id), a.id),
      { timeout: 30_000 },
    )
    .toBe('😎');

  await ctxA.close();
  await ctxB.close();
});
