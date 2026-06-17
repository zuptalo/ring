/**
 * Group "Seen" receipts (spec 1010): durable, private, and counted.
 *
 * Three real accounts over the pairwise group fan-out. These drive the data layer
 * through window.__ringTest (the same service calls the UI makes), asserting on the
 * sender's per-member receipts roster — the exact source the bubble counter and the
 * message-info lists render from:
 *   - SC-001 counter climb: delivered count then seen count climb to N (=recipients).
 *   - SC-002 durability: a 'seen' reported while the sender is OFFLINE is reconciled
 *     on reconnect (recovered from the server `seen` store), not lost.
 *   - SC-003 reciprocity (emit side): with "Seen receipts" off, the user never
 *     advances anyone's view of their seen state, while the others still see each
 *     other.
 *   - SC-004 info-list partition: every member falls into exactly one of Seen by /
 *     Delivered / Not yet delivered.
 *   - SC-006 1:1 unchanged: a 1:1 message carries no receipts roster (plain tick).
 */
import { test, expect, type Browser } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

async function setProfile(c: RingClient, name: string): Promise<void> {
  await c.page.evaluate(([n, av]: [string, string]) => (window as any).__ringTest.setProfile(n, av), [name, AVATAR]);
}

/** Wait until `c` has the group chat `gid`, then return it. */
async function awaitGroup(c: RingClient, gid: string): Promise<void> {
  await c.page.waitForFunction(
    (id) => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.some((g) => g.id === id)),
    gid,
    { timeout: 30_000 },
  );
}

/** The id of the (first) message with `body` in chat `chatId` on `c`'s device. */
async function msgIdByBody(c: RingClient, chatId: string, body: string): Promise<string> {
  return c.page.evaluate(
    ([cid, b]: [string, string]) =>
      (window as any).__ringTest.messages(cid).then((ms: any[]) => ms.find((m) => m.body === b)?.id ?? ''),
    [chatId, body],
  );
}

interface Receipt { contactId: string; deliveredAt?: number; seenAt?: number }

async function receiptsOf(c: RingClient, messageId: string): Promise<Receipt[]> {
  return c.page.evaluate((id) => (window as any).__ringTest.messageReceipts(id), messageId);
}

const deliveredCount = (recs: Receipt[]) => recs.filter((r) => r.deliveredAt).length;
const seenCount = (recs: Receipt[]) => recs.filter((r) => r.seenAt).length;

async function setupTrio(browser: Browser): Promise<{ a: RingClient; b: RingClient; c: RingClient; gid: string; ctx: any[] }> {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGSEEN1');
  const b = await createAccount(ctxB, 'RINGSEEN2');
  const c = await createAccount(ctxC, 'RINGSEEN3');
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');
  await setProfile(c, 'Carol');
  await pair(a, b);
  await pair(a, c);
  const gid = (await a.page.evaluate(
    (ids) => (window as any).__ringTest.createGroup('Trip', ids),
    [b.id, c.id],
  )) as string;
  await awaitGroup(b, gid);
  await awaitGroup(c, gid);
  return { a, b, c, gid, ctx: [ctxA, ctxB, ctxC] };
}

test('SC-001/SC-004: group counter climbs Delivered X/2 → Seen X/2 → Seen, lists partition all members', async ({ browser }) => {
  const { a, b, c, gid, ctx } = await setupTrio(browser);
  try {
    // Alice sends to the group → her message gets a 2-recipient receipts roster.
    await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'who is in?'), gid);
    const mid = await expect
      .poll(() => msgIdByBody(a, gid, 'who is in?'), { timeout: 30_000 })
      .toBeTruthy()
      .then(() => msgIdByBody(a, gid, 'who is in?'));

    // Delivered climbs to N=2 as B and C's devices receive + ack it.
    await expect.poll(async () => deliveredCount(await receiptsOf(a, mid)), { timeout: 30_000 }).toBe(2);
    // None seen yet (nobody has opened it).
    expect(seenCount(await receiptsOf(a, mid))).toBe(0);

    // Bob sees it → Seen 1/2.
    await b.page.evaluate((id) => (window as any).__ringTest.markSeen(id), gid);
    await expect.poll(async () => seenCount(await receiptsOf(a, mid)), { timeout: 30_000 }).toBe(1);

    // SC-004: at this point every member is in exactly one tier — Bob seen, Carol
    // delivered-not-seen, nobody undelivered (both received).
    const recs = await receiptsOf(a, mid);
    const seen = recs.filter((r) => r.seenAt).map((r) => r.contactId);
    const deliveredOnly = recs.filter((r) => r.deliveredAt && !r.seenAt).map((r) => r.contactId);
    const notDelivered = [b.id, c.id].filter((id) => !recs.some((r) => r.contactId === id && r.deliveredAt));
    expect(seen).toEqual([b.id]);
    expect(deliveredOnly).toEqual([c.id]);
    expect(notDelivered).toEqual([]);
    // Every member accounted for exactly once.
    expect([...seen, ...deliveredOnly, ...notDelivered].sort()).toEqual([b.id, c.id].sort());

    // Carol sees it too → Seen 2/2 → the message settles to fully seen.
    await c.page.evaluate((id) => (window as any).__ringTest.markSeen(id), gid);
    await expect.poll(async () => seenCount(await receiptsOf(a, mid)), { timeout: 30_000 }).toBe(2);
    await expect
      .poll(() => a.page.evaluate(
        ([cid, m]: [string, string]) =>
          (window as any).__ringTest.messages(cid).then((ms: any[]) => ms.find((x) => x.id === m)?.status),
        [gid, mid] as [string, string],
      ), { timeout: 30_000 })
      .toBe('seen');
  } finally {
    for (const cx of ctx) await cx.close();
  }
});

