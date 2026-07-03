import { test, expect } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 1032 — the SW AUTHORITATIVE drain (sw.fullPersist): messages received while
 * "closed" (WS dropped) are decrypted, PERSISTED (row + unread + chat preview +
 * ratchet advance, one atomic commit), and ACKED at notification time, so the app
 * opens warm. Deferred/ineligible frames keep today's preview-only behavior and
 * drain on reconnect. Driven through __ringTest.drainPending(), which runs the
 * exact module the push handler runs.
 */

const enableFlag = (c: RingClient) =>
  c.page.evaluate(() => (window as any).__ringTest.setSetting('sw.fullPersist', true));
const drain = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.drainPending());
const previewFullOf = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.previewPendingFull());
const bodiesOf = (c: RingClient, chatId: string): Promise<string[]> =>
  c.page.evaluate((id: string) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.map((m) => m.body)), chatId);
const chatOf = (c: RingClient, peerId: string) =>
  c.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);
const unreadOf = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.unreadBadge());

/** T018 — warm open: rows + unread + empty queue BEFORE reconnect; no duplicates after. */
test('sw persist: queued messages are stored + acked at notification time; reconnect adds nothing', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SWPERS01');
  const b = await createAccount(ctxB, 'SWPERS02');
  await a.page.evaluate(([n, av]) => (window as any).__ringTest.setProfile(n, av), ['Alice', 'data:image/svg+xml,<svg/>']);
  await pair(a, b);
  await enableFlag(b);

  // Warm the pair so B has the chat + session (the drain only applies to existing chats).
  const aChat = (await chatOf(a, b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'warmup'), aChat);
  await expect.poll(() => chatOf(b, a.id), { timeout: 30_000 }).toBeTruthy();
  const bChat = (await chatOf(b, a.id)) as string;
  await b.page.evaluate((id: string) => (window as any).__ringTest.markChatRead(id), bChat);

  // B "closes" (drops the WS) → A's messages queue on the relay.
  await b.page.evaluate(() => (window as any).__ringTest.disconnect());
  await b.page.waitForTimeout(800);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'warm one'), aChat);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'warm two'), aChat);

  // The drain applies both: committed rows + unread BEFORE any reconnect.
  await expect
    .poll(async () => ((await drain(b)) as any).applied, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1);
  await expect.poll(() => bodiesOf(b, bChat), { timeout: 10_000 }).toEqual(expect.arrayContaining(['warm one', 'warm two']));
  expect(await unreadOf(b)).toBe(2);

  // Acked: the relay queue is EMPTY while still offline (the preview finds no frames).
  await expect.poll(async () => ((await previewFullOf(b)) as any).pending, { timeout: 10_000 }).toBe(0);

  // Reconnect → the WS drain finds nothing new: exactly one copy of each, unread unchanged.
  await b.page.evaluate(() => (window as any).__ringTest.reconnect());
  await b.page.waitForTimeout(2500);
  const bodies = await bodiesOf(b, bChat);
  expect(bodies.filter((x) => x === 'warm one').length).toBe(1);
  expect(bodies.filter((x) => x === 'warm two').length).toBe(1);
  expect(await unreadOf(b)).toBe(2);

  await ctxA.close();
  await ctxB.close();
});

/** T024b — drain racing the page's reconnect drain: exactly one row, one unread. */
test('sw persist: drain vs reconnect race stays exactly-once', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SWPERS03');
  const b = await createAccount(ctxB, 'SWPERS04');
  await pair(a, b);
  await enableFlag(b);

  const aChat = (await chatOf(a, b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'warmup'), aChat);
  await expect.poll(() => chatOf(b, a.id), { timeout: 30_000 }).toBeTruthy();
  const bChat = (await chatOf(b, a.id)) as string;
  await b.page.evaluate((id: string) => (window as any).__ringTest.markChatRead(id), bChat);

  await b.page.evaluate(() => (window as any).__ringTest.disconnect());
  await b.page.waitForTimeout(800);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'race message'), aChat);
  // Ensure the frame is queued before racing.
  await expect.poll(async () => ((await previewFullOf(b)) as any).pending, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  // Fire the authoritative drain AND the reconnect drain concurrently.
  await b.page.evaluate(() => {
    const t = (window as any).__ringTest;
    return Promise.all([t.drainPending(), t.reconnect()]);
  });
  await b.page.waitForTimeout(2500);

  const bodies = await bodiesOf(b, bChat);
  expect(bodies.filter((x) => x === 'race message').length).toBe(1);
  expect(await unreadOf(b)).toBe(1);

  await ctxA.close();
  await ctxB.close();
});

/** T024a — deferral: a stranger's first-contact message is NOT applied/acked by the
 *  drain; the page's reconnect applies it exactly once (friend-gate intact). */
