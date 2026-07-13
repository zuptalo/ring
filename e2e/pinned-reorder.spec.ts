import { test, expect, type Page } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);
const pinChat = (p: any, chatId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.pinChat(id, true), chatId);
const sendIn = (p: any, chatId: string, body: string) =>
  p.page.evaluate(
    ({ id, b }: { id: string; b: string }) => (window as any).__ringTest.sendChatMessage(id, b),
    { id: chatId, b: body },
  );

const gridOrder = (page: Page) =>
  page.locator('.pin-tile[data-chat-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-chat-id')));

/** Press-and-hold until the lift (spec 1045: 350ms), drag to (x,y), release.
 *  The lift is awaited via its OBSERVABLE signal — the floating proxy appearing —
 *  not a fixed sleep: under parallel-test CPU load the page's lift timer can lag,
 *  and moving before it fires legitimately cancels the hold (scroll wins). */
async function dragTile(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await expect(page.locator('.drag-proxy')).toBeVisible({ timeout: 5_000 });
  // A small nudge to commit to dragging (kills the peek timer), then glide.
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(150); // let hover/FLIP settle
  await page.mouse.up();
}

const center = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/**
 * Spec 1045: the pinned grid keeps the USER'S order — activity never moves a tile;
 * drag rearranges (and persists across a reload); dragging a tile out unpins it;
 * dragging a row in pins it at the drop slot; a still long-press opens the peek
 * (tap outside closes it, its menu acts on the chat).
 */
