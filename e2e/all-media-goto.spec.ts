import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

/**
 * Spec 1014 — "Go to message" from the all-media page must jump to the original message in the
 * chat, for the media viewer AND the links/docs tabs. (Regression: AllMediaPage's viewer used to
 * just open the chat at the bottom, ignoring the message id; links/docs had no go-to-message.)
 */
test('all-media "Go to message" jumps to the message — viewer, links, and docs', async ({ browser }) => {
  const a = await createAccount(await browser.newContext(), 'GOTOA1');
  const b = await createAccount(await browser.newContext(), 'GOTOB1');
  await pair(a, b);
  const aChat = (await chatWith(a, b.id)) as string;

  // An image (media tab), a link message (links tab), and a document (docs tab).
  await a.page.evaluate((id) => (window as any).__ringTest.sendImage(id, 800, 600, 'photo.png'), aChat);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'great read https://ring.example/post'), aChat);
  await a.page.evaluate((id) => (window as any).__ringTest.seedMedia(id, 'file', 250_000), aChat);

  const onChatNotMedia = () =>
    a.page.evaluate((id) => location.pathname === `/chat/${id}` && location.search.includes('jump='), aChat);
  // Ionic's <ion-segment> doesn't reliably switch on a synthetic click in Playwright; drive its
  // ionChange directly (the component reads $event.detail.value) — this still renders the real tab.
  const switchTab = (tab: string) =>
    a.page.locator('ion-segment').evaluate((el: any, t: string) => {
      el.value = t;
      el.dispatchEvent(new CustomEvent('ionChange', { detail: { value: t }, bubbles: true }));
    }, tab);

  // --- Media tab: open the viewer, use the overflow "Go to message" ---
  await a.page.goto(`/chat/${aChat}/media`);
  await expect(a.page.locator('.media-grid .media-cell').first()).toBeVisible({ timeout: 30_000 });
  await a.page.locator('.media-grid .media-cell').first().click();
  await expect(a.page.locator('.viewer-track')).toBeVisible({ timeout: 10_000 });
  await a.page.locator('.v-top button[aria-label="More"]').click();
  await a.page.locator('.v-menu button', { hasText: 'Go to message' }).click();
  await expect.poll(onChatNotMedia).toBe(true); // navigated to the chat WITH a jump target
  await expect(a.page.locator('.bubble .bubble-image').first()).toBeVisible({ timeout: 10_000 });

  // --- Links tab: the row's go-to-message button ---
  await a.page.goto(`/chat/${aChat}/media`);
  await expect(a.page.locator('ion-segment')).toBeVisible({ timeout: 30_000 });
  await switchTab('links');
  const linkGoto = a.page.locator('ion-item button[aria-label="Go to message"]');
  await expect(linkGoto.first()).toBeVisible({ timeout: 10_000 });
  await linkGoto.first().click();
  await expect.poll(onChatNotMedia).toBe(true);

  // --- Docs tab: the row's go-to-message button ---
  await a.page.goto(`/chat/${aChat}/media`);
  await expect(a.page.locator('ion-segment')).toBeVisible({ timeout: 30_000 });
  await switchTab('docs');
  const docGoto = a.page.locator('ion-item button[aria-label="Go to message"]');
  await expect(docGoto.first()).toBeVisible({ timeout: 10_000 });
  await docGoto.first().click();
  await expect.poll(onChatNotMedia).toBe(true);

  await a.page.context().close();
  await b.page.context().close();
});
