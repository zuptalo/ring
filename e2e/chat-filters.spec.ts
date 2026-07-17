import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const hook = (p: { page: any }) => p.page.evaluate.bind(p.page);

/**
 * Chats-tab organisation: per-chat flags (favorite / pin / archive / mark-unread),
 * custom lists, the filter-chip predicates, and that the tab-chip order persists
 * across a reload (proving the synced setting). Driven through the dev test hook
 * (same functions the UI calls), so it's deterministic and not UI-timing dependent.
 */
test('chat filters: favorites, groups, pin order, archive, lists, unread, tab persistence', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CHATFLT1');
  const b = await createAccount(ctxB, 'CHATFLT2');
  const c = await createAccount(ctxC, 'CHATFLT3');
  await pair(a, b);
  await pair(a, c);

  // A has: a 1:1 chat with B, a 1:1 with C, and a group.
  const chatB = (await a.page.evaluate((id) => (window as any).__ringTest.startChat(id), b.id)) as string;
  const chatC = (await a.page.evaluate((id) => (window as any).__ringTest.startChat(id), c.id)) as string;
  const group = (await a.page.evaluate((ids) => (window as any).__ringTest.createGroup('Crew', ids), [b.id, c.id])) as string;

  const matching = (f: string) => a.page.evaluate((x) => (window as any).__ringTest.chatsMatching(x), f) as Promise<string[]>;

  // Groups filter: only the group.
  expect(await matching('groups')).toEqual([group]);

  // Favorites: empty, then includes chatB after favoriting.
  expect(await matching('favorites')).toEqual([]);
  await a.page.evaluate((id) => (window as any).__ringTest.favoriteChat(id), chatB);
  expect(await matching('favorites')).toEqual([chatB]);

  // Mark unread: chatC matches the Unread filter.
  expect(await matching('unread')).not.toContain(chatC);
  await a.page.evaluate((id) => (window as any).__ringTest.markChatUnread(id), chatC);
  expect(await matching('unread')).toContain(chatC);

  // Pin: a pinned chat sorts first in the main list.
  await a.page.evaluate((id) => (window as any).__ringTest.pinChat(id, true), chatC);
  const order = await a.page.evaluate(() => (window as any).__ringTest.chatOrder());
  expect(order[0]).toBe(chatC);

  // Archive: chatB leaves the main list and appears in archived.
  await a.page.evaluate((id) => (window as any).__ringTest.archiveChat(id, true), chatB);
  expect(await a.page.evaluate(() => (window as any).__ringTest.chatOrder())).not.toContain(chatB);
  expect(await a.page.evaluate(() => (window as any).__ringTest.archivedChatIds())).toContain(chatB);

  // Custom list: create one with the group + chatC, assert the list filter matches.
  const listId = (await a.page.evaluate((ids) => (window as any).__ringTest.createList('Fav people', ids), [group])) as string;
  await a.page.evaluate((args) => (window as any).__ringTest.addToList(args[0], args[1]), [listId, chatC]);
  const inList = await matching(`list:${listId}`);
  expect(inList.sort()).toEqual([group, chatC].sort());

  // Delete the list: it's gone (and its filter matches nothing). Chats are untouched.
  await a.page.evaluate((id) => (window as any).__ringTest.deleteList(id), listId);
  expect(await a.page.evaluate(() => (window as any).__ringTest.listIds())).not.toContain(listId);
  expect(await matching(`list:${listId}`)).toEqual([]);
  expect(await a.page.evaluate(() => (window as any).__ringTest.chatOrder())).toContain(group);

  // Lock: chatC leaves the main list and appears in the locked view.
  await a.page.evaluate((id) => (window as any).__ringTest.lockChat(id, true), chatC);
  expect(await a.page.evaluate(() => (window as any).__ringTest.chatOrder())).not.toContain(chatC);
  expect(await a.page.evaluate(() => (window as any).__ringTest.lockedChatIds())).toContain(chatC);
  await a.page.evaluate((id) => (window as any).__ringTest.lockChat(id, false), chatC);
  expect(await a.page.evaluate(() => (window as any).__ringTest.chatOrder())).toContain(chatC);

  // Tab-filter order persists across a reload (proves the synced setting write).
  const desired = ['all', 'groups', 'unread', `list:${listId}`];
  await a.page.evaluate((ids) => (window as any).__ringTest.setTabFilters(ids), desired);
  await a.page.reload();
  await a.page.waitForFunction(() => !!(window as any).__ringTest, null, { timeout: 30_000 });
  expect(await a.page.evaluate(() => (window as any).__ringTest.getTabFilters())).toEqual(desired);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

/**
 * Filter-chip ordering: the saved order is respected, but a chip that gains an unread
 * badge bubbles up to the front (after "All") so it's seen, then drops back to its
 * original place once the unread clears.
 */
test('chat filters: unread chips bubble to the front, then settle back', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CHATFLT1');
  const b = await createAccount(ctxB, 'CHATFLT2');
  await pair(a, b);

  const chatB = (await a.page.evaluate((id) => (window as any).__ringTest.startChat(id), b.id)) as string;
  const listId = (await a.page.evaluate((ids) => (window as any).__ringTest.createList('ZZList', ids), [chatB])) as string;
  // ZZList pinned LAST on the tab.
  await a.page.evaluate((id) => (window as any).__ringTest.setTabFilters(['all', 'unread', 'favorites', 'groups', `list:${id}`]), listId);

  await a.page.goto('/tabs/chats');
  await a.page.waitForSelector('.filter-bar .chip', { timeout: 15000 });

  const labels = async () =>
    (await a.page.locator('.filter-bar .chip').allTextContents()).map((t) => t.replace(/\s*\d+\s*$/, '').trim());

  // Saved order respected initially.
  expect(await labels()).toEqual(['All', 'Unread', 'Favorites', 'Groups', 'ZZList']);

  // Mark the list's chat unread → only the ZZList chip bubbles to the front (after All);
  // the built-in chips keep their saved positions.
  await a.page.evaluate((id) => (window as any).__ringTest.markChatUnread(id), chatB);
  await expect.poll(labels).toEqual(['All', 'ZZList', 'Unread', 'Favorites', 'Groups']);

  // Clear it → ZZList settles back to its saved last position.
  await a.page.evaluate((id) => (window as any).__ringTest.markChatRead(id), chatB);
  await expect.poll(labels).toEqual(['All', 'Unread', 'Favorites', 'Groups', 'ZZList']);

  await ctxA.close();
  await ctxB.close();
});
