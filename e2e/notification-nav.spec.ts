import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 2018 (hotfix) — tapping a notification while the app is closed must land IN the
 * chat, with the chat actually RENDERED (not just the URL changed), and back must return
 * to the Chats list (the ecdf5f3 behavior).
 *
 * Repro shape: the SW stashes the tap target (pending-nav) and opens the window; on iOS
 * the window lands on the default tab and the app consumes the stash after unlock. The
 * bug: the consume's replace+push raced Ionic's first outlet transition — URL became
 * /chat/<id> while the Chats list stayed on screen. We simulate the cold start by writing
 * the same pending-nav record the SW writes, then reloading the page.
 */
test('cold start with a pending notification target renders the chat (not a stuck list)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'NOTNAV01');
  const b = await createAccount(ctxB, 'NOTNAV02');
  await pair(a, b);

  // A message exists in B's chat with A, so the rendered chat has visible content.
  const aChat = (await a.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'tap target message'), aChat);
  const bChatOf = () => b.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), a.id);
  await expect.poll(bChatOf, { timeout: 30_000 }).toBeTruthy();
  const bChat = (await bChatOf()) as string;

  // Stash the pending-nav target exactly as the SW's notificationclick does, then
  // cold-start the app (reload → boots at '/', auth gate lands on /tabs/chats, the
  // unlock watcher consumes the stash and deep-links).
  await b.page.evaluate(
    (chatId: string) =>
      (window as any).__ringTest.setSetting('sw.pendingNav', { url: `/chat/${chatId}`, ts: Date.now() }),
    bChat,
  );
  // Throttle the CPU like a phone: the bug is a race between the pending-nav consume
  // and Ionic's FIRST outlet transition — on a fast headless machine the transition
  // wins and the race never shows; on a real device (the report) it loses nearly every
  // time. 6× throttle makes the unfixed code lose it deterministically here too.
  const cdp = await b.page.context().newCDPSession(b.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await b.page.reload();
  await b.page.waitForFunction(() => !!(window as any).__ringTest);

  // The URL must become the chat's…
  await b.page.waitForURL(`**/chat/${bChat}`, { timeout: 20_000 });
  // …and the chat must actually be RENDERED: its message bubble is visible. On the buggy
  // code the Chats list stays on screen under the chat URL, so no bubble ever appears.
  await expect(b.page.locator('.bubble', { hasText: 'tap target message' })).toBeVisible({ timeout: 10_000 });

  // ecdf5f3's guarantee stays: first back from the deep link lands on the Chats list.
  await b.page.goBack();
  await expect(b.page).toHaveURL(/\/tabs\/chats/, { timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});
