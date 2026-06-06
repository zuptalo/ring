import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const online = (p: any, id: string): Promise<boolean | null> =>
  p.page.evaluate((i: string) => (window as any).__ringTest.peerOnline(i), id);

/**
 * Server-enforced presence tier: a user who sets online = 'contacts' is visible
 * to someone who has added them (a contact edge), and hidden from a stranger
 * browsing the directory.
 */
test('presence tier: contacts-only visible to a contact, hidden from a stranger', async ({ browser }) => {
  test.setTimeout(60_000);
  const a = await createAccount(await browser.newContext(), 'PRESTIR1');
  const b = await createAccount(await browser.newContext(), 'PRESTIR2');
  const c = await createAccount(await browser.newContext(), 'PRESTIR3');

  // A adds B and pushes the contact edge to the server (A is now in B's audience).
  await a.page.evaluate((id) => (window as any).__ringTest.importDirectoryUser(id), b.id);
  await a.page.evaluate(() => (window as any).__ringTest.syncContactEdges());

  // B restricts presence to contacts; let the prefs upload.
  await b.page.evaluate(() => (window as any).__ringTest.setSetting('privacy.online', 'contacts'));
  await b.page.evaluate(() => (window as any).__ringTest.setSetting('privacy.lastSeen', 'contacts'));
  await b.page.waitForTimeout(1200);

  // A (B's contact) subscribes and sees B online.
  await a.page.evaluate((id) => (window as any).__ringTest.subscribePresence([id]), b.id);
  await expect.poll(() => online(a, b.id), { timeout: 25_000 }).toBe(true);

  // C (no relationship) browses/subscribes and does NOT see B's presence.
  await c.page.evaluate((id) => (window as any).__ringTest.subscribePresence([id]), b.id);
  await c.page.waitForTimeout(2500);
  expect(await online(c, b.id)).not.toBe(true);
});
