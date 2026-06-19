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
  await expect(thumbs).toHaveCount(2, { timeout: 20_000 });
  await expect(onThumbs).toHaveCount(1);
  await expect(a.page.locator('.viewer-slide img[src=""]')).toHaveCount(0);
  await expect(a.page.locator('.v-strip .v-thumb img[src=""]')).toHaveCount(0);

  // Delete the rest while open → the viewer closes gracefully (no error, no broken UI).
  const remaining = (await messages(a, aChat)).filter((m: any) => m.kind === 'image').map((m: any) => m.id);
  for (const id of remaining) {
    await a.page.evaluate((mid) => (window as any).__ringTest.deleteForEveryone(mid, false), id);
  }
  await expect(a.page.locator('.viewer-track')).toBeHidden({ timeout: 20_000 });

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
  await expect(a.page.locator('.viewer-track')).toBeHidden({ timeout: 20_000 });
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

/* ---- US3: fluid navigation (FR-011 indicator, FR-012 keyboard, FR-013 strip, FR-015 restore) ---- */

const activeThumbIndex = (p: any) =>
  p.page.evaluate(() => document.querySelector('.v-strip .v-thumb.on')?.getAttribute('data-i') ?? null);
// The viewer's arrow-key handler is a document-level listener (FR-012). Dispatch straight to it so
// nav is deterministic regardless of which element holds focus after a re-render under parallel load.
// (Escape-to-close is still exercised through the real keyboard, so Ionic's native handling is tested.)
const arrow = (p: any, key: 'ArrowLeft' | 'ArrowRight') =>
  p.page.evaluate(
    (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })),
    key,
  );

/** Spec 1014 US3 FR-011 — the viewer shows a position indicator (current / total). */
test('viewer shows a position indicator that tracks the active item', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'NAVCNT01');
  const b = await createAccount(ctxB, 'NAVCNT02');
  await pair(a, b);
  const aChat = (await chatWith(a, b.id)) as string;
  for (let i = 0; i < 3; i++) {
    await a.page.evaluate(([id, n]) => (window as any).__ringTest.sendImage(id, 800, 600, n), [aChat, `n${i}.png`]);
  }
  await a.page.goto(`/chat/${aChat}`);
  const bubbles = a.page.locator('.bubble .bubble-image');
  await expect(bubbles).toHaveCount(3, { timeout: 30_000 });

  await bubbles.first().click();
  await expect(a.page.locator('.viewer-track')).toBeVisible({ timeout: 10_000 });
  await expect(a.page.locator('.v-count')).toHaveText('1 / 3');
  await a.page.waitForTimeout(500); // let the modal finish presenting (did-present → goToStart) before nav
  await arrow(a, 'ArrowRight');
  await expect(a.page.locator('.v-count')).toHaveText('2 / 3');
  await arrow(a, 'ArrowRight');
  await expect(a.page.locator('.v-count')).toHaveText('3 / 3');

  await ctxA.close();
  await ctxB.close();
});

/** Spec 1014 US3 FR-012 — keyboard ←/→ move between items (clamped at the ends), Escape closes. */
test('viewer supports keyboard navigation and Escape-to-close', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'NAVKEY01');
  const b = await createAccount(ctxB, 'NAVKEY02');
  await pair(a, b);
  const aChat = (await chatWith(a, b.id)) as string;
  for (let i = 0; i < 3; i++) {
    await a.page.evaluate(([id, n]) => (window as any).__ringTest.sendImage(id, 800, 600, n), [aChat, `k${i}.png`]);
  }
  await a.page.goto(`/chat/${aChat}`);
  const bubbles = a.page.locator('.bubble .bubble-image');
  await expect(bubbles).toHaveCount(3, { timeout: 30_000 });

  await bubbles.nth(1).click(); // open on the middle item
  await expect(a.page.locator('.viewer-track')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => activeThumbIndex(a)).toBe('1');
  await a.page.waitForTimeout(500); // let the modal finish presenting (did-present → goToStart) before nav

  // Settle after each key so the index fully lands before the next (robust under parallel load).
  const press = async (key: 'ArrowLeft' | 'ArrowRight', expectIdx: string) => {
    await arrow(a, key);
    await a.page.waitForTimeout(100);
    await expect.poll(() => activeThumbIndex(a)).toBe(expectIdx);
  };
  await press('ArrowRight', '2');
  await press('ArrowRight', '2'); // clamp at the end
  await press('ArrowLeft', '1');
  await press('ArrowLeft', '0');
  await press('ArrowLeft', '0'); // clamp at the start

  // Escape closes through the real keyboard path (Ionic's native overlay handling).
  await a.page.keyboard.press('Escape');
  await expect(a.page.locator('.viewer-track')).toBeHidden({ timeout: 20_000 });

  await ctxA.close();
  await ctxB.close();
});