test('sw persist: first-contact frames defer to the page drain', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SWPERS05');
  const b = await createAccount(ctxB, 'SWPERS06');
  await enableFlag(b);

  // A and B are NOT paired. B goes offline; A sends a friend request (a card frame —
  // both first-contact AND an ineligible type).
  await b.page.evaluate(() => (window as any).__ringTest.disconnect());
  await b.page.waitForTimeout(800);
  await a.page.evaluate((id: string) => (window as any).__ringTest.requestFriend(id), b.id);

  // The drain defers it: nothing applied, nothing acked, frame still queued.
  await expect
    .poll(
      async () => {
        const r = (await drain(b)) as any;
        return r.mode === 'applied' ? r.deferred : 0;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(1);
  const r = (await drain(b)) as any;
  expect(r.applied).toBe(0);
  expect(r.ackIds ?? []).toEqual([]);

  // Reconnect → the page applies the request for real, exactly once.
  await b.page.evaluate(() => (window as any).__ringTest.reconnect());
  await expect
    .poll(() => b.page.evaluate(() => (window as any).__ringTest.pendingRequestIds()), { timeout: 30_000 })
    .toContain(a.id);

  await ctxA.close();
  await ctxB.close();
});

/** T021 — PIN-locked posture: the drain degrades ('locked'), stores nothing, the
 *  frame stays queued; unlock + reconnect delivers it exactly once. */
test('sw persist: PIN lock → nothing stored, frame stays queued, arrives after unlock', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SWPERS07');
  const b = await createAccount(ctxB, 'SWPERS08');
  await pair(a, b);
  await enableFlag(b);

  const aChat = (await chatOf(a, b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'warmup'), aChat);
  await expect.poll(() => chatOf(b, a.id), { timeout: 30_000 }).toBeTruthy();
  const bChat = (await chatOf(b, a.id)) as string;

  // Enable the passcode lock (removes the device auto-unlock) and lock memory,
  // simulating the closed, PIN-locked device the SW would wake as.
  await b.page.evaluate(() => (window as any).__ringTest.enableLock('2468'));
  await b.page.evaluate(() => (window as any).__ringTest.disconnect());
  await b.page.evaluate(() => (window as any).__ringTest.lockNow());
  await b.page.waitForTimeout(800);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'locked away msg'), aChat);

  // Drain degrades: locked, zero applied, zero acked...
  await expect.poll(async () => ((await drain(b)) as any).reason, { timeout: 30_000 }).toBe('locked');
  // ...nothing stored...
  expect(await bodiesOf(b, bChat)).not.toContain('locked away msg');
  // ...and the frame is still queued server-side (the preview still counts it).
  expect(((await previewFullOf(b)) as any).pending).toBeGreaterThanOrEqual(1);

  // Reload B (locked identities re-unlock via PIN), unlock, reconnect → delivered once.
  await b.page.reload();
  await b.page.waitForFunction(() => !!(window as any).__ringTest);
  await b.page.evaluate((pin: string) => (window as any).__ringTest.disableLock(pin), '2468');
  await b.page.evaluate(() => (window as any).__ringTest.reconnect());
  await expect.poll(() => bodiesOf(b, bChat), { timeout: 30_000 }).toContain('locked away msg');
  const bodies = await bodiesOf(b, bChat);
  expect(bodies.filter((x) => x === 'locked away msg').length).toBe(1);

  await ctxA.close();
  await ctxB.close();
});

/** T024c — flag OFF (the default): the drain refuses; behavior is byte-for-byte
 *  today's (preview-only, nothing stored, nothing acked). */
test('sw persist: flag off → drain degrades and the preview path owns the wake', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SWPERS09');
  const b = await createAccount(ctxB, 'SWPERS10');
  await pair(a, b);
  // NOTE: no enableFlag(b) — default off.

  const aChat = (await chatOf(a, b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'warmup'), aChat);
  await expect.poll(() => chatOf(b, a.id), { timeout: 30_000 }).toBeTruthy();
  const bChat = (await chatOf(b, a.id)) as string;

  await b.page.evaluate(() => (window as any).__ringTest.disconnect());
  await b.page.waitForTimeout(800);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'flag off msg'), aChat);
  await expect.poll(async () => ((await previewFullOf(b)) as any).pending, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  const r = (await drain(b)) as any;
  expect(r.mode).toBe('degrade');
  expect(r.reason).toBe('flag-off');
  expect(await bodiesOf(b, bChat)).not.toContain('flag off msg');
  // Frame untouched: still queued, still previewable (today's Choice A).
  expect(((await previewFullOf(b)) as any).pending).toBeGreaterThanOrEqual(1);

  await b.page.evaluate(() => (window as any).__ringTest.reconnect());
  await expect.poll(() => bodiesOf(b, bChat), { timeout: 30_000 }).toContain('flag off msg');

  await ctxA.close();
  await ctxB.close();
});