test('SC-002: a member seen while the sender is offline is reconciled on reconnect', async ({ browser }) => {
  const { a, b, c, gid, ctx } = await setupTrio(browser);
  try {
    await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'roll call'), gid);
    const mid = await expect
      .poll(() => msgIdByBody(a, gid, 'roll call'), { timeout: 30_000 })
      .toBeTruthy()
      .then(() => msgIdByBody(a, gid, 'roll call'));
    await expect.poll(async () => deliveredCount(await receiptsOf(a, mid)), { timeout: 30_000 }).toBe(2);

    // Alice goes offline; Bob sees the message → his live 'seen' can't reach Alice.
    await a.page.evaluate(() => (window as any).__ringTest.disconnect());
    await b.page.evaluate((id) => (window as any).__ringTest.markSeen(id), gid);
    await b.page.waitForTimeout(500);
    // Still not reflected on Alice while she's offline.
    expect(seenCount(await receiptsOf(a, mid))).toBe(0);

    // Alice reconnects → reconcileSeen recovers Bob's seen from the durable store.
    await a.page.evaluate(() => (window as any).__ringTest.reconnect());
    await expect.poll(async () => seenCount(await receiptsOf(a, mid)), { timeout: 30_000 }).toBe(1);
    expect((await receiptsOf(a, mid)).find((r) => r.contactId === b.id)?.seenAt).toBeTruthy();
  } finally {
    for (const cx of ctx) await cx.close();
  }
});

test('SC-003: with "Seen receipts" off, the user never advances anyone’s view of their seen', async ({ browser }) => {
  const { a, b, c, gid, ctx } = await setupTrio(browser);
  try {
    // Alice turns OFF seen receipts (emit gate).
    await a.page.evaluate(() => (window as any).__ringTest.setSetting('privacy.seenReceipts', false));
    await a.page.evaluate(() => (window as any).__ringTest.applySeenPref());

    // Bob sends to the group; everyone receives it.
    await b.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'snacks?'), gid);
    const midOnB = await expect
      .poll(() => msgIdByBody(b, gid, 'snacks?'), { timeout: 30_000 })
      .toBeTruthy()
      .then(() => msgIdByBody(b, gid, 'snacks?'));
    await expect.poll(async () => deliveredCount(await receiptsOf(b, midOnB)), { timeout: 30_000 }).toBe(2);

    // Alice (off) and Carol (on) both open it.
    await a.page.evaluate((id) => (window as any).__ringTest.markSeen(id), gid);
    await c.page.evaluate((id) => (window as any).__ringTest.markSeen(id), gid);

    // Bob eventually sees Carol as seen, but NEVER Alice (her client sent nothing).
    await expect
      .poll(async () => (await receiptsOf(b, midOnB)).find((r) => r.contactId === c.id)?.seenAt ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await b.page.waitForTimeout(500); // give any stray receipt time to (not) arrive
    expect((await receiptsOf(b, midOnB)).find((r) => r.contactId === a.id)?.seenAt ?? null).toBeNull();
  } finally {
    for (const cx of ctx) await cx.close();
  }
});

test('SC-006: a 1:1 message carries no group receipts roster (plain tick, no fraction)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const a = await createAccount(ctxA, 'RINGSEEN4');
    const b = await createAccount(ctxB, 'RINGSEEN5');
    await setProfile(a, 'Alice');
    await setProfile(b, 'Bob');
    await pair(a, b);
    const chatId = (await a.page.evaluate((peer) => (window as any).__ringTest.chatWith(peer), b.id)) as string;
    await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'hey'), chatId);
    const mid = await expect
      .poll(() => msgIdByBody(a, chatId, 'hey'), { timeout: 30_000 })
      .toBeTruthy()
      .then(() => msgIdByBody(a, chatId, 'hey'));
    // A 1:1 message has no per-member roster (it's the scalar-status path).
    expect(await receiptsOf(a, mid)).toEqual([]);
    // Bob opens it → it advances to plain 'seen' (no fraction is ever derived). B's own
    // 1:1 chat id differs from A's (per-device), so resolve it on B's side, and wait
    // until B has actually received the message before marking it seen.
    const bChat = (await b.page.evaluate((peer) => (window as any).__ringTest.chatWith(peer), a.id)) as string;
    await expect.poll(() => msgIdByBody(b, bChat, 'hey'), { timeout: 30_000 }).toBeTruthy();
    await b.page.evaluate((id) => (window as any).__ringTest.markSeen(id), bChat);
    await expect
      .poll(() => a.page.evaluate(
        ([cid, m]: [string, string]) =>
          (window as any).__ringTest.messages(cid).then((ms: any[]) => ms.find((x) => x.id === m)?.status),
        [chatId, mid] as [string, string],
      ), { timeout: 30_000 })
      .toBe('seen');
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
