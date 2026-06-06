import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ev = (p: any, fn: (a: any) => any, arg: any) => p.page.evaluate(fn, arg);
const chatWith = (p: any, id: string) => ev(p, (x) => (window as any).__ringTest.chatWith(x), id);
const bodies = (p: any, chatId: string) =>
  ev(p, async (id) => (await (window as any).__ringTest.messages(id)).map((m: any) => m.body), chatId);

/**
 * When a peer deletes (terminates) their account, the server keeps the user row
 * as 'terminated' and wipes their keys. The other side, on a status refresh, must
 * render them as "Ghosted": renamed + tombstone, history kept intact, and sending
 * to them blocked.
 */
test('peer account deletion → Ghosted on the other side', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await createAccount(await browser.newContext(), 'GHOSTTS1');
  const b = await createAccount(await browser.newContext(), 'GHOSTTS2');
  await pair(a, b);

  // B → A, so A has a 1:1 chat + a message from B.
  const bChat = (await chatWith(b, a.id)) as string;
  await ev(b, (id) => (window as any).__ringTest.sendChatMessage(id, 'hi from B'), bChat);
  await a.page.waitForFunction(
    async (bid) => {
      const id = await (window as any).__ringTest.chatWith(bid);
      if (!id) return false;
      const ms = await (window as any).__ringTest.messages(id);
      return ms.some((m: any) => m.body === 'hi from B');
    },
    b.id,
    { timeout: 30_000 },
  );
  const aChat = (await chatWith(a, b.id)) as string;

  // B terminates their account.
  await ev(b, () => (window as any).__ringTest.deleteAccount(), null);

  // A refreshes contact statuses → B becomes "Ghosted".
  await expect
    .poll(
      async () => {
        await ev(a, () => (window as any).__ringTest.refreshContactStatuses(), null);
        return ev(a, (bid) => (window as any).__ringTest.contactGhosted(bid), b.id);
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  // Renamed to "Ghosted"; the prior message is still there (history intact).
  expect(await ev(a, (bid) => (window as any).__ringTest.contactName(bid), b.id)).toBe('Ghosted');
  expect(await bodies(a, aChat)).toContain('hi from B');

  // A can no longer send to B - guardOutbound rejects with 'ghosted'.
  let blocked = false;
  try {
    await ev(a, (id) => (window as any).__ringTest.sendChatMessage(id, 'are you there?'), aChat);
  } catch {
    blocked = true;
  }
  expect(blocked).toBe(true);

  // A deletes the Ghosted contact from the address book → it's removed from the
  // contacts list, BUT the conversation (and its history) is KEPT, and the chat
  // stays read-only. Deleting the conversation is the user's separate choice.
  await ev(a, (bid) => (window as any).__ringTest.deleteContact(bid), b.id);
  // Removed from contacts...
  await expect
    .poll(() => ev(a, () => (window as any).__ringTest.contactIds()))
    .not.toContain(b.id);
  // ...but the chat + message survive...
  expect(await bodies(a, aChat)).toContain('hi from B');
  // ...and sending is still blocked (chat.ghosted survives the contact removal).
  let stillBlocked = false;
  try {
    await ev(a, (id) => (window as any).__ringTest.sendChatMessage(id, 'still there?'), aChat);
  } catch {
    stillBlocked = true;
  }
  expect(stillBlocked).toBe(true);
});
