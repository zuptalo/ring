import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A peer's current activity kind in a conversation (1:1 keyed by the peer's id).
const activity = (p: any, peerId: string): Promise<string | null> =>
  p.page.evaluate((id: string) => (window as any).__ringTest.peerActivity(id), peerId);

const emit = (p: any, peerId: string, kind: string, state: string): Promise<void> =>
  p.page.evaluate(
    (args: [string, string, string]) => (window as any).__ringTest.emitActivity(args[0], args[1], args[2]),
    [peerId, kind, state] as [string, string, string],
  );

const emitTo = (p: any, peerId: string, conv: string, kind: string, state: string): Promise<void> =>
  p.page.evaluate(
    (args: [string, string, string, string]) =>
      (window as any).__ringTest.emitActivity(args[0], args[2], args[3], args[1]),
    [peerId, conv, kind, state] as [string, string, string, string],
  );

const activityCount = (p: any, conv: string): Promise<number> =>
  p.page.evaluate((c: string) => (window as any).__ringTest.activityCount(c), conv);

const setSetting = (p: any, key: string, value: unknown): Promise<void> =>
  p.page.evaluate(
    (args: [string, unknown]) => (window as any).__ringTest.setSetting(args[0], args[1]),
    [key, value] as [string, unknown],
  );

/**
 * Spec 1009: ephemeral activity indicators relay end-to-end between two real
 * accounts over the live WebSocket — sealed peer-to-peer (kind opaque to the
 * server), never queued/persisted, with a ~6s auto-expiry so a dropped peer
 * never leaves a stuck indicator.
 */
test('typing/recording activity relays between two accounts, with auto-expiry', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ACTVTY01');
  const b = await createAccount(ctxB, 'ACTVTY02');
  await pair(a, b);

  // A is typing → B sees "typing" within ~1s (SC-001).
  await emit(a, b.id, 'typing', 'active');
  await expect.poll(() => activity(b, a.id), { timeout: 15_000 }).toBe('typing');

  // A stops → B's indicator clears (SC-001).
  await emit(a, b.id, 'typing', 'stopped');
  await expect.poll(() => activity(b, a.id), { timeout: 10_000 }).toBe(null);

  // Distinct recording kinds (SC-002): audio then video, each replacing the prior.
  await emit(a, b.id, 'recording-audio', 'active');
  await expect.poll(() => activity(b, a.id), { timeout: 10_000 }).toBe('recording-audio');
  await emit(a, b.id, 'recording-video', 'active');
  await expect.poll(() => activity(b, a.id), { timeout: 10_000 }).toBe('recording-video');

  // Auto-expiry (SC-005): with no further signal, B's indicator self-clears within
  // ~6s — no explicit stop required (covers a peer that drops mid-activity).
  await b.page.waitForTimeout(7_000);
  expect(await activity(b, a.id)).toBe(null);

  await ctxA.close();
  await ctxB.close();
});

/**
 * Spec 1009 §US3: the privacy toggle is reciprocal — with it OFF, the user emits
 * nothing AND sees nothing from others. Enforced entirely client-side.
 */
test('privacy toggle off suppresses activity in both directions (reciprocity)', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ACTVTY03');
  const b = await createAccount(ctxB, 'ACTVTY04');
  await pair(a, b);

  // A turns activity indicators OFF; let the settings-change apply the gate.
  await setSetting(a, 'privacy.activityIndicators', false);
  await a.page.waitForTimeout(1200);

  // A emits → B (on) sees nothing, because A sends nothing while disabled.
  await emit(a, b.id, 'typing', 'active');
  await a.page.waitForTimeout(1500);
  expect(await activity(b, a.id)).toBe(null);

  // B emits → A (off) sees nothing, because A renders nothing while disabled (reciprocity).
  await emit(b, a.id, 'typing', 'active');
  await a.page.waitForTimeout(1500);
  expect(await activity(a, b.id)).toBe(null);

  // Sanity: turn A back on → B's activity becomes visible to A again.
  await setSetting(a, 'privacy.activityIndicators', true);
  await a.page.waitForTimeout(1200);
  await emit(b, a.id, 'typing', 'active');
  await expect.poll(() => activity(a, b.id), { timeout: 10_000 }).toBe('typing');

  await ctxA.close();
  await ctxB.close();
});

/**
 * Spec 1009 §US5: group activity is keyed by the shared group id, so a recipient
 * coalesces multiple concurrent senders. Here two real senders (B, C) signal
 * activity in the same group to A, who sees two distinct active senders.
 */
test('group activity from two senders coalesces on the recipient', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'ACTVTY05');
  const b = await createAccount(ctxB, 'ACTVTY06');
  const c = await createAccount(ctxC, 'ACTVTY07');
  // Pair A with both B and C so their bundles are fetchable (sealing needs them).
  await pair(a, b);
  await pair(a, c);

  const GROUP = 'grp-activity-test';
  // B and C both signal typing in the same group to A.
  await emitTo(b, a.id, GROUP, 'typing', 'active');
  await emitTo(c, a.id, GROUP, 'typing', 'active');

  // A coalesces both senders under the one group key (two distinct active senders).
  await expect.poll(() => activityCount(a, GROUP), { timeout: 15_000 }).toBe(2);

  // C stops → A is left with one active sender.
  await emitTo(c, a.id, GROUP, 'typing', 'stopped');
  await expect.poll(() => activityCount(a, GROUP), { timeout: 10_000 }).toBe(1);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
