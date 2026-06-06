import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
const setProfile = (p: any, n: string) =>
  p.page.evaluate(([nm, av]: [string, string]) => (window as any).__ringTest.setProfile(nm, av), [n, AVATAR]);
const bodies = (p: any, id: string): Promise<string[]> =>
  p.page.evaluate((c: string) => (window as any).__ringTest.messages(c).then((ms: any[]) => ms.map((m) => m.body)), id);
const groupIds = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.map((g) => g.id)));
const inviteIds = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.groupInviteIds());
const idOf = (p: any, chatId: string, body: string): Promise<string> =>
  p.page.evaluate(
    ([id, b]: [string, string]) =>
      (window as any).__ringTest.messages(id).then((ms: any[]) => ms.find((m) => m.body === b)?.id ?? ''),
    [chatId, body],
  );

/**
 * Group invitations with a membership boundary:
 *  - A creates a group with B (immediate) and sends msg1/msg2.
 *  - A invites C mid-thread; C sees a pending invitation but NO group chat and
 *    NONE of the pre-join messages.
 *  - C accepts → joins; A's later msg3 reaches C, but pre-join history never does.
 *  - A reaction to a pre-join message is silently dropped on C (no crash).
 *  - A reply to a pre-join message still renders its quote snapshot on C.
 */
test('group invite: membership boundary + graceful pre-join reply/reaction', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'GRPINV01');
  const b = await createAccount(ctxB, 'GRPINV02');
  const c = await createAccount(ctxC, 'GRPINV03');
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');
  await setProfile(c, 'Carol');

  await pair(a, b); // A & B connected (B is an initial member)
  await pair(a, c); // A & C connected (so A can seal an invite to C)

  // A creates the group with B (initial members join immediately).
  const gid = (await a.page.evaluate((ids) => (window as any).__ringTest.createGroup('Trip', ids), [b.id])) as string;
  await b.page.waitForFunction(
    (g) => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.some((x) => x.id === g)),
    gid,
    { timeout: 30_000 },
  );

  // A sends two messages BEFORE inviting C.
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'msg1'), gid);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'msg2'), gid);
  await expect.poll(() => bodies(b, gid)).toContain('msg2');

  // A invites C. C gets a pending invitation - but NO group chat and NO history.
  await a.page.evaluate(([id, cid]) => (window as any).__ringTest.inviteToGroup(id, cid), [gid, c.id]);
  await expect.poll(() => inviteIds(c), { timeout: 30_000 }).toContain(gid);
  expect(await groupIds(c)).not.toContain(gid);

  // C accepts → the group chat is created on C; A moves C into the live roster.
  await c.page.evaluate((g) => (window as any).__ringTest.acceptGroupInvite(g), gid);
  await c.page.waitForFunction(
    (g) => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.some((x) => x.id === g)),
    gid,
    { timeout: 30_000 },
  );

  // The membership boundary: C has NONE of the pre-join messages.
  expect(await bodies(c, gid)).not.toContain('msg1');
  expect(await bodies(c, gid)).not.toContain('msg2');

  // Once A registers C as a member, A's next message reaches C - but only that one.
  await a.page.waitForFunction(
    ([g, cid]) =>
      (window as any).__ringTest.groupChats().then((gs: any[]) => gs.find((x) => x.id === g)?.members?.includes(cid)),
    [gid, c.id],
    { timeout: 30_000 },
  );
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'msg3'), gid);
  await expect.poll(() => bodies(c, gid), { timeout: 30_000 }).toContain('msg3');
  expect(await bodies(c, gid)).not.toContain('msg1');

  // B reacts to a PRE-JOIN message (msg1). C doesn't have it → silently dropped,
  // no crash; C still only has post-join messages.
  const msg1Id = await idOf(b, gid, 'msg1');
  await b.page.evaluate((mid) => (window as any).__ringTest.reactToMessage(mid, '👍'), msg1Id);
  await c.page.waitForTimeout(1500);
  expect(await bodies(c, gid)).toContain('msg3');

  // A replies to a PRE-JOIN message (msg2); C receives the reply, and its quote
  // snapshot renders even though C never had the original.
  const msg2Id = await idOf(a, gid, 'msg2');
  await a.page.evaluate(([id, mid]) => (window as any).__ringTest.sendReply(id, 'about msg2', mid), [gid, msg2Id]);
  await expect.poll(() => bodies(c, gid), { timeout: 30_000 }).toContain('about msg2');
  const reply = await c.page.evaluate(
    ([id, body]: [string, string]) =>
      (window as any).__ringTest.messages(id).then((ms: any[]) => ms.find((m) => m.body === body)),
    [gid, 'about msg2'],
  );
  expect(reply.replyTo).toBeTruthy();

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
