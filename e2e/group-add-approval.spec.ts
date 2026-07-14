import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ev = (p: any, fn: (a: any) => any, arg?: any) => p.page.evaluate(fn, arg);
const groupIds = (p: any): Promise<string[]> =>
  ev(p, () => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.map((g: any) => g.id)));
const inviteIds = (p: any): Promise<string[]> => ev(p, () => (window as any).__ringTest.groupInviteIds());

/**
 * Spec 1052: "Ask before adding me to groups" — a friend's auto-add converts to
 * the invitation flow; pre-accept traffic parks and replays on acceptance
 * (FR-002/FR-006, SC-001/SC-003); declining leaves the adder's roster (FR-004).
 */
test('approval toggle: adds arrive as invitations; parked messages replay on accept; decline leaves', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'GADD01');
  const b = await createAccount(ctxB, 'GADD02');
  await pair(a, b);
  await ev(b, () => (window as any).__ringTest.setGlobalSetting('privacy.groupAddApproval', true));

  // A creates a group containing B → B gets an INVITATION, not a chat.
  const gid = (await ev(a, (ids: string[]) => (window as any).__ringTest.createGroup('Trip', ids), [b.id])) as string;
  await b.page.waitForFunction(
    (g: string) => (window as any).__ringTest.groupInviteIds().then((ids: string[]) => ids.includes(g)),
    gid,
    { timeout: 30_000 },
  );
  expect(await groupIds(b)).not.toContain(gid);

  // A chats before B decides — B still has no chat (the frame parks).
  await ev(a, ([g, t]: [string, string]) => (window as any).__ringTest.sendChatMessage(g, t), [gid, 'planning already']);
  await b.page.waitForTimeout(2500);
  expect(await groupIds(b)).not.toContain(gid);

  // Accept → the chat exists AND the parked message is in it.
  await ev(b, (g: string) => (window as any).__ringTest.acceptGroupInvite(g), gid);
  await b.page.waitForFunction(
    (g: string) => (window as any).__ringTest.messages(g).then((ms: any[]) => ms.some((m: any) => m.body === 'planning already')),
    gid,
    { timeout: 30_000 },
  );

  // Round 2: decline → A's roster drops B (the decline also carries a leave).
  const gid2 = (await ev(a, (ids: string[]) => (window as any).__ringTest.createGroup('Trip 2', ids), [b.id])) as string;
  await b.page.waitForFunction(
    (g: string) => (window as any).__ringTest.groupInviteIds().then((ids: string[]) => ids.includes(g)),
    gid2,
    { timeout: 30_000 },
  );
  await ev(b, (g: string) => (window as any).__ringTest.declineGroupInvite(g), gid2);
  await a.page.waitForFunction(
    ([g, uid]: [string, string]) =>
      (window as any).__ringTest.groupChats().then((gs: any[]) => {
        const grp = gs.find((x: any) => x.id === g);
        return !!grp && !grp.members.includes(uid);
      }),
    [gid2, b.id] as [string, string],
    { timeout: 30_000 },
  );
  expect(await groupIds(b)).not.toContain(gid2);

  await ctxA.close();
  await ctxB.close();
});

/**
 * Spec 1052 (FR-003, unconditional hardening): a raw auto-join create card from
 * a NON-connected sender — something only a modified client can emit — never
 * materializes a chat; it arrives as an invitation at most (SC-002).
 */
test('hardening: a stranger’s raw create card becomes an invitation, never a chat', async ({ browser }) => {
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const b = await createAccount(ctxB, 'GADD03');
  const c = await createAccount(ctxC, 'GADD04'); // NOT paired with B
  // B keeps the approval toggle OFF — the hardening must not depend on it.

  const gid = (await ev(c, () => crypto.randomUUID())) as string;
  await ev(c, ([to, g]: [string, string]) => (window as any).__ringTest.devSendRawGroupCreate(to, g, 'Intruders'), [b.id, gid]);

  await b.page.waitForFunction(
    (g: string) => (window as any).__ringTest.groupInviteIds().then((ids: string[]) => ids.includes(g)),
    gid,
    { timeout: 30_000 },
  );
  expect(await groupIds(b)).not.toContain(gid);

  // Declined → nothing remains.
  await ev(b, (g: string) => (window as any).__ringTest.declineGroupInvite(g), gid);
  await b.page.waitForFunction(
    (g: string) => (window as any).__ringTest.groupInviteIds().then((ids: string[]) => !ids.includes(g)),
    gid,
    { timeout: 30_000 },
  );
  expect(await groupIds(b)).not.toContain(gid);

  await ctxB.close();
  await ctxC.close();
});
