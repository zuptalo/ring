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
 * Public in-network directory: two accounts that have NEVER exchanged a friend
 * request still discover each other (with their display name) and can message
 * straight away - the friend-gate is gone; Block is the only barrier.
 */
test('directory: members are discoverable and chat works with no handshake', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'DIRTST01');
  const b = await createAccount(ctxB, 'DIRTST02');
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');

  // Each account has a permanent username (the testhook derives u_<code>).
  expect(await a.page.evaluate(() => (window as any).__ringTest.selfUsername())).toBe('u_dirtst01');

  // A pulls the directory → B shows up as a contact with their display name, and
  // with NO friend request to accept.
  await syncDir(a);
  await expect.poll(() => contactIds(a).then((ids) => ids.includes(b.id))).toBe(true);
  await expect.poll(() => contactName(a, b.id)).toBe('Bob');

  // A messages B immediately (no handshake). B's open inbox surfaces the chat.
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
