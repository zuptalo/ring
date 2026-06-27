import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const hasContact = (p: { page: any }, id: string): Promise<boolean> =>
  p.page.evaluate((cid: string) => (window as any).__ringTest.contactIds().then((ids: string[]) => ids.includes(cid)), id);
const chatWith = (p: { page: any }, id: string): Promise<string> =>
  p.page.evaluate((cid: string) => (window as any).__ringTest.chatWith(cid), id);

/**
 * Deleting a contact (spec: "delete a user"). Removing a contact must drop both the
 * contact record AND its 1:1 conversation on this device. The Contacts-list swipe and
 * the contact page's "Delete contact" both call deleteContact under the hood; this pins
 * that core behavior deterministically (the UI affordance is covered by drive scenarios).
 */
test('delete contact: removes the contact and its 1:1 chat', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGTST1');
  const b = await createAccount(ctxB, 'RINGTST2');
  await pair(a, b);

  // A has B as a contact, with a 1:1 chat (a sent message guarantees the chat exists).
  const chatId = await a.page.evaluate((bid) => (window as any).__ringTest.startChat(bid), b.id);
  await a.page.evaluate((cid) => (window as any).__ringTest.sendChatMessage(cid, 'hi'), chatId);
  expect(await hasContact(a, b.id)).toBe(true);
  expect(await chatWith(a, b.id)).toBeTruthy();

  // Delete B.
  await a.page.evaluate((bid) => (window as any).__ringTest.deleteContact(bid), b.id);

  // The contact AND the conversation are gone on A's device.
  await a.page.waitForFunction(
    (bid) => (window as any).__ringTest.contactIds().then((ids: string[]) => !ids.includes(bid)),
    b.id,
    { timeout: 15_000 },
  );
  expect(await hasContact(a, b.id)).toBe(false);
  expect(await chatWith(a, b.id)).toBe('');

  await ctxA.close();
  await ctxB.close();
});

/**
 * Deletion must STICK. The directory mirror (`syncDirectory`) re-creates every
 * in-network member as a local contact on each connect; before the tombstone guard
 * it would silently resurrect anyone you deleted on the very next sync. This pins
 * that a deleted contact stays gone across a full directory sync.
 */
test('delete contact: stays gone after a directory sync (no resurrection)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGTST3');
  const b = await createAccount(ctxB, 'RINGTST4');
  await pair(a, b);
  expect(await hasContact(a, b.id)).toBe(true);

  await a.page.evaluate((bid) => (window as any).__ringTest.deleteContact(bid), b.id);
  await a.page.waitForFunction(
    (bid) => (window as any).__ringTest.contactIds().then((ids: string[]) => !ids.includes(bid)),
    b.id,
    { timeout: 15_000 },
  );

  // The resurrection path: pull the whole directory back into contacts.
  await a.page.evaluate(() => (window as any).__ringTest.syncDirectory());
  await a.page.waitForTimeout(500);
  expect(await hasContact(a, b.id)).toBe(false); // tombstone kept B out

  await ctxA.close();
  await ctxB.close();
});

/**
 * Re-adding a previously-deleted friend must NOT send a fresh friend request: the
 * server connection from the original friendship is never torn down by a delete, so
 * re-adding short-circuits to 'accepted' and just restores the contact locally (the
 * tombstone is lifted). This is the "you shouldn't have to ask again" behavior.
 */
test('re-add a deleted friend: restored with no new connection request', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGTST5');
  const b = await createAccount(ctxB, 'RINGTST6');
  await pair(a, b);

  await a.page.evaluate((bid) => (window as any).__ringTest.deleteContact(bid), b.id);
  await a.page.waitForFunction(
    (bid) => (window as any).__ringTest.contactIds().then((ids: string[]) => !ids.includes(bid)),
    b.id,
    { timeout: 15_000 },
  );

  // Re-add via the same call the Directory "Request Friendship" action makes.
  const state = await a.page.evaluate((bid) => (window as any).__ringTest.connectRequest(bid), b.id);
  expect(state).toBe('accepted'); // already connected → no fresh request

  // B is a contact again...
  await a.page.waitForFunction(
    (bid) => (window as any).__ringTest.contactIds().then((ids: string[]) => ids.includes(bid)),
    b.id,
    { timeout: 15_000 },
  );
  expect(await hasContact(a, b.id)).toBe(true);

  // ...and there is NO outgoing pending request to B (it was an instant re-add).
  const conns = await a.page.evaluate(() => (window as any).__ringTest.connections());
  const pendingToB = (conns.outgoing ?? []).some((r: any) => r.target === b.id && r.state === 'pending');
  expect(pendingToB).toBe(false);

  await ctxA.close();
  await ctxB.close();
});
