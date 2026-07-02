import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1027 — the relock kick-out and door guard (US2 / FR-009, bug B5), the
// no-oracle reveal gesture (FR-008), plus badge + cold-open sections (US4/US6)
// added by their phases.

const ev = (p: any, fn: (...a: any[]) => any, ...args: any[]): Promise<any> =>
  p.page.evaluate(fn, ...args);
const visibleIds = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.visibleChatIds());
const path = (p: any): Promise<string> => p.page.evaluate(() => window.location.pathname);

async function hiddenOneToOne(a: any, b: any, pin: string): Promise<string> {
  await ev(a, (id: string) => (window as any).__ringTest.startChat(id), b.id);
  const chat = await ev(a, (id: string) => (window as any).__ringTest.chatWith(id), b.id);
  await ev(a, () => (window as any).__ringTest.setGlobalSetting('privacy.hiddenChatsEnabled', true));
  await ev(a, (p: string) => (window as any).__ringTest.hiddenSetPin(p), pin);
  await ev(a, (id: string) => (window as any).__ringTest.hiddenAdd(id), chat);
  return chat;
}

test('relock kicks an open hidden chat out, and the door guard blocks deep links (US2 / FR-009)', async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await createAccount(await browser.newContext(), 'PRIVAC01');
  const b = await createAccount(await browser.newContext(), 'PRIVAC02');
  await pair(a, b);
  const chat = await hiddenOneToOne(a, b, '1234');

  // Revealed → the hidden chat can be opened like any other (SPA navigation —
  // reveal state is memory-only, a full load would relock by design).
  expect(await ev(a, (p: string) => (window as any).__ringTest.hiddenReveal(p), '1234')).toBe(true);
  await ev(a, (id: string) => (window as any).__ringTest.navigate(`/chat/${id}`), chat);
  await expect.poll(() => path(a)).toBe(`/chat/${chat}`);

  // Relock while INSIDE the chat → kicked out to the Chats list immediately.
  await ev(a, () => (window as any).__ringTest.hiddenRelock());
  await expect.poll(() => path(a), { timeout: 10_000 }).toBe('/tabs/chats');

  // Door guard: SPA-navigating straight to the hidden chat while relocked bounces.
  await ev(a, (id: string) => (window as any).__ringTest.navigate(`/chat/${id}`), chat);
  await expect.poll(() => path(a), { timeout: 10_000 }).toBe('/tabs/chats');

  // ...including its sub-pages (media grid carries the same :id param).
  await ev(a, (id: string) => (window as any).__ringTest.navigate(`/chat/${id}/media`), chat);
  await expect.poll(() => path(a), { timeout: 10_000 }).toBe('/tabs/chats');

  // And a full-load deep link (fresh context = relocked by design) bounces too.
  await a.page.goto(`/chat/${chat}`);
  await a.page.waitForFunction(() => (window as any).__ringTest?.isUnlocked() === true, null, { timeout: 30_000 });
  await expect.poll(() => path(a), { timeout: 15_000 }).toBe('/tabs/chats');
});

test('a wrong PIN in the search bar reveals nothing and gives no signal (FR-008)', async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await createAccount(await browser.newContext(), 'PRIVAC03');
  const b = await createAccount(await browser.newContext(), 'PRIVAC04');
  await pair(a, b);
  const chat = await hiddenOneToOne(a, b, '1234');

  await a.page.goto('/tabs/chats');
  await a.page.waitForFunction(() => (window as any).__ringTest?.isUnlocked() === true, null, { timeout: 30_000 });
  const search = a.page.locator('ion-searchbar input').first();
  await expect(search).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => visibleIds(a), { timeout: 15_000 }).not.toContain(chat);

  // Wrong PIN of the right length: nothing reveals, and the input is NOT
  // cleared — clearing only on success would be an oracle in itself, and
  // clearing on failure would eat an unlucky search query.
  await search.fill('9999');
  await a.page.waitForTimeout(1500); // give a (wrong) reveal time to happen
  expect(await visibleIds(a)).not.toContain(chat);
  await expect(search).toHaveValue('9999');

  // The correct PIN reveals and clears the box (the one intended signal).
  await search.fill('1234');
  await expect.poll(() => visibleIds(a), { timeout: 15_000 }).toContain(chat);
  await expect(search).toHaveValue('');
});
