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

test('the badge honors always/never/revealed for hidden chats without suppressing visible ones (US4 / FR-015)', async ({ browser }) => {
  test.setTimeout(150_000);
  const a = await createAccount(await browser.newContext(), 'PRIVAC05');
  const b = await createAccount(await browser.newContext(), 'PRIVAC06');
  const c = await createAccount(await browser.newContext(), 'PRIVAC07');
  await pair(a, b);
  await pair(a, c);
  const badge = (): Promise<number> => ev(a, () => (window as any).__ringTest.unreadBadge());

  // One unread in the (soon hidden) chat with B, one unread in the visible chat with C.
  const hiddenChat = await hiddenOneToOne(a, b, '1234');
  const bChat = await ev(b, (id: string) => (window as any).__ringTest.startChat(id), a.id);
  const cChat = await ev(c, (id: string) => (window as any).__ringTest.startChat(id), a.id);
  await ev(b, (id: string) => (window as any).__ringTest.sendChatMessage(id, 'hidden unread'), bChat);
  await ev(c, (id: string) => (window as any).__ringTest.sendChatMessage(id, 'visible unread'), cChat);
  await expect.poll(badge, { timeout: 20_000 }).toBe(2); // default 'always': both count

  // 'never': the hidden unread vanishes from the badge, the visible one stays.
  await ev(a, () => (window as any).__ringTest.setGlobalSetting('privacy.hiddenChatsBadge', 'never'));
  await expect.poll(badge, { timeout: 10_000 }).toBe(1);
  // Another hidden-chat message never bumps it in 'never'.
  await ev(b, (id: string) => (window as any).__ringTest.sendChatMessage(id, 'still hidden'), bChat);
  await a.page.waitForTimeout(2000);
  expect(await badge()).toBe(1);

  // 'revealed': counts hidden unreads only during an active reveal session.
  await ev(a, () => (window as any).__ringTest.setGlobalSetting('privacy.hiddenChatsBadge', 'revealed'));
  expect(await badge()).toBe(1); // relocked → excluded
  expect(await ev(a, (p: string) => (window as any).__ringTest.hiddenReveal(p), '1234')).toBe(true);
  await expect.poll(badge, { timeout: 10_000 }).toBe(3); // revealed → 2 hidden + 1 visible
  await ev(a, () => (window as any).__ringTest.hiddenRelock());
  await expect.poll(badge, { timeout: 10_000 }).toBe(1); // relock → excluded again
  void hiddenChat;
});

test('cold open never flashes a hidden chat and the badge is right from the first frame (US6 / FR-017, SC-006)', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await createAccount(await browser.newContext(), 'PRIVAC08');
  const b = await createAccount(await browser.newContext(), 'PRIVAC09');
  const c = await createAccount(await browser.newContext(), 'PRIVAC10');
  await pair(a, b);
  await pair(a, c);

  // Hidden chat with B (1 unread) + visible chat with C (1 unread), badge mode
  // 'never' → the correct badge is 1; a hidden-inclusive computation would say 2
  // and a collateral fail-closed would say 0. Both are detectable.
  const hiddenChat = await hiddenOneToOne(a, b, '1234');
  const bChat = await ev(b, (id: string) => (window as any).__ringTest.startChat(id), a.id);
  const cChat = await ev(c, (id: string) => (window as any).__ringTest.startChat(id), a.id);
  await ev(a, () => (window as any).__ringTest.setGlobalSetting('privacy.hiddenChatsBadge', 'never'));
  await ev(b, (id: string) => (window as any).__ringTest.sendChatMessage(id, 'hidden unread'), bChat);
  await ev(c, (id: string) => (window as any).__ringTest.sendChatMessage(id, 'visible unread'), cChat);
  const visibleChat = await ev(a, (id: string) => (window as any).__ringTest.chatWith(id), c.id);
  await expect
    .poll(() => ev(a, () => (window as any).__ringTest.unreadBadge()), { timeout: 20_000 })
    .toBe(1); // seeds badge.lastCount with the filtered total

  // SC-006 loop: five cold starts, polling from the earliest possible moment.
  for (let round = 0; round < 5; round++) {
    await a.page.reload();
    const snapshots: Array<{ ids: string[]; badge: number }> = [];
    const deadline = Date.now() + 20_000;
    let settled = false;
    while (Date.now() < deadline) {
      try {
        const snap = await ev(a, async () => ({
          ids: await (window as any).__ringTest.visibleChatIds(),
          badge: await (window as any).__ringTest.unreadBadge(),
        }));
        snapshots.push(snap);
        if (snap.ids.length > 0) {
          settled = true;
          break;
        }
      } catch {
        /* hook not ready yet — keep polling; nothing painted before it either */
      }
      await a.page.waitForTimeout(100);
    }
    expect(settled, `round ${round}: list settled`).toBe(true);
    for (const s of snapshots) {
      expect(s.ids, `round ${round}: hidden chat never in the list`).not.toContain(hiddenChat);
      expect(s.badge, `round ${round}: badge never counts the hidden unread`).toBeLessThanOrEqual(1);
    }
    const last = snapshots[snapshots.length - 1];
    expect(last.ids).toContain(visibleChat); // visible chats correct once painted
    expect(last.badge).toBe(1); // ...and the badge (lastCount fallback → real value)
  }
});
