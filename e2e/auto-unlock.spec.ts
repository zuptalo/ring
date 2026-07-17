import { test, expect } from '@playwright/test';
import { createAccount, waitHook } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Passwordless auto-unlock (the default posture): a registered device unlocks
 * from its device key with no passcode, and stays unlocked across a reload.
 */
test('auto-unlock: passwordless account unlocks on reload with no gate', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await createAccount(ctx, 'AUTOLCK1');

  expect(await a.page.evaluate(() => (window as any).__ringTest.hasDeviceUnlock())).toBe(true);
  expect(await a.page.evaluate(() => (window as any).__ringTest.isLockEnabled())).toBe(false);

  // Reload: the keystore auto-unlocks from the device key on boot (no passcode).
  await a.page.reload();
  await waitHook(a.page);
  await a.page.waitForFunction(() => (window as any).__ringTest.isUnlocked() === true, null, {
    timeout: 30_000,
  });

  await ctx.close();
});

/**
 * Opt-in lock: enabling a passcode removes the device key (so the SW can no longer
 * decrypt and the gate returns on reload); disabling it restores auto-unlock.
 */
test('lock opt-in: enabling a passcode removes auto-unlock; disabling restores it', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await createAccount(ctx, 'AUTOLCK2');

  // Turn ON a passcode lock.
  await a.page.evaluate(() => (window as any).__ringTest.enableLock('135790'));
  expect(await a.page.evaluate(() => (window as any).__ringTest.isLockEnabled())).toBe(true);
  expect(await a.page.evaluate(() => (window as any).__ringTest.hasDeviceUnlock())).toBe(false);

  // Reload: no device key → does NOT auto-unlock → the gate would show.
  await a.page.reload();
  await waitHook(a.page);
  await a.page.waitForTimeout(1500); // let the boot auto-unlock attempt run (must fail)
  expect(await a.page.evaluate(() => (window as any).__ringTest.isUnlocked())).toBe(false);

  // Disabling the lock (with the passcode) restores passwordless auto-unlock.
  await a.page.evaluate(() => (window as any).__ringTest.disableLock('135790'));
  expect(await a.page.evaluate(() => (window as any).__ringTest.hasDeviceUnlock())).toBe(true);
  await a.page.waitForFunction(() => (window as any).__ringTest.isUnlocked() === true, null, {
    timeout: 10_000,
  });

  await ctx.close();
});
