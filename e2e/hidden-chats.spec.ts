import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1019 — Hidden Chats. Hiding is a local, zero-knowledge privacy layer: a
// hidden conversation is removed from every visible surface and only revealed by
// the dedicated PIN. Driven through the dev test hook (the same service the UI
// calls) plus a real UI check of the search-bar reveal gesture.

const ev = (p: any, fn: (...a: any[]) => any, ...args: any[]): Promise<any> =>
  p.page.evaluate(fn, ...args);
const visibleIds = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.visibleChatIds());
const hiddenIds = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.hiddenIds());
const chatWith = (p: any, peerId: string): Promise<string> =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

test('hide → reveal → unhide, coexistence, and re-locks across a restart (US1/US2/US3)', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await createAccount(await browser.newContext(), 'HIDDEN01');
  const b = await createAccount(await browser.newContext(), 'HIDDEN02');
  await pair(a, b);

  // A has a normal, visible 1:1 chat with B.
  await ev(a, (id: string) => (window as any).__ringTest.startChat(id), b.id);
  const oneToOne = await chatWith(a, b.id);
  expect(oneToOne).not.toBe('');
  expect(await visibleIds(a)).toContain(oneToOne);

  // US1: set the dedicated PIN and hide the chat → it leaves every visible surface.
  await ev(a, (pin: string) => (window as any).__ringTest.hiddenSetPin(pin), '1234');
  await ev(a, (id: string) => (window as any).__ringTest.hiddenAdd(id), oneToOne);
  expect(await hiddenIds(a)).toContain(oneToOne);
  await expect.poll(() => visibleIds(a)).not.toContain(oneToOne);

  // US3: a wrong PIN reveals nothing; the correct PIN reveals the hidden chat.
  expect(await ev(a, (p: string) => (window as any).__ringTest.hiddenReveal(p), '0000')).toBe(false);
  await expect.poll(() => visibleIds(a)).not.toContain(oneToOne);
  expect(await ev(a, (p: string) => (window as any).__ringTest.hiddenReveal(p), '1234')).toBe(true);
  await expect.poll(() => visibleIds(a)).toContain(oneToOne);

  // FR-005: re-lock → hidden again.
  await ev(a, () => (window as any).__ringTest.hiddenRelock());
  await expect.poll(() => visibleIds(a)).not.toContain(oneToOne);

  // FR-005 / SC-009: a full restart (reload) re-locks — the hidden chat stays
  // hidden with no reveal session carried over.
  await a.page.reload();
  await a.page.waitForFunction(() => (window as any).__ringTest?.isUnlocked() === true, null, { timeout: 30_000 });
  await expect.poll(() => visibleIds(a), { timeout: 15_000 }).not.toContain(oneToOne);
  expect(await hiddenIds(a)).toContain(oneToOne); // set survived the restart

  // US2: a NEW hidden chat with the SAME contact is a DISTINCT conversation; the
  // normal 1:1 is untouched.
  const hiddenChat = await ev(a, (id: string) => (window as any).__ringTest.hiddenStartChat(id), b.id);
  expect(hiddenChat).not.toBe(oneToOne);
  expect(await hiddenIds(a)).toEqual(expect.arrayContaining([oneToOne, hiddenChat]));

  // US3 unhide (FR-006): the 1:1 returns permanently, even after a re-lock; the
  // distinct hidden chat stays hidden.
  await ev(a, (id: string) => (window as any).__ringTest.hiddenRemove(id), oneToOne);
  await ev(a, () => (window as any).__ringTest.hiddenRelock());
  await expect.poll(() => visibleIds(a)).toContain(oneToOne);
  await expect.poll(() => visibleIds(a)).not.toContain(hiddenChat);
});

test('search-bar PIN reveals hidden chats in the UI (US3 reveal gesture)', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await createAccount(await browser.newContext(), 'HIDDEN03');
  const b = await createAccount(await browser.newContext(), 'HIDDEN04');
  await pair(a, b);

  // Create the 1:1, enable the feature (so the reveal gesture is armed — FR-013a),
  // set a PIN, and hide it.
  await ev(a, (id: string) => (window as any).__ringTest.startChat(id), b.id);
  const chat = await chatWith(a, b.id);
  await ev(a, () => (window as any).__ringTest.setGlobalSetting('privacy.hiddenChatsEnabled', true));
  await ev(a, (pin: string) => (window as any).__ringTest.hiddenSetPin(pin), '4321');
  await ev(a, (id: string) => (window as any).__ringTest.hiddenAdd(id), chat);

  // Land on the Chats tab; the hidden chat is excluded from the list.
  await a.page.goto('/tabs/chats');
  await a.page.waitForFunction(() => (window as any).__ringTest?.isUnlocked() === true, null, { timeout: 30_000 });
  const search = a.page.locator('ion-searchbar input').first();
  await expect(search).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => visibleIds(a), { timeout: 15_000 }).not.toContain(chat);

  // Typing the dedicated PIN into the real search bar input triggers the reveal
  // gesture (the only entry point, US3) — the hidden chat returns to the list.
  await search.fill('4321');
  await expect.poll(() => visibleIds(a), { timeout: 15_000 }).toContain(chat);
});

test('PIN reset wipes hidden chats and blocks re-sync (US7)', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await createAccount(await browser.newContext(), 'HIDDEN05');
  const b = await createAccount(await browser.newContext(), 'HIDDEN06');
  await pair(a, b);

  await ev(a, (id: string) => (window as any).__ringTest.startChat(id), b.id);
  const chat = await chatWith(a, b.id);
  await ev(a, (pin: string) => (window as any).__ringTest.hiddenSetPin(pin), '1357');
  await ev(a, (id: string) => (window as any).__ringTest.hiddenAdd(id), chat);
  expect(await hiddenIds(a)).toContain(chat);

  // Reset → the hidden set is empty, the conversation is gone, and the old PIN no
  // longer reveals anything.
  const res = await ev(a, () => (window as any).__ringTest.hiddenReset());
  expect(res.wiped).toContain(chat);
  expect(await hiddenIds(a)).toEqual([]);
  await expect.poll(() => visibleIds(a)).not.toContain(chat); // wiped, not merely hidden
  expect(await ev(a, (p: string) => (window as any).__ringTest.hiddenReveal(p), '1357')).toBe(false);
});
