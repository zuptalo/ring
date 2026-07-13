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

/**
 * Replies-to-you escalate like mentions (spec 1048, US2): a direct reply to a
 * message YOU authored pierces a muted group and lights the unread-mentions
 * indicator; a reply to someone else's message stays muted noise; and the same
 * per-chat "mentions" pref that gates mention escalation gates replies too.
 */
test('replies to your message escalate a muted group like a mention', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'RREPLY1');
  const b = await createAccount(ctxB, 'RREPLY2');
  const c = await createAccount(ctxC, 'RREPLY3');
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');
  await setProfile(c, 'Carol');
  await pair(a, b);
  await pair(a, c);

  const gid = await a.page.evaluate((ids) => (window as any).__ringTest.createGroup('Dinner', ids), [b.id, c.id]);
  for (const p of [b, c]) {
    await p.page.waitForFunction(
      (g) => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.some((x) => x.id === g)),
      gid,
      { timeout: 30_000 },
    );
  }

  // A posts, C posts, everyone receives both; then A mutes the group. B also says
  // one thing FIRST and A receives it — B's replies below must be immediately
  // decryptable by A, which needs B's sender key to have landed (a first-ever group
  // frame can race the key distribution in a seconds-old group).
  await b.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'bob is here'), gid);
  await a.page.waitForFunction(
    (id) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.some((m: any) => m.body === 'bob is here')),
    gid,
    { timeout: 30_000 },
  );
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'planning dinner'), gid);
  await c.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'count me in'), gid);
  const msgIdOf = async (body: string): Promise<string> => {
    let found: string | null = null;
    await expect
      .poll(
        async () => {
          found = await b.page.evaluate(
            ([g, want]: [string, string]) =>
              (window as any).__ringTest
                .messages(g)
                .then((ms: any[]) => (ms.find((m) => m.body === want)?.id as string | undefined) ?? null),
            [gid, body] as [string, string],
          );
          return typeof found === 'string' ? found : null;
        },
        { timeout: 30_000 },
      )
      .not.toBeNull();
    return found as unknown as string;
  };
  const ids = { mine: await msgIdOf('planning dinner'), other: await msgIdOf('count me in') };
  await a.page.evaluate((id) => (window as any).__ringTest.muteChat(id, Date.now() + 3_600_000), gid);

  // 1) B replies to A's message → the reply pierces A's mute (banner) and counts.
  // Arm the banner wait BEFORE sending: banners auto-dismiss after ~4.5s, so a wait
  // started after the trigger can miss one under a loaded runner.
  const replySeen = a.page.waitForFunction(
    () => (window as any).__ringTest.notices().some((n: { body: string }) => String(n.body).includes('on my way to you')),
    undefined,
    { timeout: 30_000 },
  );
  await b.page.evaluate(
    ([id, q]: [string, string]) => (window as any).__ringTest.sendReply(id, 'on my way to you', q),
    [gid, ids.mine] as [string, string],
  );
  await replySeen;
  await waitMentions(a, gid, 1);

  // 2) B replies to CAROL's message → muted noise for A: no new count, no banner.
  await b.page.evaluate(
    ([id, q]: [string, string]) => (window as any).__ringTest.sendReply(id, 'nice carol', q),
    [gid, ids.other] as [string, string],
  );
  await a.page.waitForTimeout(2500);
  expect(await unreadMentions(a, gid)).toBe(1);

  // Reading clears the indicator, as with mentions.
  await a.page.evaluate((id) => (window as any).__ringTest.markChatRead(id), gid);
  await waitMentions(a, gid, 0);

  // 3) The chat's mentions pref off → a reply-to-you no longer escalates (still
  //    counted on the indicator, but no banner pierces the mute).
  await a.page.evaluate((id) => (window as any).__ringTest.setChatNotify(id, { mentions: false }), gid);
  await a.page.waitForFunction(() => (window as any).__ringTest.notices().length === 0, undefined, { timeout: 30_000 });
  await b.page.evaluate(
    ([id, q]: [string, string]) => (window as any).__ringTest.sendReply(id, 'still coming?', q),
    [gid, ids.mine] as [string, string],
  );
  await waitMentions(a, gid, 1);
  expect(
    await a.page.evaluate(() => (window as any).__ringTest.notices().map((n: { body: string }) => n.body)),
  ).toEqual([]);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
