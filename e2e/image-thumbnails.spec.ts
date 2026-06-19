import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);
const messages = (p: any, chatId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.messages(id), chatId);
const tierDims = (p: any, msgId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.mediaTierDims(id), msgId);

/**
 * Spec 1014 — image thumbnail tiers (US1). A shared image is downscaled into three
 * persisted tiers: bubble (≤512), grid (≤320) and strip (≤128). The bubble tier rides
 * the sealed envelope (MediaRef.poster) so the recipient previews the photo from the
 * message itself; both sides derive the grid/strip tiers locally. Each surface renders
 * its own right-sized tier (chat bubble = bubble, album grid = grid, viewer strip =
 * strip) and the persisted tiers survive re-navigation without regeneration.
 */
test('image is downscaled into bubble/grid/strip tiers, sent E2EE, and rendered per surface', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'THUMBSA1');
  const b = await createAccount(ctxB, 'THUMBSB1');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  expect(aChat).toBeTruthy();

  // Sender shares a real 1024×768 gradient image at original quality.
  await a.page.evaluate((id) => (window as any).__ringTest.sendImage(id, 1024, 768), aChat);

  // The sender derives + persists all three tiers off the send path. Wait for them.
  const aMsgId = await a.page.evaluate(async (id) => {
    const find = async () => {
      const ms = await (window as any).__ringTest.messages(id);
      return ms.find((m: any) => m.kind === 'image');
    };
    for (let i = 0; i < 100; i++) {
      const m = await find();
      if (m) {
        const t = await (window as any).__ringTest.mediaTierDims(m.id);
        if (t.bubble && t.grid && t.strip) return m.id;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }, aChat);
  expect(aMsgId).toBeTruthy();

  // Each tier is right-sized: bubble ≤512, grid ≤320, strip ≤128 (and the full image is intact).
  const aTiers = await tierDims(a, aMsgId as string);
  expect(aTiers.full).toEqual({ w: 1024, h: 768 });
  expect(Math.max(aTiers.bubble.w, aTiers.bubble.h)).toBeLessThanOrEqual(512);
  expect(Math.max(aTiers.grid.w, aTiers.grid.h)).toBeLessThanOrEqual(320);
  expect(Math.max(aTiers.strip.w, aTiers.strip.h)).toBeLessThanOrEqual(128);
  // Tiers are genuinely distinct sizes (strip < grid < bubble < full).
  expect(aTiers.strip.w).toBeLessThan(aTiers.grid.w);
  expect(aTiers.grid.w).toBeLessThan(aTiers.bubble.w);
  expect(aTiers.bubble.w).toBeLessThan(aTiers.full.w);

  // Receiver: the image arrives carrying the bubble-tier preview in the sealed envelope
  // (hasPoster), and the grid/strip tiers are derived locally on receive.
  const bChat = (await chatWith(b, a.id)) as string;
  const bMsgId = await b.page.evaluate(async (id) => {
    for (let i = 0; i < 150; i++) {
      const ms = await (window as any).__ringTest.messages(id);
      const m = ms.find((x: any) => x.kind === 'image');
      if (m && m.hasPoster) {
        const t = await (window as any).__ringTest.mediaTierDims(m.id);
        if (t.bubble && t.grid && t.strip) return m.id;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }, bChat);
  expect(bMsgId).toBeTruthy();

  const bMsgs = await messages(b, bChat);
  expect(bMsgs.find((m: any) => m.id === bMsgId)?.hasPoster).toBe(true);

  const bTiers = await tierDims(b, bMsgId as string);
  expect(Math.max(bTiers.bubble.w, bTiers.bubble.h)).toBeLessThanOrEqual(512);
  expect(Math.max(bTiers.grid.w, bTiers.grid.h)).toBeLessThanOrEqual(320);
  expect(Math.max(bTiers.strip.w, bTiers.strip.h)).toBeLessThanOrEqual(128);

  // UI: the receiver's chat bubble shows the image (from the bubble tier).
  await b.page.goto(`/chat/${bChat}`);
  await expect(b.page.locator('.bubble .bubble-image').last()).toBeVisible({ timeout: 30_000 });

  // The all-media grid renders the thumbnail; it persists across re-navigation (no regeneration).
  await b.page.goto(`/chat/${bChat}/media`);
  await expect(b.page.locator('.media-grid .media-cell img').first()).toBeVisible({
    timeout: 30_000,
  });
  await b.page.goto(`/chat/${bChat}`);
  await b.page.goto(`/chat/${bChat}/media`);
  await expect(b.page.locator('.media-grid .media-cell img').first()).toBeVisible({
    timeout: 30_000,
  });

  await ctxA.close();
  await ctxB.close();
});
