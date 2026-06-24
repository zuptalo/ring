import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, accept, hangup, toggleMute,
  waitCallState, recordCues, cuesFired, setGlobalSetting, resetCallConfig,
} from './helpers';

/**
 * Call audio cues (spec 0004 US5). Cues are synthesized via Web Audio; the dev hook records
 * which ones FIRE (after the de-dup + the "Call sounds" gate), so we can assert they sound
 * across the call-state transitions and toggles, and that turning "Call sounds" off silences
 * them entirely.
 */

test.afterEach(async () => {
  await resetCallConfig();
});

test('cues fire across connect, mute/unmute, and hang-up', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CUE1A');
  const b = await createAccount(ctxB, 'CUE1B');
  await pair(a, b);

  await recordCues(a, true);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  // The 'connected' cue fires on the connect transition.
  await a.page.waitForFunction(() => (window as any).__ringTest.cuesFired().includes('connected'), null, { timeout: 10_000 });

  await toggleMute(a); // mute
  await a.page.waitForFunction(() => (window as any).__ringTest.cuesFired().includes('mute'), null, { timeout: 5_000 });
  await toggleMute(a); // unmute
  await a.page.waitForFunction(() => (window as any).__ringTest.cuesFired().includes('unmute'), null, { timeout: 5_000 });

  await hangup(a);
  await a.page.waitForFunction(() => (window as any).__ringTest.cuesFired().includes('callended'), null, { timeout: 5_000 });

  const fired = await cuesFired(a);
  expect(fired).toEqual(expect.arrayContaining(['connected', 'mute', 'unmute', 'callended']));

  await ctxA.close();
  await ctxB.close();
});

test('"Call sounds" off silences every call cue', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CUE2A');
  const b = await createAccount(ctxB, 'CUE2B');
  await pair(a, b);

  // Turn the per-call sounds off BEFORE the call (it's read once at call start).
  await setGlobalSetting(a, 'notifications.callSounds', false);
  await recordCues(a, true);

  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await toggleMute(a);
  await a.page.waitForTimeout(800);
  await hangup(a);
  await a.page.waitForTimeout(500);

  expect(await cuesFired(a)).toEqual([]); // nothing sounded

  await ctxA.close();
  await ctxB.close();
});
