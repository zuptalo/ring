import { test, expect } from '@playwright/test';
import { createAccount, pair, chatWith, waitHook, type RingClient } from './helpers';

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

type PendingKind = 'voice' | 'video' | 'image' | 'audio' | 'file';

const seedPending = (
  c: RingClient,
  chatId: string,
  kind: PendingKind = 'voice',
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

const setSetting = (c: RingClient, key: string, value: unknown) =>
  c.page.evaluate(
    ([k, v]: [string, unknown]) => (window as any).__ringTest.setSetting(k, v),
    [key, value] as [string, unknown],
  );

/** Arm a watcher for a functional toast BEFORE the action that raises it — the shared
 *  banner overlay only holds it for a couple of seconds, so polling afterwards races it. */
const bannerContaining = (c: RingClient, text: string) =>
  c.page.waitForFunction(
    (t: string) =>
      ((window as any).__ringTest.notices() as { name: string; body: string }[]).some((n) =>
        (n.name + n.body).includes(t),
      ),
    text,
    { timeout: 20_000 },
  );

/**
 * Every affordance a bubble may legitimately draw for an attachment, in any state: the
 * pending placeholders, the failed states, and the resolved players. SC-001 says a bubble is
 * never empty, so for a message carrying media at least one of these must be present. Listing
 * them explicitly (rather than checking "the bubble has some child") means a future kind that
 * renders nothing is caught rather than passing on the strength of its timestamp.
 */
const MEDIA_AFFORDANCES = [
  '.vp-pending', // voice, not here yet
  '.note-pending', // round note, not here yet
  '.video-poster.pending', // photo / video, not here yet
  '.file-chip.pending-chip', // audio file / document, not here yet
  '.vp', // voice player
  '.vnp', // round note player
  '.bubble-image', // photo / video poster
  '.audio-card', // audio file card
  '.file-chip', // document chip
  '.media-cleared', // removed to free space
].join(', ');

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

test('a voice message that failed comes back with a single tap, once the audio is reachable', async ({
  browser,
}) => {
  // SC-003. The "broken seed" test above proves we report failure; this one proves the other
  // half — that the retry actually WORKS when the thing that was wrong gets fixed. A failure
  // path with a dead retry button would satisfy every assertion in that test and none here.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'VOICERETRY1');
  const b = await createAccount(ctxB, 'VOICERETRY2');
  await pair(a, b);

  const bChat = (await chatWith(b, a.id)) as string;

  // The reference is real and the bytes ARE on the server — we simply refuse to let the
  // device reach them for a while, the way a flaky connection would.
  let reachable = false;
  await b.page.route('**/v1/blobs/**', async (route) => {
    if (reachable) await route.continue();
    else await route.abort();
  });

  const mid = await seedPending(b, bChat, 'voice');
  await b.page.goto(`/chat/${bChat}`);

  const row = bubble(b, mid);
  // Automatic recovery tries, and keeps failing, until it gives up and says so.
  await expect(row.locator('.vp-pending.failed')).toBeVisible({ timeout: 30_000 });
  expect((await info(b, mid)).hasMedia).toBe(false);

  // The network comes back. ONE tap — the automatic path has already given up, so this is
  // purely the manual retry doing the work (FR-003, and the cap in FR-006 not blocking it).
  reachable = true;
  await row.locator('.vp-pending').click();

  await expect(row.locator('.vp')).toBeVisible({ timeout: 20_000 });
  expect((await info(b, mid)).hasMedia).toBe(true);
});

test('a round video note renders while pending, recovers, and reports failure', async ({
  browser,
}) => {
  // US3. Round notes had the identical gap for the identical reason — excluded from the
  // square photo/video pending block — so they rendered nothing too.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ROUNDNOTE1');
  const b = await createAccount(ctxB, 'ROUNDNOTE2');
  await pair(a, b);

  const bChat = (await chatWith(b, a.id)) as string;

  // One that can be fetched, and one that never will be. Seeding both in the same chat also
  // checks the two branches don't fight over the same bubble.
  const okId = await seedPending(b, bChat, 'video', { videoNote: true });
  const badId = await seedPending(b, bChat, 'video', { videoNote: true, broken: true });

  await b.page.goto(`/chat/${bChat}`);

  // The fetchable one ends up as a real round-note player, no tap.
  await expect(bubble(b, okId).locator('.vnp')).toBeVisible({ timeout: 25_000 });

  // The unfetchable one stays visible and says it failed — round, not a square patch.
  const bad = bubble(b, badId);
  await expect(bad.locator('.note-pending')).toBeVisible({ timeout: 15_000 });
  await expect(bad.locator('.note-pending.failed')).toBeVisible({ timeout: 30_000 });
});

test('a photo that will not load tells you when you tap it', async ({ browser }) => {
  // US4 / SC-007. Photos already had a pending placeholder, so they were never blank — but a
  // tap that failed did nothing whatsoever, leaving no way to tell a slow load from a dead
  // one. The fix reaches every kind because they all share one tap handler.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'PHOTOFAIL1');
  const b = await createAccount(ctxB, 'PHOTOFAIL2');
  await pair(a, b);

  const bChat = (await chatWith(b, a.id)) as string;
  const mid = await seedPending(b, bChat, 'image', { broken: true });

  await b.page.goto(`/chat/${bChat}`);

  const row = bubble(b, mid);
  await expect(row.locator('.video-poster.pending')).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('.video-poster.pending.failed')).toBeVisible({ timeout: 30_000 });

  // Arm the watcher first: the banner is transient.
  const told = bannerContaining(b, "Couldn't load this");
  await row.locator('.video-poster.pending').click();
  await told; // the tap was answered, out loud (FR-009)
});

