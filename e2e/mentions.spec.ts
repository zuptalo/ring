import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

async function setProfile(p: { page: any }, name: string) {
  await p.page.evaluate(([n, av]: [string, string]) => (window as any).__ringTest.setProfile(n, av), [name, AVATAR]);
}
function unreadMentions(p: { page: any }, chatId: string): Promise<number> {
  return p.page.evaluate((id: string) => (window as any).__ringTest.unreadMentions(id), chatId);
}
async function waitMentions(p: { page: any }, chatId: string, n: number) {
  await p.page.waitForFunction(
    ([id, want]: [string, number]) => (window as any).__ringTest.unreadMentions(id).then((c: number) => c === want),
    [chatId, n] as [string, number],
    { timeout: 30_000 },
  );
}

/**
 * @mentions in group chats (spec 1020). The notification ESCALATION is unit-tested
 * (notify-policy) — here we assert the deterministic data behavior: an @mention is
 * counted only for the mentioned member(s), an @everyone is honored ONLY from the
 * group owner (re-validated on receive), and reading the chat clears the count. The
 * server never sees who is mentioned (it's inside the sealed payload).
 */
test('mentions: individual + owner-only @everyone, counted and validated on receive', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGTST1'); // group owner
  const b = await createAccount(ctxB, 'RINGTST2');
  const c = await createAccount(ctxC, 'RINGTST3');
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');
  await setProfile(c, 'Carol');
  await pair(a, b);
  await pair(a, c);

  const gid = await a.page.evaluate((ids) => (window as any).__ringTest.createGroup('Squad', ids), [b.id, c.id]);
  expect(gid).toBeTruthy();
  // B and C receive the group (the 'create' card carries the owner = A for @everyone).
  for (const p of [b, c]) {
    await p.page.waitForFunction(
      (g) => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.some((x) => x.id === g)),
      gid,
      { timeout: 30_000 },
    );
  }

  // 1) A @mentions B only → B is counted, C is not.
  await a.page.evaluate(([id, bid]) => (window as any).__ringTest.sendWithMentions(id, 'ping for you', [bid]), [gid, b.id]);
  await waitMentions(b, gid, 1);
  await b.page.waitForTimeout(1500);
  expect(await unreadMentions(c, gid)).toBe(0);

  // Reading the chat clears B's mention count.
  await b.page.evaluate((id) => (window as any).__ringTest.markChatRead(id), gid);
  await waitMentions(b, gid, 0);

  // 2) NON-owner (B) @everyone → recipients re-validate sender == owner and REJECT it
  //    (a non-owner cannot forge a broadcast), so nobody's mention count grows from it.
  await b.page.evaluate((id) => (window as any).__ringTest.sendWithMentions(id, 'bob broadcast', [], true), gid);
  await c.page.waitForTimeout(2500);
  expect(await unreadMentions(c, gid)).toBe(0);
  expect(await unreadMentions(a, gid)).toBe(0);

  // 3) Owner (A) @everyone → now both B and C ARE counted (the broadcast is honored).
  await a.page.evaluate((id) => (window as any).__ringTest.sendWithMentions(id, 'all hands', [], true), gid);
  await waitMentions(b, gid, 1);
  await waitMentions(c, gid, 1);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
