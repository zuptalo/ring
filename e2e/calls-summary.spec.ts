import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 1025 (US6): the Calls tab shows ISO-style dates (YYYY-MM-DD), a usage totals summary
 * (audio minutes, video minutes, data per kind), and the call detail's Video and Message action
 * buttons are swapped (Video first). Seeds completed call records directly (no real WebRTC).
 */
test('Calls: ISO dates, usage totals, and swapped detail buttons', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CALLSUM1');
  const b = await createAccount(ctxB, 'CALLSUM2');
  await pair(a, b); // so b.id is a real contact → the call detail renders its actions

  // A 2-minute audio call and a 10-minute video call, both on 2026-06-19 (local).
  await a.page.evaluate((peer) => {
    const ts = new Date(2026, 5, 19, 12, 0).getTime();
    return Promise.all([
      (window as any).__ringTest.seedCall({ video: false, durationSec: 120, bytes: 1_000_000, ts, contactId: peer }),
      (window as any).__ringTest.seedCall({ video: true, durationSec: 600, bytes: 9_000_000, ts, contactId: peer }),
    ]);
  }, b.id);

  await a.page.goto('/tabs/calls');

  // Totals summary: audio 2 min, video 10 min, and a combined data line.
  await expect(a.page.getByText('Totals')).toBeVisible({ timeout: 30_000 });
  await expect(a.page.locator('ion-item', { hasText: 'Audio calls' })).toContainText('2 min');
  await expect(a.page.locator('ion-item', { hasText: 'Video calls' })).toContainText('10 min');
  await expect(a.page.getByText('Data used')).toBeVisible();

  // ISO-style date on a call row.
  await expect(a.page.locator('ion-note', { hasText: '2026-06-19' }).first()).toBeVisible();

  // Call detail: action buttons swapped → Video first, Message last.
  await a.page.goto(`/call/${b.id}`);
  const btns = a.page.locator('.actions ion-button');
  await expect(btns.first()).toContainText('Video', { timeout: 30_000 });
  await expect(btns.last()).toContainText('Message');

  await ctxA.close();
  await ctxB.close();
});