test('a photo you chose to leave deferred is not fetched behind your back', async ({ browser }) => {
  // FR-015. On-view recovery must not quietly undo a deliberate setting. This is only a real
  // test because the recovery path asks the SAME function the arrival path asks, rather than
  // carrying its own list of kinds — a hardcoded "voice and round notes only" would pass this
  // while ignoring the setting entirely.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'DEFERPHOTO1');
  const b = await createAccount(ctxB, 'DEFERPHOTO2');
  await pair(a, b);

  const bChat = (await chatWith(b, a.id)) as string;
  await setSetting(b, 'storage.autoDownload.photos', 'never');

  // Perfectly fetchable — the only reason not to fetch it is that the user said not to.
  const mid = await seedPending(b, bChat, 'image');
  await b.page.goto(`/chat/${bChat}`);

  const row = bubble(b, mid);
  await expect(row.locator('.video-poster.pending')).toBeVisible({ timeout: 15_000 });

  // Sit on the bubble well past the recovery debounce and give it every chance to misbehave.
  await b.page.waitForTimeout(4_000);
  const st = await info(b, mid);
  expect(st.hasMedia).toBe(false);
  expect(st.pending).toBe(true);

  // And it is still a thing you can choose to load yourself.
  await expect(row.locator('.video-poster.pending')).toBeVisible();
});

test('a run of pending voice messages all recover without stampeding the network', async ({
  browser,
}) => {
  // SC-005. Recovery fires per visible bubble, and before this spec downloads had no limiter
  // at all — the app-start backfill alone fired one unawaited fetch per pending message. A
  // chat full of them would have opened a fetch each, at once.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'STAMPEDE1');
  const b = await createAccount(ctxB, 'STAMPEDE2');
  await pair(a, b);

  const bChat = (await chatWith(b, a.id)) as string;

  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push(await seedPending(b, bChat, 'voice'));

  // Count AFTER seeding, so the uploads the seeder itself performed aren't mistaken for
  // downloads. Slow each fetch down so genuine overlap is possible — without a delay the
  // fetches finish so fast they'd serialise by accident and the test would prove nothing.
  let inFlight = 0;
  let peak = 0;
  await b.page.route('**/v1/blobs/**', async (route) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 700));
    try {
      await route.continue();
    } finally {
      inFlight--;
    }
  });

  await b.page.goto(`/chat/${bChat}`);
  await waitHook(b.page); // the reload drops __ringTest until the app boots again
  await expect(bubble(b, ids[0])).toBeVisible({ timeout: 20_000 });

  // Every one of them arrives.
  for (const id of ids) {
    await expect.poll(() => info(b, id).then((i) => i.hasMedia), { timeout: 60_000 }).toBe(true);
  }
  // And never more than the shared lane allows at once.
  expect(peak).toBeGreaterThan(0);
  expect(peak).toBeLessThanOrEqual(3);
});

test('no kind of attachment ever renders an empty bubble', async ({ browser }) => {
  // SC-001, swept across kinds. The reported bug was one cell of this matrix (voice × not
  // here yet) that nobody had ever looked at. This walks the rest so the next kind added
  // can't quietly reintroduce it.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MATRIX1');
  const b = await createAccount(ctxB, 'MATRIX2');
  await pair(a, b);

  const bChat = (await chatWith(b, a.id)) as string;

  const kinds: Array<{ kind: PendingKind; videoNote?: boolean; label: string }> = [
    { kind: 'voice', label: 'voice message' },
    { kind: 'video', videoNote: true, label: 'round video note' },
    { kind: 'image', label: 'photo' },
    { kind: 'video', label: 'video' },
    { kind: 'audio', label: 'audio file' },
    { kind: 'file', label: 'document' },
  ];

  // `broken` keeps each one deterministically in the not-here-yet / failed states, which are
  // the two the bug lived in. The resolved state is covered by the tests above and the
  // "removed to free space" state by media-cleanup.spec.ts — noted rather than skipped
  // silently, so the coverage claim stays honest.
  const seeded: Array<{ id: string; label: string }> = [];
  for (const k of kinds) {
    seeded.push({
      id: await seedPending(b, bChat, k.kind, { broken: true, videoNote: k.videoNote }),
      label: k.label,
    });
  }

  await b.page.goto(`/chat/${bChat}`);

  for (const s of seeded) {
    const row = bubble(b, s.id);
    await expect(row, `${s.label} bubble should exist`).toBeVisible({ timeout: 20_000 });
    // THE invariant: something is drawn. Before the fix, voice and round notes drew nothing
    // at all here — an outline with a timestamp in it.
    await expect(
      row.locator(MEDIA_AFFORDANCES),
      `${s.label} rendered an EMPTY bubble`,
    ).not.toHaveCount(0, { timeout: 20_000 });
  }
});
