import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ev = (p: any, fn: (a: any) => any, arg: any) => p.page.evaluate(fn, arg);
const mainIds = (p: any): Promise<string[]> => ev(p, () => (window as any).__ringTest.chatOrder(), null);
const archivedIds = (p: any): Promise<string[]> => ev(p, () => (window as any).__ringTest.archivedChatIds(), null);
const chatWith = (p: any, id: string): Promise<string> => ev(p, (x) => (window as any).__ringTest.chatWith(x), id);
const bodies = (p: any, cid: string): Promise<string[]> =>
  ev(p, async (id) => (await (window as any).__ringTest.messages(id)).map((m: any) => m.body), cid);

/**
 * Archiving moves a chat out of the main list into "Archived". A new inbound message
 * pulls it back UNLESS "Keep chats archived" (chats.keepArchived) is on.
 */
test('archive: a new message un-archives by default; Keep Archived holds it', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ARCH1');
  const b = await createAccount(ctxB, 'ARCH2');
  await pair(a, b);
  const aChat = (await chatWith(a, b.id)) as string;
  const bChat = (await chatWith(b, a.id)) as string;

  // Archive → leaves the main list, enters Archived.
  await ev(a, (id) => (window as any).__ringTest.archiveChat(id, true), aChat);
  await expect.poll(() => archivedIds(a)).toContain(aChat);
  expect(await mainIds(a)).not.toContain(aChat);

  // Default (keepArchived off): B's message brings the chat back to the main list.
  await ev(b, (id) => (window as any).__ringTest.sendChatMessage(id, 'ping1'), bChat);
  await expect.poll(() => mainIds(a), { timeout: 30_000 }).toContain(aChat);
  expect(await archivedIds(a)).not.toContain(aChat);

  // Re-archive and turn Keep Archived ON: B's next message arrives but must NOT un-archive.
  await ev(a, (id) => (window as any).__ringTest.archiveChat(id, true), aChat);
  await ev(a, () => (window as any).__ringTest.setSetting('chats.keepArchived', true), null);
  await ev(b, (id) => (window as any).__ringTest.sendChatMessage(id, 'ping2'), bChat);
  // Confirm the message really landed (so the assertion isn't vacuous)...
  await expect.poll(() => bodies(a, aChat), { timeout: 30_000 }).toContain('ping2');
  // ...yet the chat stayed archived.
  expect(await archivedIds(a)).toContain(aChat);
  expect(await mainIds(a)).not.toContain(aChat);

  await ctxA.close();
  await ctxB.close();
});

/**
 * "Archive all chats" sweeps every main-list chat into Archived in one go.
 */
test('archive all: moves every main-list chat into Archived', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ARCH3');
  const b = await createAccount(ctxB, 'ARCH4');
  await pair(a, b);
  expect((await mainIds(a)).length).toBeGreaterThan(0);

  const n = await ev(a, () => (window as any).__ringTest.archiveAllChats(), null);
  expect(n).toBeGreaterThan(0);
  expect(await mainIds(a)).toHaveLength(0);
  expect((await archivedIds(a)).length).toBe(n);

  await ctxA.close();
  await ctxB.close();
});
