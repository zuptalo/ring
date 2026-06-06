import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

async function setProfile(p: { page: any }, name: string) {
  await p.page.evaluate(([n, av]: [string, string]) => (window as any).__ringTest.setProfile(n, av), [name, AVATAR]);
}

async function groupIds(p: { page: any }): Promise<string[]> {
  return p.page.evaluate(() => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.map((g) => g.id)));
}

async function bodies(p: { page: any }, chatId: string): Promise<string[]> {
  return p.page.evaluate(
    (id: string) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.map((m) => m.body)),
    chatId,
  );
}

/**
 * Group chat over pairwise fan-out: A creates a group with B and C (A is contacts
 * with both; B and C are NOT contacts). A message from B must reach BOTH A and C
 * - proving the on-demand B↔C session (the full-mesh case) - and leaving removes
 * the member from everyone's roster.
 */
test('group chat: create, fan-out message reaches all, and leave', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();

  const a = await createAccount(ctxA, 'RINGTST1');
  const b = await createAccount(ctxB, 'RINGTST2');
  const c = await createAccount(ctxC, 'RINGTST3');
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');
  await setProfile(c, 'Carol');

  // A is contacts with B and C. B and C are NOT contacts with each other.
  await pair(a, b);
  await pair(a, c);

  // A creates the group.
  const groupId = await a.page.evaluate(
    (ids) => (window as any).__ringTest.createGroup('Trip', ids),
    [b.id, c.id],
  );
  expect(groupId).toBeTruthy();

  // B and C receive the group (via the create card).
  for (const p of [b, c]) {
    await p.page.waitForFunction(
      (gid) => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.some((g) => g.id === gid)),
      groupId,
      { timeout: 30_000 },
    );
  }

  // B sends a group message → must reach A and C (C had no prior session with B).
  await b.page.evaluate((gid) => (window as any).__ringTest.sendChatMessage(gid, 'hi from Bob'), groupId);
  for (const p of [a, c]) {
    await expect
      .poll(() => bodies(p, groupId as string), { timeout: 30_000 })
      .toContain('hi from Bob');
  }

  // B leaves → A and C drop B from the roster.
  await b.page.evaluate((gid) => (window as any).__ringTest.leaveGroup(gid), groupId);
  for (const p of [a, c]) {
    await p.page.waitForFunction(
      ([gid, bid]) =>
        (window as any).__ringTest
          .groupChats()
          .then((gs: any[]) => {
            const g = gs.find((x) => x.id === gid);
            return g && !g.members.includes(bid);
          }),
      [groupId, b.id] as const,
      { timeout: 30_000 },
    );
  }

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

async function groupNamed(p: { page: any }, gid: string): Promise<string> {
  return p.page.evaluate(
    (id: string) =>
      (window as any).__ringTest
        .groupChats()
        .then((gs: any[]) => gs.find((g) => g.id === id)?.name ?? ''),
    gid,
  );
}

/**
 * Group with NO custom name: each viewer sees an auto-derived name from the OTHER
 * members ("Bob & Carol" for Alice, "Alice & Carol" for Bob). Then the creator
 * renames it (everyone converges) and removes a member (who drops the group).
 */
test('group: auto-derived name, rename, and remove member', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();

  const a = await createAccount(ctxA, 'RINGTST4');
  const b = await createAccount(ctxB, 'RINGTST5');
  const c = await createAccount(ctxC, 'RINGTST6');
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');
  await setProfile(c, 'Carol');
  await pair(a, b);
  await pair(a, c);

  // The creator knows their contacts' names locally - the auto-derived group name
  // is built from these. (Recipients then derive their own view from the card.)
  await a.page.evaluate((args) => (window as any).__ringTest.setContactName(args[0], args[1]), [b.id, 'Bob']);
  await a.page.evaluate((args) => (window as any).__ringTest.setContactName(args[0], args[1]), [c.id, 'Carol']);

  // Create with an empty name → auto-derived from members.
  const gid = await a.page.evaluate(
    (ids) => (window as any).__ringTest.createGroup('', ids),
    [b.id, c.id],
  );
  expect(gid).toBeTruthy();

  // Alice sees "Bob & Carol"; Bob sees "Alice & Carol" (derived per-viewer).
  await expect.poll(() => groupNamed(a, gid as string), { timeout: 10_000 }).toBe('Bob & Carol');
  await expect.poll(() => groupNamed(b, gid as string), { timeout: 30_000 }).toBe('Alice & Carol');

  // Alice renames → everyone converges on the custom name.
  await a.page.evaluate((id) => (window as any).__ringTest.renameGroup(id, 'Squad'), gid);
  for (const p of [a, b, c]) {
    await expect.poll(() => groupNamed(p, gid as string), { timeout: 30_000 }).toBe('Squad');
  }

  // Alice removes Carol → Carol drops the group; Alice/Bob lose her from the roster.
  await a.page.evaluate((args) => (window as any).__ringTest.removeMember(args[0], args[1]), [gid, c.id]);
  await c.page.waitForFunction(
    (id) => (window as any).__ringTest.groupChats().then((gs: any[]) => !gs.some((g) => g.id === id)),
    gid,
    { timeout: 30_000 },
  );
  for (const p of [a, b]) {
    await p.page.waitForFunction(
      ([id, cid]) =>
        (window as any).__ringTest.groupChats().then((gs: any[]) => {
          const g = gs.find((x) => x.id === id);
          return g && !g.members.includes(cid);
        }),
      [gid, c.id] as const,
      { timeout: 30_000 },
    );
  }

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
