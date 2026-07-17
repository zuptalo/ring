import { test, expect } from '@playwright/test';
import { createAccount, pair, startCall, accept, hangup, waitCallState } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 2029 regression: turning the camera off must reach the OTHER side as a
 * real video stop (track goes muted — no black-frame stream) and their UI must
 * swap to the sender's avatar, exactly like the sender's own preview does.
 * Today `toggleCamera` only disables the local track: black frames keep the
 * remote track un-muted and the remote UI keeps rendering (black) video.
 */
test('camera off shows the avatar on the remote side, camera on restores video', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CAMOFFA1');
  const b = await createAccount(ctxB, 'CAMOFFB1');
  await pair(a, b);

  // A straight video call (the consent-upgrade path is covered by calls.spec and
  // only adds flake here); wait until B is actually receiving A's video.
  await startCall(a, b.id, 'video');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);
  await b.page.waitForFunction(() => (window as any).__ringTest.remoteVideoMuted() === false, null, {
    timeout: 25_000,
  });
  // Live video is rendering on B — the avatar stage is not shown.
  await expect(b.page.locator('.audio-stage')).toBeHidden();

  // A turns the camera off → B's remote video track must go muted (no frames at
  // all, not black ones) and B's UI must swap to A's avatar.
  await a.page.evaluate(() => (window as any).__ringTest.toggleCamera());
  await b.page.waitForFunction(() => (window as any).__ringTest.remoteVideoMuted() === true, null, {
    timeout: 30_000,
  });
  await expect(b.page.locator('.audio-stage')).toBeVisible({ timeout: 10_000 });

  // A turns it back on → B gets live video again.
  await a.page.evaluate(() => (window as any).__ringTest.toggleCamera());
  await b.page.waitForFunction(() => (window as any).__ringTest.remoteVideoMuted() === false, null, {
    timeout: 30_000,
  });
  await expect(b.page.locator('.audio-stage')).toBeHidden({ timeout: 10_000 });

  await hangup(a);
  await ctxA.close();
  await ctxB.close();
});
