import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);
const pinChat = (p: any, chatId: string, pinned = true) =>
  p.page.evaluate(
    ({ id, v }: { id: string; v: boolean }) => (window as any).__ringTest.pinChat(id, v),
    { id: chatId, v: pinned },
  );

/**
 * Spec 1044: pinned chats render as an iMessage-style avatar grid above the chat
 * list (up to 9); while gridded they leave the list rows; tapping a tile opens the
 * chat; long-press opens the actions sheet whose new Unpin returns them to the
 * list; search shows pinned chats as plain rows again. Chat rows are
 * ion-item-sliding (the swipeable ChatListItem root); tiles carry data-chat-id.
 */
test('pinned chats form the avatar grid, leave the list, and manage via long-press', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'PINGRDA1');
  const b = await createAccount(ctxB, 'PINGRDB1');
  const c = await createAccount(ctxC, 'PINGRDC1');
  await pair(a, b);
  await pair(a, c);

  const chatB = (await chatWith(a, b.id)) as string;
  const chatC = (await chatWith(a, c.id)) as string;
  const rows = () => a.page.locator('ion-item-sliding');
  const tiles = () => a.page.locator('.pin-tile');

  await a.page.goto('/tabs/chats');
  // Both chats start as plain rows; no grid.
  await expect(rows()).toHaveCount(2, { timeout: 15_000 });
  await expect(a.page.locator('.pin-grid')).toHaveCount(0);

  // Pin both → two tiles, and the rows leave the list.
  await pinChat(a, chatB);
  await pinChat(a, chatC);
  await expect(tiles()).toHaveCount(2, { timeout: 10_000 });
  await expect(rows()).toHaveCount(0);

  // Tap a tile → the chat opens.
  await a.page.locator(`.pin-tile[data-chat-id="${chatB}"]`).click();
  await expect(a.page).toHaveURL(new RegExp(`/chat/${chatB}`), { timeout: 10_000 });
  await a.page.goBack();
  await expect(tiles()).toHaveCount(2, { timeout: 10_000 });

  // Search: the grid hides and pinned chats are findable as rows. Search by the
  // tile's own displayed name so retry-minted usernames can't desync the test.
  const nameC = (await a.page.locator(`.pin-tile[data-chat-id="${chatC}"] .pin-name`).textContent())?.trim();
  if (!nameC) throw new Error('no tile name');
  await a.page.locator('ion-searchbar input').fill(nameC);
  await expect(a.page.locator('.pin-grid')).toHaveCount(0, { timeout: 10_000 });
  await expect(rows()).toHaveCount(1, { timeout: 10_000 });
  await a.page.locator('ion-searchbar input').fill('');
  await expect(tiles()).toHaveCount(2, { timeout: 10_000 });

  // Long-press a tile → actions sheet → Unpin returns the chat to the list.
  // hover() auto-waits for the tile to be stable/visible so the press can't land
  // on empty space while the grid reflows after the search clear.
  const tileC = a.page.locator(`.pin-tile[data-chat-id="${chatC}"]`);
  await tileC.hover();
  await a.page.mouse.down();
  await a.page.waitForTimeout(700);
  await a.page.mouse.up();
  const unpin = a.page.locator('ion-item', { hasText: 'Unpin' });
  await expect(unpin).toBeVisible({ timeout: 10_000 });
  await unpin.click();
  await expect(tiles()).toHaveCount(1, { timeout: 10_000 });
  await expect(rows()).toHaveCount(1, { timeout: 10_000 });

  // Hidden interplay (US3): hiding the still-pinned chat removes its TILE too —
  // the grid inherits listChats' fail-closed hidden filtering, so a pinned hidden
  // chat never leaks through the grid while concealed.
  await a.page.evaluate(() => (window as any).__ringTest.hiddenSetPin('7391'));
  await a.page.evaluate((id: string) => (window as any).__ringTest.hiddenAdd(id), chatB);
  await expect(tiles()).toHaveCount(0, { timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
