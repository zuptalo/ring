import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const contactIds = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.contactIds());

/**
 * Contacts are CURATED: registering does NOT auto-add the whole directory. A
 * contact appears only when you interact with or explicitly save someone.
 */
test('curated contacts: no auto-add; saving from the directory adds just that person', async ({ browser }) => {
  const a = await createAccount(await browser.newContext(), 'CURATED1');
  const b = await createAccount(await browser.newContext(), 'CURATED2');

  // Neither has the other as a contact yet (no bulk directory sync).
  await a.page.waitForTimeout(500);
  expect(await contactIds(a)).not.toContain(b.id);
  expect(await contactIds(b)).not.toContain(a.id);

  // A explicitly saves B from the directory → B (and only B) becomes A's contact.
  await a.page.evaluate((id) => (window as any).__ringTest.importDirectoryUser(id), b.id);
  await expect.poll(() => contactIds(a)).toContain(b.id);
  expect((await contactIds(a)).length).toBe(1);

  // B still has no contacts (saving is one-directional locally).
  expect(await contactIds(b)).not.toContain(a.id);
});
