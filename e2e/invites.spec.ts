import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Invitation auto-connect: A creates a labelled invite code; B registers with it;
 * both become each other's contacts automatically (no manual Accept tap).
 */
test('an invite code auto-connects inviter and invitee', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
  const a = await createAccount(ctxA, 'RINGDEV8');
  await a.page.evaluate((av) => (window as any).__ringTest.setProfile('Alice', av), AVATAR);

  // A mints a labelled invite code.
  const code = await a.page.evaluate(() => (window as any).__ringTest.createInvite('Mom'));
  expect(code).toBeTruthy();

  // B registers using A's invite code (not a dev code) and sets up a profile
  // (required before the invitee auto-connects - otherwise they'd appear as
  // "You" with no image).
  const b = await createAccount(ctxB, code as string);
  await b.page.evaluate((av) => (window as any).__ringTest.setProfile('Bob', av), AVATAR);

  // Prod polls on a timer; force the sweep on both sides for the test.
  await b.page.evaluate(() => (window as any).__ringTest.syncInvites());
  await a.page.evaluate(() => (window as any).__ringTest.syncInvites());

  // Both end up as each other's contacts, with no manual accept.
  await a.page.waitForFunction(
    (bid) => (window as any).__ringTest.contactIds().then((ids: string[]) => ids.includes(bid)),
    b.id,
    { timeout: 30_000 },
  );
  await b.page.waitForFunction(
    (aid) => (window as any).__ringTest.contactIds().then((ids: string[]) => ids.includes(aid)),
    a.id,
    { timeout: 30_000 },
  );

  // And the real profiles propagated - not "You" / blank.
  await expect
    .poll(() => a.page.evaluate((bid) => (window as any).__ringTest.contactName(bid), b.id))
    .toBe('Bob');
  await expect
    .poll(() => b.page.evaluate((aid) => (window as any).__ringTest.contactName(aid), a.id))
    .toBe('Alice');

  await ctxA.close();
  await ctxB.close();
});
