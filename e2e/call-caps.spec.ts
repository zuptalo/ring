import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startGroup, hangup, waitCallState, waitRemotes,
  remoteStreamCount, roster, notices, callState, setCallConfig, resetCallConfig,
} from './helpers';

/**
 * Participant caps (spec 0004 US3), enforced authoritatively by the server at room admission.
 * The caps are shrunk via the dev call-config endpoint so the test needs only three browser
 * contexts and a couple of seconds instead of nine participants: a video call holds at most
 * `videoMax`, audio at most `audioMax`, and a join past the cap is refused with a "call full"
 * notice while the existing call is undisturbed.
 */

test.afterEach(async () => {
  await resetCallConfig(); // restore production caps for the other call tests (shared backend)
});

test('a video group call refuses the participant past the cap (call full), call undisturbed', async ({ browser }) => {
  await setCallConfig({ videoMax: 2 });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CAPVID01');
  const b = await createAccount(ctxB, 'CAPVID02');
  const c = await createAccount(ctxC, 'CAPVID03');
  await pair(a, b);
  await pair(a, c);
  await pair(b, c);

  const room = 'caps-video-room';
  // A and B fill the 2-seat video room and mesh together.
  await startGroup(a, room, 'video');
  await startGroup(b, room, 'video');
  await waitRemotes(a, 1);
  await waitRemotes(b, 1);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);

  // C is the over-cap (3rd) joiner → refused with a "call full" notice, back to idle.
  await startGroup(c, room, 'video');
  await waitCallState(c, ['idle', 'ended']);
  await c.page.waitForFunction(
    () => (window as any).__ringTest.notices().some((n: any) => /full/i.test(n.name)),
    null,
    { timeout: 10_000 },
  );
  expect(await remoteStreamCount(c)).toBe(0);

  // The existing call is undisturbed: A and B still connected with each other only.
  expect(await callState(a)).toBe('connected');
  expect(await remoteStreamCount(a)).toBe(1);
  expect((await roster(a)).sort()).toEqual([a.id, b.id].sort());

  await hangup(a);
  await hangup(b);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('an audio group call enforces its own (larger) cap independently', async ({ browser }) => {
  await setCallConfig({ audioMax: 2 });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CAPAUD01');
  const b = await createAccount(ctxB, 'CAPAUD02');
  const c = await createAccount(ctxC, 'CAPAUD03');
  await pair(a, b);
  await pair(a, c);
  await pair(b, c);

  const room = 'caps-audio-room';
  await startGroup(a, room, 'audio');
  await startGroup(b, room, 'audio');
  await waitRemotes(a, 1);
  await waitRemotes(b, 1);

  await startGroup(c, room, 'audio');
  await waitCallState(c, ['idle', 'ended']);
  await c.page.waitForFunction(
    () => (window as any).__ringTest.notices().some((n: any) => /full/i.test(n.name)),
    null,
    { timeout: 10_000 },
  );
  expect(await remoteStreamCount(c)).toBe(0);
  expect(await callState(a)).toBe('connected');

  await hangup(a);
  await hangup(b);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