test('pinned order is user-owned: drag to rearrange, drag in/out to pin/unpin, hold to peek', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'PINRRDA1');
  const b = await createAccount(ctxB, 'PINRRDB1');
  const c = await createAccount(ctxC, 'PINRRDC1');
  await pair(a, b);
  await pair(a, c);

  const chatB = (await chatWith(a, b.id)) as string;
  const chatC = (await chatWith(a, c.id)) as string;
  const tile = (id: string) => a.page.locator(`.pin-tile[data-chat-id="${id}"]`);

  await a.page.goto('/tabs/chats');
  await expect(a.page.locator('ion-item-sliding')).toHaveCount(2, { timeout: 15_000 });

  // First-pin drop zone: with NO pins, lifting a row summons a drop target where
  // the grid will be; dropping there creates the first pin.
  const row0 = await a.page.locator('ion-item-sliding').first().boundingBox();
  if (!row0) throw new Error('row not laid out');
  await a.page.mouse.move(row0.x + row0.width / 2, row0.y + row0.height / 2);
  await a.page.mouse.down();
  await expect(a.page.locator('.drag-proxy')).toBeVisible({ timeout: 5_000 });
  // Nudge IMMEDIATELY: it kills the peek timer. Only then take the slow steps
  // (zone lookup + boundingBox) — under CI load those can exceed the peek window.
  await a.page.mouse.move(row0.x + row0.width / 2 + 12, row0.y + row0.height / 2 + 12, { steps: 3 });
  await expect(a.page.locator('.pin-dropzone')).toBeVisible({ timeout: 5_000 });
  const zone = await a.page.locator('.pin-dropzone').boundingBox();
  if (!zone) throw new Error('drop zone not laid out');
  await a.page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 10 });
  await a.page.waitForTimeout(150);
  await a.page.mouse.up();
  await expect(a.page.locator('.pin-tile')).toHaveCount(1, { timeout: 10_000 });
  // Reset to the no-pins baseline for the arranged-order flow below.
  const firstPinned = await a.page.locator('.pin-tile[data-chat-id]').getAttribute('data-chat-id');
  await a.page.evaluate((id: string) => (window as any).__ringTest.pinChat(id, false), firstPinned!);
  await expect(a.page.locator('.pin-tile')).toHaveCount(0, { timeout: 10_000 });

  // Pin both; pin order (not recency) is the arrangement: B then C.
  await pinChat(a, chatB);
  await pinChat(a, chatC);
  await expect(a.page.locator('.pin-tile')).toHaveCount(2, { timeout: 10_000 });
  expect(await gridOrder(a.page)).toEqual([chatB, chatC]);

  // US1: a new message in C lights its badge but does NOT move it forward. (B stays
  // read — the later peek asserts its "Mark as Unread" label.)
  await sendIn(c, (await chatWith(c, a.id)) as string, 'hello from c');
  await expect(tile(chatC).locator('ion-badge')).toBeVisible({ timeout: 15_000 });
  expect(await gridOrder(a.page)).toEqual([chatB, chatC]);

  // US2: drag C onto B's slot → order flips and persists across a reload.
  const boxB = await tile(chatB).boundingBox();
  const boxC = await tile(chatC).boundingBox();
  if (!boxB || !boxC) throw new Error('tiles not laid out');
  await dragTile(a.page, center(boxC), center(boxB));
  await expect
    .poll(() => gridOrder(a.page), { timeout: 10_000 })
    .toEqual([chatC, chatB]);
  await a.page.reload();
  await a.page.waitForFunction(() => !!(window as any).__ringTest, null, { timeout: 30_000 });
  await expect(a.page.locator('.pin-tile')).toHaveCount(2, { timeout: 15_000 });
  expect(await gridOrder(a.page)).toEqual([chatC, chatB]);

  // US3a: drag B DOWN into the list area → it unpins and returns as a row.
  const boxB2 = await tile(chatB).boundingBox();
  const gridBox = await a.page.locator('.pin-grid').boundingBox();
  if (!boxB2 || !gridBox) throw new Error('grid not laid out');
  await dragTile(a.page, center(boxB2), {
    x: gridBox.x + gridBox.width / 2,
    y: gridBox.y + gridBox.height + 160,
  });
  await expect(a.page.locator('.pin-tile')).toHaveCount(1, { timeout: 10_000 });
  await expect(a.page.locator('ion-item-sliding')).toHaveCount(1, { timeout: 10_000 });

  // US3b: drag the row back UP into the grid, dropping on the FIRST slot → pinned
  // there (before C).
  const rowB = a.page.locator('ion-item-sliding').first();
  const rowBox = await rowB.boundingBox();
  const tileCBox = await tile(chatC).boundingBox();
  if (!rowBox || !tileCBox) throw new Error('row/tile not laid out');
  await dragTile(a.page, center(rowBox), { x: tileCBox.x + 10, y: tileCBox.y + 10 });
  await expect(a.page.locator('.pin-tile')).toHaveCount(2, { timeout: 10_000 });
  await expect.poll(() => gridOrder(a.page), { timeout: 10_000 }).toEqual([chatB, chatC]);

  // US4: a STILL hold opens the peek; tapping outside closes it without opening
  // the chat; Mark as Unread from the menu shows the manual-unread dot.
  const tileB = tile(chatB);
  await tileB.hover();
  await a.page.mouse.down();
  await a.page.waitForTimeout(1200);
  await a.page.mouse.up();
  await expect(a.page.locator('.peek-card')).toBeVisible({ timeout: 10_000 });
  await a.page.mouse.click(8, 300); // backdrop, outside card + menu
  await expect(a.page.locator('.peek-card')).toHaveCount(0, { timeout: 10_000 });
  await expect(a.page).toHaveURL(/tabs\/chats/);

  await tileB.hover();
  await a.page.mouse.down();
  await a.page.waitForTimeout(1200);
  await a.page.mouse.up();
  const markUnread = a.page.locator('.peek-menu ion-item', { hasText: 'Mark as Unread' });
  await expect(markUnread).toBeVisible({ timeout: 10_000 });
  await markUnread.click();
  await expect(tileB.locator('.pin-dot')).toBeVisible({ timeout: 10_000 });

  // Tapping INSIDE the peek opens the chat.
  await tileB.hover();
  await a.page.mouse.down();
  await a.page.waitForTimeout(1200);
  await a.page.mouse.up();
  await expect(a.page.locator('.peek-card')).toBeVisible({ timeout: 10_000 });
  await a.page.locator('.peek-card').click();
  await expect(a.page).toHaveURL(new RegExp(`/chat/${chatB}`), { timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
