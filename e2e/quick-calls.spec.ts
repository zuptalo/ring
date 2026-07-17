import { test, expect } from '@playwright/test';
import { createAccount, pair, waitCallState, hangup } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 1046: Quick Call tiles on the Calls tab. Adding an entry via the picker
 * offers only the methods the target's size allows (video ≤ 4, audio ≤ 8,
 * counting self); tapping a tile starts the call immediately with the entry's
 * method; entries can be switched (cap-aware) and removed; and the old Totals
 * block is gone from the Calls tab while Network usage carries the per-kind
 * audio/video rows.
 */
test('quick calls: add via picker, tap to ring, caps enforced, totals moved', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'QCALLA01');
  const b = await createAccount(ctxB, 'QCALLB01');
  const c = await createAccount(ctxC, 'QCALLC01');
  await pair(a, b);
  await pair(a, c);

  await a.page.goto('/tabs/calls');

  // The Totals block is gone (spec 1046 FR-009) — the tab starts at Quick Calls/Recent.
  await expect(a.page.locator('ion-list-header', { hasText: 'Totals' })).toHaveCount(0);

  // Add a VIDEO quick call for contact B via the picker.
  await a.page.locator('.qc-plus').click();
  const bName = (await a.page.evaluate(
    (id) => (window as any).__ringTest.contactName(id), b.id,
  )) as string;
  await a.page.locator('ion-modal ion-item', { hasText: bName }).first().click();
  const videoBtn = a.page.locator('ion-action-sheet button', { hasText: 'Video call' });
  await expect(videoBtn).toBeVisible({ timeout: 10_000 });
  await videoBtn.click();
  await expect(a.page.locator('.qc-tile[data-qc]')).toHaveCount(1, { timeout: 10_000 });

  // Tap the tile → B rings immediately (no intermediate screen).
  await a.page.locator('.qc-tile[data-qc]').first().click();
  await waitCallState(b, ['incoming']);
  await hangup(a);
  await waitCallState(a, ['idle', 'ended']);
  // The tap navigated to the active-call screen (that's the point); come back to
  // the tab for the management flows.
  await a.page.goto('/tabs/calls');
  await expect(a.page.locator('.qc-tile[data-qc]')).toHaveCount(1, { timeout: 15_000 });

  // Group caps: shrink the video cap below the group's size (the same lever the
  // capacity e2e uses) — a 3-person group then offers AUDIO ONLY in the picker.
  const gid = (await a.page.evaluate(
    (ids) => (window as any).__ringTest.createGroup('Big Crew', ids),
    [b.id, c.id],
  )) as string;
  await a.page.evaluate(() => (window as any).__ringTest.setCallCaps(2, 8));
  await a.page.locator('.qc-plus').click();
  await a.page.locator('ion-modal ion-item', { hasText: 'Big Crew' }).click();
  await expect(a.page.locator('ion-action-sheet button', { hasText: 'Voice call' })).toBeVisible({ timeout: 10_000 });
  await expect(a.page.locator('ion-action-sheet button', { hasText: 'Video call' })).toHaveCount(0);
  await expect(a.page.locator('ion-action-sheet .action-sheet-sub-title')).toContainText('Video calls are limited to');
  await a.page.locator('ion-action-sheet button', { hasText: 'Voice call' }).click();
  await expect(a.page.locator('.qc-tile[data-qc]')).toHaveCount(2, { timeout: 10_000 });

  // Switching the over-cap group's entry to video is blocked with the reason.
  const groupTile = a.page.locator(`.qc-tile[data-qc="group:${gid}"]`);
  await groupTile.hover();
  await a.page.mouse.down();
  await a.page.waitForTimeout(700);
  await a.page.mouse.up();
  const switchBtn = a.page.locator('ion-action-sheet button', { hasText: 'Switch to video' });
  await expect(switchBtn).toBeVisible({ timeout: 10_000 });
  await switchBtn.click();
  // appToast renders through the shared in-app banner overlay, not ion-toast.
  await expect(a.page.getByText(/Video calls are limited to/)).toBeVisible({ timeout: 10_000 });
  // Entry stays audio.
  await expect(groupTile).toBeVisible();

  // Remove the group entry via the manage sheet.
  await groupTile.hover();
  await a.page.mouse.down();
  await a.page.waitForTimeout(700);
  await a.page.mouse.up();
  const removeBtn = a.page.locator('ion-action-sheet button', { hasText: 'Remove quick call' });
  await expect(removeBtn).toBeVisible({ timeout: 10_000 });
  await removeBtn.click();
  await expect(a.page.locator('.qc-tile[data-qc]')).toHaveCount(1, { timeout: 10_000 });

  // Totals moved: Network usage shows the per-kind rows.
  await a.page.goto('/settings/network-usage');
  await expect(a.page.locator('ion-item', { hasText: 'Audio calls' })).toBeVisible({ timeout: 15_000 });
  await expect(a.page.locator('ion-item', { hasText: 'Video calls' })).toBeVisible();

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
