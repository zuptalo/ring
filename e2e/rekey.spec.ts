import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ev = (p: any, fn: (a: any) => any, arg: any) => p.page.evaluate(fn, arg);
const chatWith = (p: any, id: string) => ev(p, (x) => (window as any).__ringTest.chatWith(x), id);
const bodies = (p: any, chatId: string) =>
  ev(p, async (id) => (await (window as any).__ringTest.messages(id)).map((m: any) => m.body), chatId);

/**
 * Deleting a 1:1 chat tears down the local ratchet; starting a new chat re-runs
 * X3DH. The peer (who still has the old session) must detect the re-initiation
 * and decrypt - otherwise messages after a delete+restart silently vanish.
 */
test('delete chat + restart re-keys and still delivers', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'REKEYTS1');
  const b = await createAccount(ctxB, 'REKEYTS2');
  await pair(a, b);

  // A → B over the original session.
  const aChat1 = (await chatWith(a, b.id)) as string;
  await ev(a, (id) => (window as any).__ringTest.sendChatMessage(id, 'first'), aChat1);
  await b.page.waitForFunction(
    async (aid) => {
      const id = await (window as any).__ringTest.chatWith(aid);
      if (!id) return false;
      const ms = await (window as any).__ringTest.messages(id);
      return ms.some((m: any) => m.body === 'first');
    },
    a.id,
    { timeout: 30_000 },
  );
  const bChat = (await chatWith(b, a.id)) as string;

  // A deletes the chat (drops the session) and starts a fresh one.
  await ev(a, (id) => (window as any).__ringTest.deleteChat(id), aChat1);
  const aChat2 = (await ev(a, (pid) => (window as any).__ringTest.startChat(pid), b.id)) as string;
  expect(aChat2).toBeTruthy();
  await ev(a, (id) => (window as any).__ringTest.sendChatMessage(id, 'after-rekey'), aChat2);

  // B must decrypt the re-keyed message into the SAME existing 1:1 chat.
  await expect
    .poll(() => bodies(b, bChat), { timeout: 30_000 })
    .toContain('after-rekey');

  // Now B ALSO deletes their chat. A sends again. Because B already accepted the
  // friendship (tracked in the connected-peers ledger), the new chat must be
  // VISIBLE, not hidden as an unaccepted request.
  await ev(b, (id) => (window as any).__ringTest.deleteChat(id), bChat);
  await ev(a, (id) => (window as any).__ringTest.sendChatMessage(id, 'after-both-delete'), aChat2);
  await expect
    .poll(() => ev(b, (pid) => (window as any).__ringTest.visibleChatWith(pid), a.id), { timeout: 30_000 })
    .not.toBe('');
  const bChat2 = (await ev(b, (pid) => (window as any).__ringTest.visibleChatWith(pid), a.id)) as string;
  await expect.poll(() => bodies(b, bChat2), { timeout: 30_000 }).toContain('after-both-delete');
});

/**
 * The harder case: AFTER one side deletes the chat, the OTHER side sends FIRST (a
 * plain 'normal' packet, since their session is warm). The deleter has no session
 * and no prekey to establish one, so without recovery the message is silently
 * dropped. The deleter must auto-request a re-key and the peer must resend, so the
 * message still arrives WITHOUT the deleter having to send first.
 */
test('peer sends first after I delete the chat -> auto re-key still delivers', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'REKEYTS3');
  const b = await createAccount(ctxB, 'REKEYTS4');
  await pair(a, b);

  // Warm both ratchets (A->B then B->A) so B's later send is a 'normal' packet.
  const aChat1 = (await chatWith(a, b.id)) as string;
  await ev(a, (id) => (window as any).__ringTest.sendChatMessage(id, 'hello'), aChat1);
  await b.page.waitForFunction(
    async (aid) => {
      const id = await (window as any).__ringTest.chatWith(aid);
      if (!id) return false;
      const ms = await (window as any).__ringTest.messages(id);
      return ms.some((m: any) => m.body === 'hello');
    },
    a.id,
    { timeout: 30_000 },
  );
  const bChat = (await chatWith(b, a.id)) as string;
  await ev(b, (id) => (window as any).__ringTest.sendChatMessage(id, 'hi back'), bChat);
  await expect.poll(() => bodies(a, aChat1), { timeout: 30_000 }).toContain('hi back');

  // A deletes the chat (drops A's ratchet). A does NOT start a new chat or send.
  await ev(a, (id) => (window as any).__ringTest.deleteChat(id), aChat1);

  // B sends first, over its still-live session: a 'normal' packet A cannot decrypt.
  await ev(b, (id) => (window as any).__ringTest.sendChatMessage(id, 'are-you-there'), bChat);

  // A must still receive it: the undecryptable frame triggers an auto re-key, B
  // resends, and the message lands in A's (re-created, visible) chat with B.
  await expect
    .poll(() => ev(a, (pid) => (window as any).__ringTest.visibleChatWith(pid), b.id), { timeout: 40_000 })
    .not.toBe('');
  const aChat2 = (await ev(a, (pid) => (window as any).__ringTest.visibleChatWith(pid), b.id)) as string;
  await expect.poll(() => bodies(a, aChat2), { timeout: 40_000 }).toContain('are-you-there');
});
