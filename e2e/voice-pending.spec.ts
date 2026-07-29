import { test, expect } from '@playwright/test';
import { createAccount, pair, chatWith, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 2058 — a voice message must never arrive as an empty bubble.
 *
 * The reported bug: a voice message whose audio bytes are not on the device yet rendered as
 * an outline with a timestamp and nothing else. No player, no duration, no download button,
 * no error — and no way to get the audio. It happened whenever the message arrived while the
 * app was closed (the push path stores the reference and never fetches bytes) or whenever a
 * fetch failed (both the live path and the app-start backfill quietly left it pending "for a
 * manual retry" that, for voice, did not exist).
 *
 * These tests seed that state directly rather than racing a real push, because the window
 * between arrival and backfill is short on a fast connection — and because the genuine
 * trigger, a Web Push into a closed iOS PWA, is not something headless can produce. The state
 * is the right unit to test; the real-device pass is tracked separately on the spec.
 *
 * The assertions are deliberately on RENDERED CONTENT. Asserting `pending === true` would
 * pass identically before and after the fix and prove nothing at all.
 */

const seedPending = (
  c: RingClient,
  chatId: string,
  kind: 'voice' | 'video' | 'image' = 'voice',
  opts: { broken?: boolean; videoNote?: boolean; agedMs?: number } = {},
): Promise<string> =>
  c.page.evaluate(
    ([id, k, o]: [string, string, Record<string, unknown>]) =>
      (window as any).__ringTest.seedPendingIncoming(id, k, o),
    [chatId, kind, opts] as [string, string, Record<string, unknown>],
  );

const info = (c: RingClient, msgId: string) =>
  c.page.evaluate((id: string) => (window as any).__ringTest.mediaInfo(id), msgId) as Promise<{
    hasMedia: boolean;
    pending: boolean;
  }>;

/** The bubble body must contain something the user can see and act on. */
const bubble = (c: RingClient, mid: string) => c.page.locator(`.bubble[data-mid="${mid}"]`);

test('a voice message whose audio is not on the device yet still renders, and recovers itself', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'VOICEPEND1');
  const b = await createAccount(ctxB, 'VOICEPEND2');
  await pair(a, b);

  const bChat = (await chatWith(b, a.id)) as string;
  expect(bChat).toBeTruthy();

  // Hold the blob fetch for a couple of seconds. Without this the seeded audio (a few hundred
  // bytes against a local server) lands so fast that the placeholder is gone before the first
  // assertion can look at it — the test would be racing its own fixture rather than checking
  // behavior. The delay makes the pending window observable; it does not change what happens.
  await b.page.route('**/v1/blobs/**', async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });

  // Seed the exact reported state on B: an incoming voice message, bytes not fetched.
  // The reference is real, so recovery can genuinely succeed.
  const mid = await seedPending(b, bChat, 'voice');
  expect(mid).toBeTruthy();
  expect((await info(b, mid)).pending).toBe(true);

  await b.page.goto(`/chat/${bChat}`);

  // THE REGRESSION: before the fix this bubble rendered with an empty body.
  const row = bubble(b, mid);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('.vp-pending')).toBeVisible({ timeout: 10_000 });

  // FR-002: it reads as a voice message and shows how long it is.
  await expect(row).toContainText(/0:0\d|Voice message/);

  // FR-005 + FR-007 + SC-002: it fetches itself on view and becomes a real player, without
  // any tap and without leaving the chat.
  await expect(row.locator('.vp-pending')).toHaveCount(0, { timeout: 15_000 });
  await expect(row.locator('.vp')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => info(b, mid).then((i) => i.hasMedia), { timeout: 15_000 }).toBe(true);
});

test('a voice message stranded before this fix recovers on the next open of its chat', async ({
  browser,
}) => {
  // FR-013 / SC-004: the blank bubbles already sitting on people's devices must heal
  // themselves — no reinstall, and no asking the sender to send it again.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'VOICEPEND3');
  const b = await createAccount(ctxB, 'VOICEPEND4');
  await pair(a, b);

  const bChat = (await chatWith(b, a.id)) as string;
  // Backdated a week: a message left pending by an older build, not one that just arrived.
  const mid = await seedPending(b, bChat, 'voice', { agedMs: 7 * 24 * 60 * 60 * 1000 });

  await b.page.goto(`/chat/${bChat}`);

  const row = bubble(b, mid);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('.vp')).toBeVisible({ timeout: 20_000 });
  expect((await info(b, mid)).hasMedia).toBe(true);
});

test('a voice message whose audio cannot be fetched says so, and can be retried', async ({
  browser,
}) => {
  // US2: the permanent-damage half. A failed fetch must not strand the message silently.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'VOICEPEND5');
  const b = await createAccount(ctxB, 'VOICEPEND6');
  await pair(a, b);

  const bChat = (await chatWith(b, a.id)) as string;
  // A reference pointing at bytes that were never uploaded: every fetch will fail.
  const mid = await seedPending(b, bChat, 'voice', { broken: true });

  await b.page.goto(`/chat/${bChat}`);

  const row = bubble(b, mid);
  await expect(row).toBeVisible({ timeout: 15_000 });

  // FR-001/FR-002: still not blank, and still legible as a voice message with its length.
  await expect(row.locator('.vp-pending')).toBeVisible({ timeout: 10_000 });
  await expect(row).toContainText(/0:0\d|Voice message/);

  // FR-008: once the automatic attempts fail it reads as FAILED, not as forever-loading.
  await expect(row.locator('.vp-pending.failed')).toBeVisible({ timeout: 25_000 });

  // FR-008 again, the part that matters: the failure survives leaving and coming back. A
  // component-local flag would pass every assertion above and fail this one.
  await b.page.goto('/tabs/chats');
  await b.page.goto(`/chat/${bChat}`);
  await expect(bubble(b, mid).locator('.vp-pending.failed')).toBeVisible({ timeout: 15_000 });

  // FR-003: it is still a real control the user can press to try again.
  await expect(bubble(b, mid).locator('.vp-pending')).toBeEnabled();
});
