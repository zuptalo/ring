import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1027 — hide MOVES the conversation and the hidden thread keeps receiving
// silently (US1, bug B1 regression), and one hidden + one visible chat coexist
// per person with Hide/Unhide gated by the pair invariant (US3).

const ev = (p: any, fn: (...a: any[]) => any, ...args: any[]): Promise<any> =>
  p.page.evaluate(fn, ...args);
const visibleIds = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.visibleChatIds());
const chatsWith = (p: any, peerId: string): Promise<{ id: string; isGroup: boolean }[]> =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatsWith(id), peerId);
const bodies = async (p: any, chatId: string): Promise<string[]> =>
  (await p.page.evaluate((id: string) => (window as any).__ringTest.messages(id), chatId)).map(
    (m: any) => m.body,
  );

test('hiding the only 1:1 keeps it receiving silently — no visible resurrection (US1 / bug B1)', async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await createAccount(await browser.newContext(), 'COEXIST1');
  const b = await createAccount(await browser.newContext(), 'COEXIST2');
  await pair(a, b);

  // Baseline: a visible 1:1 with traffic in both directions (so the ratchet is
  // fully established under this chat id before we hide it).
  await ev(a, (id: string) => (window as any).__ringTest.startChat(id), b.id);
  const aChat = await ev(a, (id: string) => (window as any).__ringTest.chatWith(id), b.id);
  const bChat = await ev(b, (id: string) => (window as any).__ringTest.startChat(id), a.id);
  await ev(b, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'before hide'), bChat);
  await expect.poll(() => bodies(a, aChat), { timeout: 20_000 }).toContain('before hide');

  // Hide it. It leaves the visible list; the person has NO visible presence.
  await ev(a, (pin: string) => (window as any).__ringTest.hiddenSetPin(pin), '2468');
  await ev(a, (id: string) => (window as any).__ringTest.hiddenAdd(id), aChat);
  await expect.poll(() => visibleIds(a)).not.toContain(aChat);

  // THE B1 REGRESSION: B keeps talking. The message must land in the HIDDEN
  // thread — not resurrect a visible chat, not mint a second 1:1, not re-key.
  await ev(b, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'secret ping'), bChat);
  await expect.poll(() => bodies(a, aChat), { timeout: 20_000 }).toContain('secret ping');
  expect(await visibleIds(a)).not.toContain(aChat);
  // Still exactly ONE conversation with B on A's device, and nothing visible.
  const withB = await chatsWith(a, b.id);
  expect(withB).toHaveLength(1);
  expect(withB[0].id).toBe(aChat);
  expect(
    await ev(a, (id: string) => (window as any).__ringTest.visibleChatWith(id), b.id),
  ).toBe('');

  // The badge still counts it (default mode 'always').
  await expect.poll(() => ev(a, () => (window as any).__ringTest.unreadBadge())).toBeGreaterThan(0);

  // Reveal shows the full history inside the one hidden thread.
  expect(await ev(a, (p: string) => (window as any).__ringTest.hiddenReveal(p), '2468')).toBe(true);
  await expect.poll(() => visibleIds(a)).toContain(aChat);
  expect(await bodies(a, aChat)).toEqual(expect.arrayContaining(['before hide', 'secret ping']));

  // And the ratchet did not fork: A can still reply over the same session and B
  // receives it in their one chat.
  await ev(a, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'reply from hiding'), aChat);
  await expect.poll(() => bodies(b, bChat), { timeout: 20_000 }).toContain('reply from hiding');
});

test('one hidden + one visible chat per person: coexistence, isolation, and blocked Hide/Unhide (US3)', async ({ browser }) => {
  test.setTimeout(150_000);
  const a = await createAccount(await browser.newContext(), 'COEXIST3');
  const b = await createAccount(await browser.newContext(), 'COEXIST4');
  await pair(a, b);

  // Establish + hide the 1:1.
  await ev(a, (id: string) => (window as any).__ringTest.startChat(id), b.id);
  const hiddenChat = await ev(a, (id: string) => (window as any).__ringTest.chatWith(id), b.id);
  const bChat = await ev(b, (id: string) => (window as any).__ringTest.startChat(id), a.id);
  await ev(b, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'seed'), bChat);
  await expect.poll(() => bodies(a, hiddenChat), { timeout: 20_000 }).toContain('seed');
  await ev(a, (pin: string) => (window as any).__ringTest.hiddenSetPin(pin), '1234');
  await ev(a, (id: string) => (window as any).__ringTest.hiddenAdd(id), hiddenChat);
  await expect.poll(() => visibleIds(a)).not.toContain(hiddenChat);

  // FR-004: starting a NEW conversation with the same person creates a fresh
  // VISIBLE thread — a pair conversation (distinct channel), no PIN involved —
  // while the hidden thread stays hidden.
  const visibleChat = await ev(a, (id: string) => (window as any).__ringTest.startChat(id), b.id);
  expect(visibleChat).not.toBe(hiddenChat);
  await expect.poll(() => visibleIds(a)).toContain(visibleChat);
  expect(await visibleIds(a)).not.toContain(hiddenChat);
  const threads = await chatsWith(a, b.id);
  expect(threads).toHaveLength(2);
  expect(threads.find((t) => t.id === visibleChat)?.isGroup).toBe(true); // pair conversation

  // FR-005 isolation, both directions. B sees the pair conversation appear (a
  // normal new conversation from their side) and replies in each thread.
  await ev(a, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'open hello'), visibleChat);
  await expect.poll(() => bodies(b, visibleChat), { timeout: 20_000 }).toContain('open hello'); // group ids are shared
  await ev(b, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'open reply'), visibleChat);
  await ev(b, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'secret reply'), bChat);
  await expect.poll(() => bodies(a, visibleChat), { timeout: 20_000 }).toContain('open reply');
  await expect.poll(() => bodies(a, hiddenChat), { timeout: 20_000 }).toContain('secret reply');
  // Zero cross-contamination.
  expect(await bodies(a, visibleChat)).not.toContain('secret reply');
  expect(await bodies(a, hiddenChat)).not.toContain('open reply');
  expect(await bodies(a, hiddenChat)).not.toContain('open hello');

  // INV-1: hiding the visible thread is blocked while the hidden one exists.
  const hideVerdict = await ev(a, (id: string) => (window as any).__ringTest.hiddenCanHide(id), visibleChat);
  expect(hideVerdict.ok).toBe(false);
  expect(hideVerdict.reason).toMatch(/already have a hidden chat/i);

  // INV-2: unhiding is blocked while the visible thread exists.
  const unhideVerdict = await ev(a, (id: string) => (window as any).__ringTest.hiddenCanUnhide(id), hiddenChat);
  expect(unhideVerdict.ok).toBe(false);
  expect(unhideVerdict.reason).toMatch(/already have a chat/i);

  // Delete the visible thread → unhide becomes possible and works.
  await ev(a, (id: string) => (window as any).__ringTest.deleteChat(id), visibleChat);
  await expect
    .poll(async () => (await ev(a, (id: string) => (window as any).__ringTest.hiddenCanUnhide(id), hiddenChat)).ok)
    .toBe(true);
  await ev(a, (id: string) => (window as any).__ringTest.hiddenRemove(id), hiddenChat);
  await expect.poll(() => visibleIds(a)).toContain(hiddenChat);
});
