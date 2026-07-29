import { test, expect } from '@playwright/test';
import { createAccount, pair, chatWith, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 2059 — playback speed belongs to the message you set it on.
 *
 * The reported bug: changing the speed on one voice message changed it on every voice message.
 * The rate was a single app-wide value that every voice bubble read directly, so one pill tap
 * repainted them all. Video had the mirror-image bug — its rate lived in the player component,
 * which the media viewer destroys on swipe, so the chosen speed was silently forgotten.
 *
 * These tests assert on the PILL — what the user sees, and what the report was about. The
 * other half, that the chosen rate actually reaches the media element, is asserted directly in
 * `src/composables/useAudioPlayer.test.ts`: a label-only suite would pass even if the rate were
 * never applied to anything. That split is deliberate rather than lazy — the audio fixtures
 * available here are not decodable, so the element errors and tears itself down mid-assertion,
 * which would test the fixture rather than the fix. The video case below can and does check the
 * real element, because a real decodable clip is cheap to produce.
 */

const sendVoice = (c: RingClient, chatId: string, name: string) =>
  c.page.evaluate(
    ([id, n]: [string, string]) => (window as any).__ringTest.sendVoice(id, n),
    [chatId, name] as [string, string],
  );

/** Every voice bubble's speed pill, in message order. */
const pills = (c: RingClient) => c.page.locator('.bubble .vp .speed-pill');

test('changing one voice message’s speed leaves the others alone', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SPEED1');
  const b = await createAccount(ctxB, 'SPEED2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await sendVoice(a, aChat, 'first.webm');
  await sendVoice(a, aChat, 'second.webm');

  await a.page.goto(`/chat/${aChat}`);
  await expect(pills(a)).toHaveCount(2, { timeout: 30_000 });

  // Both start at normal speed.
  await expect(pills(a).nth(0)).toHaveText('1×');
  await expect(pills(a).nth(1)).toHaveText('1×');

  // Speed up the FIRST one only.
  await pills(a).nth(0).click();

  // THE REGRESSION: before the fix, this second pill moved in lockstep with the first.
  await expect(pills(a).nth(0)).toHaveText('1.5×');
  await expect(pills(a).nth(1)).toHaveText('1×');

  // And again, to be sure it is not just the first step that is isolated.
  await pills(a).nth(0).click();
  await expect(pills(a).nth(0)).toHaveText('2×');
  await expect(pills(a).nth(1)).toHaveText('1×');
});

test('a voice message keeps its speed when you come back to it', async ({ browser }) => {
  // US1 AC-3: the choice belongs to the message, so leaving the chat and returning must not
  // quietly reset it.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SPEED5');
  const b = await createAccount(ctxB, 'SPEED6');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await sendVoice(a, aChat, 'keep.webm');

  // Enter the chat by TAPPING it, so leaving and returning are in-app navigations. A
  // `page.goto` would be a full reload, which ends the session — and the speed is deliberately
  // session-scoped, so a reload resetting it is correct, not a regression.
  await a.page.goto('/tabs/chats');
  const row = a.page.locator('ion-item-sliding').first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(a.page).toHaveURL(/\/chat\//, { timeout: 15_000 });

  await expect(pills(a)).toHaveCount(1, { timeout: 30_000 });
  await pills(a).nth(0).click();
  await expect(pills(a).nth(0)).toHaveText('1.5×');

  // Out of the chat and back in — the page unmounts, so the rate has to outlive it.
  await a.page.goBack();
  await expect(a.page.locator('ion-item-sliding').first()).toBeVisible({ timeout: 15_000 });
  await a.page.locator('ion-item-sliding').first().click();

  await expect(pills(a)).toHaveCount(1, { timeout: 30_000 });
  await expect(pills(a).nth(0)).toHaveText('1.5×');
});

test('a video keeps the speed you gave it across swipes and reopens', async ({ browser }) => {
  // US2 / FR-007 / SC-003. The media viewer mounts one player per item and tears down the ones
  // you swipe away from, so the rate has to live outside the component — and, crucially, be
  // pushed back onto the freshly built <video> element, not just onto the pill.
  test.setTimeout(180_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SPEEDV1');
  const b = await createAccount(ctxB, 'SPEEDV2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  for (const n of ['clip1.mp4', 'clip2.mp4']) {
    await a.page.evaluate(
      ([id, name]) => (window as any).__ringTest.sendRealVideoQuality(id, 'sd', 640, 480, 1, 800_000, name),
      [aChat, n] as [string, string],
    );
  }

  await a.page.goto(`/chat/${aChat}`);
  const posters = a.page.locator('.bubble .video-poster');
  await expect(posters).toHaveCount(2, { timeout: 60_000 });

  // Open the viewer on the FIRST clip and give it a non-default speed.
  await posters.nth(0).click();
  await expect(a.page.locator('.viewer-track')).toBeVisible({ timeout: 15_000 });
  const viewerPill = a.page.locator('.viewer-track ~ * .speed-pill, .speed-pill').last();
  await expect(viewerPill).toBeVisible({ timeout: 10_000 });
  await viewerPill.click();
  await expect(viewerPill).toHaveText('1.5×');

  const activeVideoRate = () =>
    a.page.evaluate(() => {
      const vids = Array.from(document.querySelectorAll<HTMLVideoElement>('.viewer-slide video'));
      const shown = vids.find((v) => v.getBoundingClientRect().width > 0);
      return shown ? shown.playbackRate : -1;
    });
  await expect.poll(activeVideoRate, { timeout: 10_000 }).toBe(1.5);

  // Swipe to the other clip and back. Before the fix the player was destroyed and rebuilt at 1×.
  await a.page.locator('.v-strip .v-thumb').nth(1).click();
  await expect(viewerPill).toHaveText('1×', { timeout: 10_000 }); // the OTHER clip is untouched
  await a.page.locator('.v-strip .v-thumb').nth(0).click();

  await expect(viewerPill).toHaveText('1.5×', { timeout: 10_000 });
  // The pill being right is not enough — the element itself must have been set.
  await expect.poll(activeVideoRate, { timeout: 10_000 }).toBe(1.5);
});

test('Wall voice posts each keep their own speed', async ({ browser }) => {
  // US3. The Wall feed uses the same player as chat, so it had the same bug. Worth its own
  // test because of a subtlety the fix must not disturb: an album gives each voice slide its
  // own player id (`postId:index`), so "per message" has to mean per slide there, not per post.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SPEEDW1');
  const b = await createAccount(ctxB, 'SPEEDW2');
  await pair(a, b); // a post needs an audience to be addressed to

  await a.page.evaluate(() => (window as any).__ringTest.postVoice('first note'));
  await a.page.evaluate(() => (window as any).__ringTest.postVoice('second note'));

  await a.page.goto('/tabs/wall');
  const wallPills = a.page.locator('.vp .speed-pill');
  await expect(wallPills).toHaveCount(2, { timeout: 30_000 });

  await expect(wallPills.nth(0)).toHaveText('1×');
  await expect(wallPills.nth(1)).toHaveText('1×');

  await wallPills.nth(0).click();

  await expect(wallPills.nth(0)).toHaveText('1.5×');
  await expect(wallPills.nth(1)).toHaveText('1×'); // the other post is untouched
});
