import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

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
