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
  // This test IS the invite-redemption path, so the specific code must be used:
  // never fall back to a minted code (that would mask a real redemption failure).
  // The code is freshly minted by A each attempt, so it is already retry-safe.
  const b = await createAccount(ctxB, code as string, { mintOnConsumed: false });
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

/**
 * The inviter is notified "X joined Ring" only AFTER the invitee finishes their
 * profile (name + photo) and introduces themselves — not the instant they pick a
 * username. The notification uses the unified top banner as a 'system' notice.
 */
test('inviter is notified only after the invitee completes their profile', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

  const a = await createAccount(ctxA, 'RINGDEV7');
  await a.page.evaluate((av) => (window as any).__ringTest.setProfile('Alice', av), AVATAR);
  const code = await a.page.evaluate(() => (window as any).__ringTest.createInvite('Mom'));

  // B registers with the code but does NOT set up a profile yet.
  const b = await createAccount(ctxB, code as string, { mintOnConsumed: false });

  // A polls: it sees the code was redeemed (username picked), but must NOT announce a
  // join — B hasn't finished a profile yet (no published photo). Poll a few times to be
  // sure it stays silent.
  for (let i = 0; i < 3; i++) {
    await a.page.evaluate(() => (window as any).__ringTest.syncInvites());
    await a.page.waitForTimeout(300);
  }
  const joinedEarly = await a.page.evaluate(() =>
    (window as any).__ringTest.notices().some((n: any) => /joined/i.test(n.body)),
  );
  expect(joinedEarly).toBe(false);

  // B completes their profile (publishes a photo to the directory).
  await b.page.evaluate((av) => (window as any).__ringTest.setProfile('Bob', av), AVATAR);

  // On A's next sweep it sees B's now-complete profile and shows the unified 'system'
  // banner, labelled with A's note ("Mom"). (Prod polls on a timer; drive it here.)
  await expect
    .poll(
      async () => {
        await a.page.evaluate(() => (window as any).__ringTest.syncInvites());
        return a.page.evaluate(() =>
          (window as any).__ringTest
            .notices()
            .some((n: any) => n.kind === 'system' && n.name === 'Mom' && /joined/i.test(n.body)),
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  await ctxA.close();
  await ctxB.close();
});
