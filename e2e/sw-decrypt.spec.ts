import { test, expect } from '@playwright/test';
import { createAccount, pair, previewFull } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const bodies = (p: any, chatId: string): Promise<string[]> =>
  p.page.evaluate((id: string) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.map((m) => m.body)), chatId);

/**
 * Service-worker background decryption (Choice A): while B is "offline" (no WS),
 * A's message queues on the relay. B's read-only preview decrypts it for a rich
 * notification WITHOUT persisting it; only after reconnecting does B drain + store
 * it for real. Proves: rich preview content from the queued ciphertext, and that
 * the preview path never advances/persists the ratchet.
 */
test('sw background decrypt: queued message previews (rich), persists only on reconnect', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SWDECR01');
  const b = await createAccount(ctxB, 'SWDECR02');
  await a.page.evaluate(([n, av]) => (window as any).__ringTest.setProfile(n, av), ['Alice', 'data:image/svg+xml,<svg/>']);
  await pair(a, b);

  // B goes offline (drops its WebSocket) → the relay will queue messages for it.
  await b.page.evaluate(() => (window as any).__ringTest.disconnect());
  await b.page.waitForTimeout(800);

  // A sends a message; with B offline it lands in the relay queue.
  const aChat = (await a.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'ping while away'), aChat);

  // B's service-worker preview path decrypts the queued frame read-only → a rich
  // notification body with the sender + text.
  await expect
    .poll(
      () => b.page.evaluate(() => (window as any).__ringTest.previewPending().then((ns: any[]) => ns.map((n) => n.body))),
      { timeout: 30_000 },
    )
    .toContain('ping while away');

  // Read-only: B has NOT persisted the message yet (no chat row written for it).
  const bChat = (await b.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), a.id)) as string;
  if (bChat) expect(await bodies(b, bChat)).not.toContain('ping while away');

  // Reconnect → B drains the relay over the WebSocket and stores it for real.
  await b.page.evaluate(() => (window as any).__ringTest.reconnect());
  await expect
    .poll(
      async () => {
        const c = (await b.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), a.id)) as string;
        return c ? bodies(b, c) : [];
      },
      { timeout: 30_000 },
    )
    .toContain('ping while away');

  await ctxA.close();
  await ctxB.close();
});

/**
 * Spec 1015 (US1 / FR-002, FR-003, FR-005): the SW preview must be COMPLETE (full
 * decrypted text, every queued message) and READ-ONLY (previewing must not advance
 * the ratchet, so it can be repeated and the page still decrypts the same frames on
 * reconnect — nothing is consumed or dropped).
 */
test('sw preview: complete + read-only (repeatable previews; page still decrypts on reconnect)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SWDECR03');
  const b = await createAccount(ctxB, 'SWDECR04');
  await a.page.evaluate(([n, av]) => (window as any).__ringTest.setProfile(n, av), ['Alice', 'data:image/svg+xml,<svg/>']);
  await pair(a, b);

  // B goes offline → A's messages queue on the relay.
  await b.page.evaluate(() => (window as any).__ringTest.disconnect());
  await b.page.waitForTimeout(800);

  const aChat = (await a.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'first away msg'), aChat);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'second away msg'), aChat);

  const previewBodies = () =>
    b.page.evaluate(() => (window as any).__ringTest.previewPending().then((ns: any[]) => ns.map((n) => n.body).join(' | ')));

  // COMPLETE: the read-only preview decrypts BOTH queued messages with full text
  // (the latest body shows; the merged note covers both frames).
  await expect.poll(previewBodies, { timeout: 30_000 }).toContain('second away msg');

  // READ-ONLY / REPEATABLE: previewing again still yields the full text — the
  // preview did not advance/consume the ratchet (if it had, the second decrypt
  // would fail). FR-003.
  await expect.poll(previewBodies, { timeout: 30_000 }).toContain('second away msg');

  // FR-005 reliability: the frames were never acked/dropped by the preview, so on
  // reconnect the page drains + persists BOTH messages with their full text.
  await b.page.evaluate(() => (window as any).__ringTest.reconnect());
  await expect
    .poll(
      async () => {
        const c = (await b.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), a.id)) as string;
        return c ? bodies(b, c) : [];
      },
      { timeout: 30_000 },
    )
    .toEqual(expect.arrayContaining(['first away msg', 'second away msg']));

  await ctxA.close();
  await ctxB.close();
});

/**
 * Spec 1015 (US5 / FR-022 / FR-024): for a "badge only" (content=none) chat, the
 * CLOSED-app service worker shows NO notification — not even the generic "New
 * message" placeholder — while still counting the message for the badge. Verified
 * via the full background-preview result: `silenced` true (→ sw.ts skips the
 * placeholder), `notes` empty, `pending` still counts it. A control switch back to
 * full content proves the same frame would otherwise show.
 */
test('sw closed-app: badge-only suppresses even the generic placeholder, still badges', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SWBADGE1');
  const b = await createAccount(ctxB, 'SWBADGE2');
  await a.page.evaluate(([n, av]) => (window as any).__ringTest.setProfile(n, av), ['Alice', 'data:image/svg+xml,<svg/>']);
  await pair(a, b);

  const aChat = (await a.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), b.id)) as string;

  // Establish B's chat with A (so per-chat prefs can target it): a warmup while B is
  // online, which B receives + acks.
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'warmup'), aChat);
  const bChatOf = () => b.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), a.id);
  await expect.poll(bChatOf, { timeout: 30_000 }).toBeTruthy();
  const bChat = (await bChatOf()) as string;

  // Mark the chat badge-only.
  await b.page.evaluate((id: string) => (window as any).__ringTest.setChatNotify(id, { content: 'none' }), bChat);

  // B goes offline; A sends → the message queues on the relay.
  await b.page.evaluate(() => (window as any).__ringTest.disconnect());
  await b.page.waitForTimeout(600);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'silent ping'), aChat);

  await expect.poll(async () => (await previewFull(b)).pending, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  // Badge-only: no notes, and `silenced` (so the SW shows no generic placeholder),
  // but NOT `suppressed` (the badge still counts it).
  const res = (await previewFull(b)) as any;
  expect(res.notes.length).toBe(0);
  expect(res.silenced).toBe(true);
  expect(res.suppressed).toBe(false);
  expect(res.pending).toBeGreaterThanOrEqual(1);

  // Control: switch the same chat to full content → the still-queued frame now yields
  // a rich note and is no longer silenced (it WOULD show when closed).
  await b.page.evaluate((id: string) => (window as any).__ringTest.setChatNotify(id, { content: 'full' }), bChat);
  await expect.poll(async () => (await previewFull(b)).notes.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  const res2 = (await previewFull(b)) as any;
  expect(res2.silenced).toBe(false);
  expect(res2.notes.map((n: any) => n.body)).toContain('silent ping');

  await ctxA.close();
  await ctxB.close();
});
