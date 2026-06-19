import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);
const messages = (p: any, chatId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.messages(id), chatId);

/**
 * Spec 1014 US2 — the full-screen media viewer is crash-proof under item-set
 * mutation (FR-007) and never shows a broken image (FR-008). When the item being
 * viewed (or all media) is deleted/cleared while the viewer is open, the viewer
 * recovers: it clamps its index into range and keeps the active item correct, or
 * closes gracefully — never an out-of-range slide or an empty <img>.
 */
test('viewer clamps index + recovers when the viewed item is deleted, never a broken image', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'VIEWERA1');
  const b = await createAccount(ctxB, 'VIEWERB1');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  expect(aChat).toBeTruthy();

  // Three real images, oldest→newest top→bottom in the chat.
  for (let i = 0; i < 3; i++) {
    await a.page.evaluate(([id, n]) => (window as any).__ringTest.sendImage(id, 900, 700, n), [aChat, `p${i}.png`]);
  }
  await a.page.goto(`/chat/${aChat}`);
  const bubbles = a.page.locator('.bubble .bubble-image');
  await expect(bubbles).toHaveCount(3, { timeout: 30_000 });

  // Open the viewer on the LAST image (index 2 of 3) — the strict out-of-range case.
  await bubbles.nth(2).click();
  await expect(a.page.locator('.viewer-track')).toBeVisible({ timeout: 10_000 });
  const thumbs = a.page.locator('.v-strip .v-thumb');
  const onThumbs = a.page.locator('.v-strip .v-thumb.on');
  await expect(thumbs).toHaveCount(3);
  await expect(onThumbs).toHaveCount(1); // exactly one item is active
  await expect(a.page.locator('.viewer-slide img[src=""]')).toHaveCount(0); // no broken image

  // Delete the viewed (last) message while the viewer is open.
  const imgMsgs = (await messages(a, aChat)).filter((m: any) => m.kind === 'image');
  const lastId = imgMsgs[imgMsgs.length - 1].id as string;
  await a.page.evaluate((id) => (window as any).__ringTest.deleteForEveryone(id, false), lastId);

  // The viewer must clamp into range: 2 items remain, exactly one is active (index 1),
  // and there is never a broken <img>. (Pre-fix the stale index 2 leaves zero active.)
  await expect(thumbs).toHaveCount(2, { timeout: 10_000 });
  await expect(onThumbs).toHaveCount(1);
  await expect(a.page.locator('.viewer-slide img[src=""]')).toHaveCount(0);
  await expect(a.page.locator('.v-strip .v-thumb img[src=""]')).toHaveCount(0);

  // Delete the rest while open → the viewer closes gracefully (no error, no broken UI).
  const remaining = (await messages(a, aChat)).filter((m: any) => m.kind === 'image').map((m: any) => m.id);
  for (const id of remaining) {
    await a.page.evaluate((mid) => (window as any).__ringTest.deleteForEveryone(mid, false), id);
  }
  await expect(a.page.locator('.viewer-track')).toBeHidden({ timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});

/**
 * Spec 1014 US2 — clearing chat media to free space while the viewer is open does
 * not break it: the viewer closes gracefully (the cleared item leaves the set) and
 * never leaves a broken image behind.
 */
test('clearing media while the viewer is open recovers gracefully', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'VIEWERA2');
  const b = await createAccount(ctxB, 'VIEWERB2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.sendImage(id, 800, 600, 'c.png'), aChat);
  await a.page.goto(`/chat/${aChat}`);
  const bubbles = a.page.locator('.bubble .bubble-image');
  await expect(bubbles).toHaveCount(1, { timeout: 30_000 });

  await bubbles.first().click();
  await expect(a.page.locator('.viewer-track')).toBeVisible({ timeout: 10_000 });

  // Clear all images in this chat (the "free space" path: drops Media, sets mediaCleared).
  await a.page.evaluate((id) => (window as any).__ringTest.deleteMediaByKind(['image'], id), aChat);

  // The viewer recovers — it closes (the only item left the set) and shows no broken image.
  await expect(a.page.locator('.viewer-track')).toBeHidden({ timeout: 10_000 });
  await expect(a.page.locator('.viewer-slide img[src=""]')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

/**
 * Spec 1014 US2 (FR-008) — the viewer's thumbnail strip must never render a broken
 * <img> for an item whose thumbnail hasn't resolved (a large/legacy album where only
 * a window around the current item is resolved). Items outside the window must show a
 * neutral placeholder, not an empty <img src="">.
 */
test('viewer strip shows placeholders, never broken images, for unresolved items', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const a = await createAccount(ctxA, 'VIEWERA3');
  // A self-chat-like history isn't available; seed a chat with a peer id and bulk media.
  const ctxB = await browser.newContext();
  const b = await createAccount(ctxB, 'VIEWERB3');
  await pair(a, b);
  const aChat = (await chatWith(a, b.id)) as string;

  // Bulk-seed 200 messages, every 2nd an image (100 images) — legacy-style rows with no
  // embedded poster. Only a window around the newest renders/resolves, so the oldest
  // images stay unresolved (empty thumbnail) and would render broken <img> pre-fix.
  await a.page.evaluate((id) => (window as any).__ringTest.seedMessages(id, 200, { mediaEvery: 2 }), aChat);
  await a.page.goto(`/chat/${aChat}`);
  const bubbles = a.page.locator('.bubble .bubble-image');
  await bubbles.last().waitFor({ state: 'visible', timeout: 30_000 });

  // Open the viewer on the newest image; only items near it resolve, so the strip holds
  // many unresolved items.
  await bubbles.last().click();
  await expect(a.page.locator('.viewer-track')).toBeVisible({ timeout: 10_000 });
  await expect(a.page.locator('.v-strip .v-thumb')).toHaveCount(100);

  // FR-008: no broken images anywhere — unresolved strip items render a placeholder.
  await expect(a.page.locator('.v-strip .v-thumb img[src=""]')).toHaveCount(0);
  await expect(a.page.locator('.viewer-slide img[src=""]')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
