import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
const setProfile = (p: any, name: string) =>
  p.page.evaluate(([n, av]: [string, string]) => (window as any).__ringTest.setProfile(n, av), [name, AVATAR]);
const react = (p: any, messageId: string, emoji: string) =>
  p.page.evaluate((args: [string, string]) => (window as any).__ringTest.reactToMessage(args[0], args[1]), [messageId, emoji]);
const banners = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.notices().map((n: any) => n.body));
const bannerSeen = (p: any, text: string) =>
  p.page.waitForFunction(
    (t: string) => (window as any).__ringTest.notices().some((n: any) => String(n.body).includes(t)),
    text,
    { timeout: 30_000 },
  );
const settleDone = (p: any) =>
  p.page.waitForFunction(() => (window as any).__ringTest.settleMsLeft() === 0, undefined, { timeout: 30_000 });
const emojisOn = (p: any, id: string): Promise<string[]> =>
  p.page.evaluate((m: string) => (window as any).__ringTest.getReactions(m).then((rs: any[]) => rs.map((r: any) => r.emoji)), id);

/**
 * Spec 1050 (US2): group reaction fan-out — the author hears about a reaction,
 * a bystander does not (their copy syncs silently), and a prior co-reactor
 * hears about LATER reactions with "also reacted" wording. Spec 1050 (US3):
 * creating a group is silent for its members; the first message announces it.
 */
test('group fan-out: author + co-reactors loud, bystanders silent; creation is quiet', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'ROUTE1');
  const b = await createAccount(ctxB, 'ROUTE2');
  const c = await createAccount(ctxC, 'ROUTE3');
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');
  await setProfile(c, 'Carol');
  await pair(a, b);
  await pair(a, c);
  console.log('[ids]', JSON.stringify({ a: a.id, b: b.id, c: c.id }));
  for (const p of [a, b, c]) await settleDone(p);

  // --- US3: creation is quiet ---
  const bBannersBefore = await banners(b);
  const gid = await a.page.evaluate((ids) => (window as any).__ringTest.createGroup('Routing crew', ids), [b.id, c.id]);
  for (const p of [b, c]) {
    await p.page.waitForFunction(
      (g) => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.some((x: any) => x.id === g)),
      gid,
      { timeout: 30_000 },
    );
  }
  // The group arrived in the chat list with NO banner for either member.
  await b.page.waitForTimeout(1500);
  expect(await banners(b)).toEqual(bBannersBefore);
  expect(await banners(c)).toEqual([]);

  // The FIRST message announces the group normally.
  const first = bannerSeen(b, 'hello crew');
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'hello crew'), gid);
  await first;

  // Session warm-up, SERIALIZED: two fresh members initiating X3DH to each other
  // simultaneously forks the session (both act as initiator) — so B speaks first
  // and C replies only after B's frame landed everywhere (e2e lesson, spec 1048/1050).
  await b.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'bob here'), gid);
  for (const p of [a, c]) {
    await p.page.waitForFunction(
      (id) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.some((m: any) => m.body === 'bob here')),
      gid,
      { timeout: 30_000 },
    );
  }
  await c.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'carol here'), gid);
  const msgId = (await a.page
    .waitForFunction(
      (id) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.find((m) => m.body === 'hello crew')?.id),
      gid,
      { timeout: 30_000 },
    )
    .then((h) => h.jsonValue())) as string;
  for (const p of [a, b]) {
    await p.page.waitForFunction(
      (id) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.some((m: any) => m.body === 'carol here')),
      gid,
      { timeout: 30_000 },
    );
  }
  // KNOWN BUG DODGE (filed as spec 2033): on a fresh carrier session, a SECOND
  // consecutive frame to a member who never wrote back is undecryptable (the
  // pre-1050 client fails identically — see the spec's repro notes). Bob
  // interjecting resets every sender's chain so the reactions below ride the
  // proven send-after-receive path. Remove once 2033 lands.
  await b.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'ok'), gid);
  for (const p of [a, c]) {
    await p.page.waitForFunction(
      (id) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.some((m: any) => m.body === 'ok')),
      gid,
      { timeout: 30_000 },
    );
  }

  // Let the message banners clear so the reaction assertions start clean.
  for (const p of [a, b, c]) {
    await p.page.waitForFunction(() => (window as any).__ringTest.notices().length === 0, undefined, { timeout: 30_000 });
  }

  // --- US2 first reaction: C reacts to ALICE's message ---
  const aliceHears = bannerSeen(a, 'Carol reacted 🔥 to: hello crew');
  await react(c, msgId, '🔥');
  await aliceHears;
  // Bob is a bystander: his copy converged, but NO banner showed.
  await expect.poll(() => emojisOn(b, msgId), { timeout: 30_000 }).toContain('🔥');
  expect(await banners(b)).toEqual([]);

  // --- US2 second reaction: B reacts to the same message ---
  // Author (Alice) AND prior co-reactor (Carol, "also reacted") both hear it.
  const aliceAgain = bannerSeen(a, 'Bob reacted 👍 to: hello crew');
  const carolAlso = bannerSeen(c, 'Bob also reacted 👍 to: hello crew');
  await react(b, msgId, '👍');
  await aliceAgain;
  await carolAlso;

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
