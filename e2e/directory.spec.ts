import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
const setProfile = (p: any, n: string) =>
  p.page.evaluate(([nm, av]: [string, string]) => (window as any).__ringTest.setProfile(nm, av), [n, AVATAR]);
const contactIds = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.contactIds());
const contactName = (p: any, id: string): Promise<string> =>
  p.page.evaluate((i: string) => (window as any).__ringTest.contactName(i), id);
const syncDir = (p: any) => p.page.evaluate(() => (window as any).__ringTest.syncDirectory());
const bundleReady = (p: any, id: string): Promise<boolean> =>
  p.page.evaluate((i: string) => (window as any).__ringTest.peerBundleExists(i), id);
const bodies = (p: any, chatId: string): Promise<string[]> =>
  p.page.evaluate((id: string) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.map((m) => m.body)), chatId);

/**
 * Public in-network directory: two accounts discover each other (with display
 * name) and, after a connect request is accepted, can message. The connect-request
 * gate means a peer's prekey bundle is only fetchable once connected.
 */
test('directory: discover, connect-request + accept, then chat works', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'DIRTST01');
  const b = await createAccount(ctxB, 'DIRTST02');
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');

  // Each account has a permanent username (the testhook derives u_<code>).
  expect(await a.page.evaluate(() => (window as any).__ringTest.selfUsername())).toBe('u_dirtst01');

  // A pulls the directory → B shows up as a contact with their display name.
  await syncDir(a);
  await expect.poll(() => contactIds(a).then((ids) => ids.includes(b.id))).toBe(true);
  await expect.poll(() => contactName(a, b.id)).toBe('Bob');

  // Connect-request gate: A requests, B accepts; only then is B's bundle fetchable.
  await a.page.evaluate((id) => (window as any).__ringTest.connectRequest(id), b.id);
  await b.page.evaluate((id) => (window as any).__ringTest.connectAccept(id), a.id);
  await expect.poll(() => bundleReady(a, b.id)).toBe(true);
  const chat = await a.page.evaluate((id: string) => (window as any).__ringTest.startChat(id), b.id);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'hi bob'), chat);

  await expect
    .poll(
      async () => {
        const c = await b.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), a.id);
        return c ? bodies(b, c) : [];
      },
      { timeout: 30_000 },
    )
    .toContain('hi bob');

  // Directory search matches by @username (leading @ stripped), bare username,
  // and display name.
  const search = (q: string): Promise<string[]> =>
    a.page.evaluate(
      (s: string) => (window as any).__ringTest.searchDirectory(s).then((us: any[]) => us.map((u) => u.username)),
      q,
    );
  expect(await search('@u_dirtst02')).toContain('u_dirtst02');
  expect(await search('u_dirtst02')).toContain('u_dirtst02');
  expect(await search('Bob')).toContain('u_dirtst02'); // by display name

  await ctxA.close();
  await ctxB.close();
});
