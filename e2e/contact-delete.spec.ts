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
