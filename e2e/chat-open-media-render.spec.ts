import { test, expect } from '@playwright/test';
import { createAccount, pair, chatWith, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 2060 — a message whose media is on the device must render it however the chat was opened.
 *
 * The bug: a voice message rendered a blank bubble when the chat was opened by TAPPING it in the
 * chat list, even though its audio was present and resolved. The bubble is memoised on the
 * message's poster image; voice and audio have no poster, so once a bubble first rendered empty
 * (which is what happens on in-app navigation, where bubbles paint a beat before media resolves)
 * the memo never saw a change and never swapped in the player. Deep-linking straight into the
 * chat happened to resolve media before first paint, which is why it looked fine there and slipped
 * through.
 *
 * These tests enter the chat the way a person does — tapping its row — because that is the entry
 * path that was broken. Direct `page.goto('/chat/id')` would mask the bug.
 */

const openFromList = async (a: RingClient) => {
  await a.page.goto('/tabs/chats');
  const row = a.page.locator('ion-item-sliding').first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(a.page).toHaveURL(/\/chat\//, { timeout: 15_000 });
};

test('a voice message shows its player when the chat is opened from the list', async ({
  browser,
}) => {
  const a = await createAccount(await browser.newContext(), 'OPENVOICE1');
  const b = await createAccount(await browser.newContext(), 'OPENVOICE2');
  await pair(a, b);
  const chat = (await chatWith(a, b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.sendVoice(id, 'note.webm'), chat);

  await openFromList(a);

  // THE REGRESSION: before the fix, this bubble stayed blank (no player) on the list-tap path.
  await expect(a.page.locator('.bubble .vp')).toHaveCount(1, { timeout: 20_000 });

  // And it survives leaving and coming back the same way.
  await a.page.goBack();
  await a.page.locator('ion-item-sliding').first().click();
  await expect(a.page.locator('.bubble .vp')).toHaveCount(1, { timeout: 20_000 });
});

test('a shared audio card shows when the chat is opened from the list', async ({ browser }) => {
  const a = await createAccount(await browser.newContext(), 'OPENAUDIO1');
  const b = await createAccount(await browser.newContext(), 'OPENAUDIO2');
  await pair(a, b);
  const chat = (await chatWith(a, b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.sendAudio(id, 'song.mp3', 'T', 'Ar'), chat);

  await openFromList(a);

  // Audio shares voice's poster-less, memo-frozen failure mode.
  await expect(a.page.locator('.bubble .audio-card')).toHaveCount(1, { timeout: 20_000 });
});

test('a photo still renders when the chat is opened from the list', async ({ browser }) => {
  // FR-004: the poster-bearing kinds that worked before must keep working.
  const a = await createAccount(await browser.newContext(), 'OPENIMG1');
  const b = await createAccount(await browser.newContext(), 'OPENIMG2');
  await pair(a, b);
  const chat = (await chatWith(a, b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.sendImage(id, 400, 300, 'p.png'), chat);

  await openFromList(a);

  await expect(a.page.locator('.bubble .bubble-image')).toHaveCount(1, { timeout: 20_000 });
});