/** Spec 1014 US3 FR-013 — the bottom strip keeps the active thumbnail visible. On a narrow
 *  viewport the 12-thumb strip overflows, so opening on the LAST item (whose thumb sits past the
 *  right edge at rest) only shows it if the strip auto-scrolls to the active item via scrollStrip().
 *  (Keyboard navigation between items is covered by the keyboard-navigation test.) */
test.describe(() => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('viewer strip auto-scrolls to keep the active thumbnail in view', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await createAccount(ctxA, 'NAVSTR01');
    const b = await createAccount(ctxB, 'NAVSTR02');
    await pair(a, b);
    const aChat = (await chatWith(a, b.id)) as string;
    // 12 real images; on a 390px-wide viewport the 12-thumb strip (≈576px) overflows.
    for (let i = 0; i < 12; i++) {
      await a.page.evaluate(([id, n]) => (window as any).__ringTest.sendImage(id, 400, 300, n), [aChat, `s${i}.png`]);
    }
    await a.page.goto(`/chat/${aChat}`);
    const bubbles = a.page.locator('.bubble .bubble-image');
    await expect(bubbles).toHaveCount(12, { timeout: 60_000 });

    const activeThumbVisible = () =>
      a.page.evaluate(() => {
        const s = document.querySelector('.v-strip') as HTMLElement | null;
        const t = s?.querySelector('.v-thumb.on') as HTMLElement | null;
        if (!s || !t) return false;
        // The thumb overlaps the strip viewport (at scrollLeft 0 the far-right active thumb would not).
        return s.scrollLeft < t.offsetLeft + t.offsetWidth && s.scrollLeft + s.clientWidth > t.offsetLeft;
      });
    const stripScrollLeft = () =>
      a.page.evaluate(() => (document.querySelector('.v-strip') as HTMLElement | null)?.scrollLeft ?? 0);

    // Open on the newest (index 11): its thumb is past the right edge at rest, so the strip MUST
    // have scrolled right to show it (FR-013) — at scrollLeft 0 it would be off-screen.
    await bubbles.last().click();
    await expect(a.page.locator('.viewer-track')).toBeVisible({ timeout: 10_000 });
    await expect(a.page.locator('.v-strip .v-thumb')).toHaveCount(12);
    await expect.poll(() => activeThumbIndex(a)).toBe('11');
    await expect.poll(stripScrollLeft).toBeGreaterThan(0); // strip scrolled to the active item
    await expect.poll(activeThumbVisible).toBe(true);

    await ctxA.close();
    await ctxB.close();
  });
});

/** Spec 1014 US3 FR-015 — closing the viewer returns to the same grid scroll position. */
test('closing the viewer returns to the prior all-media grid scroll position', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'NAVSCR01');
  const b = await createAccount(ctxB, 'NAVSCR02');
  await pair(a, b);
  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.seedMessages(id, 80, { mediaEvery: 1 }), aChat);

  await a.page.goto(`/chat/${aChat}/media`);
  const cells = a.page.locator('.media-grid .media-cell');
  // Wait for the whole grid to render so its height (and scrollable range) is stable.
  await expect(cells).toHaveCount(80, { timeout: 30_000 });

  const scrollEl = () =>
    a.page.evaluate(async () => {
      const c = document.querySelector('ion-content');
      const el = c ? await (c as any).getScrollElement() : null;
      return el ? el.scrollTop : 0;
    });
  await a.page.evaluate(async () => {
    const c = document.querySelector('ion-content');
    const el = c ? await (c as any).getScrollElement() : null;
    if (el) el.scrollTop = 600;
  });
  await expect.poll(scrollEl).toBeGreaterThan(300);

  // Open a cell straddling the vertical middle of the viewport — guaranteed visible, so
  // Playwright's click doesn't auto-scroll.
  const midIdx = await a.page.evaluate(() => {
    const list = [...document.querySelectorAll('.media-grid .media-cell')];
    const midY = window.innerHeight / 2;
    return list.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return r.top <= midY && r.bottom >= midY;
    });
  });
  expect(midIdx).toBeGreaterThanOrEqual(0);
  await a.page.locator('.media-grid .media-cell').nth(midIdx).click();
  await expect(a.page.locator('.viewer-track')).toBeVisible({ timeout: 10_000 });
  // The grid scroll position the viewer was opened from (read behind the open modal).
  const before = await scrollEl();

  await a.page.keyboard.press('Escape');
  await expect(a.page.locator('.viewer-track')).toBeHidden({ timeout: 20_000 });

  // Closing returns to the position it was opened from (FR-015), within a small tolerance.
  await expect.poll(scrollEl).toBeGreaterThan(before - 30);
  expect(await scrollEl()).toBeLessThan(before + 30);

  await ctxA.close();
  await ctxB.close();
});
