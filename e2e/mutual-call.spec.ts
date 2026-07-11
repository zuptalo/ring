import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, accept, reject, hangup,
  waitCallState, callState, callLogCount, rejectSecond, hasSecondIncoming,
  type RingClient,
} from './helpers';

/**
 * Mutual simultaneous calls (spec 1039): two contacts placing 1:1 calls at each other at
 * (nearly) the same time must resolve to ONE connected call — automatically when the kinds
 * match (neither side ever rings or taps Accept), via a normal ring when the kinds differ
 * (camera consent). A crossing offer must also never corrupt an outgoing call being placed
 * (the pre-1039 race stranded both sides on "Calling…").
 *
 * The winner of the deterministic tie-break is the SMALLER user id (its offer survives),
 * so tests that depend on which side yields compute winner/loser from the actual ids.
 */

/** Record every distinct callState the page passes through (25ms sampler), so a test can
 *  assert a state — e.g. 'incoming' — was never entered. The auto-accept path never SETS
 *  'incoming', so any observation of it is a real regression, not sampling luck. */
async function trackStates(c: RingClient): Promise<void> {
  await c.page.evaluate(() => {
    const w = window as any;
    w.__seenStates = [w.__ringTest.callState()];
    w.__stateTracker ??= setInterval(() => {
      const s = w.__ringTest.callState();
      const arr = w.__seenStates;
      if (arr[arr.length - 1] !== s) arr.push(s);
    }, 25);
  });
}
const seenStates = (c: RingClient): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__seenStates ?? []);

async function settled(c: RingClient): Promise<void> {
  await waitCallState(c, ['idle', 'ended']);
}

for (const kind of ['audio', 'video'] as const) {
  test(`mutual ${kind} calls at the same instant connect both sides, no ring, no manual accept`, async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await createAccount(ctxA, `GL${kind === 'audio' ? 'A' : 'V'}1A`);
    const b = await createAccount(ctxB, `GL${kind === 'audio' ? 'A' : 'V'}1B`);
    await pair(a, b);
    await trackStates(a);
    await trackStates(b);

    // Both tap "call" on each other in the same instant — the offers cross mid-flight,
    // landing inside (or right after) each side's setup window.
    await Promise.all([startCall(a, b.id, kind), startCall(b, a.id, kind)]);

    // Both sides end up in ONE connected call without anyone accepting (SC-001).
    await waitCallState(a, ['connected']);
    await waitCallState(b, ['connected']);

    // Neither side ever rang: the incoming state must never have been entered (FR-003/008).
    expect(await seenStates(a)).not.toContain('incoming');
    expect(await seenStates(b)).not.toContain('incoming');

    // The call works and ends cleanly.
    await hangup(a);
    await settled(a);
    await settled(b);

    // Exactly one history entry per side for the encounter, an answered call — the
    // yielded attempt must not surface as a second/missed entry (FR-007, SC-005).
    expect(await callLogCount(a, b.id)).toBe(1);
    expect(await callLogCount(b, a.id)).toBe(1);

    // A follow-up call still works (no leaked state from the resolution). Wait for both
    // sides to fully settle to idle first: an offer landing inside the short post-call
    // 'ended' display dwell is answered busy (pre-existing behavior, unrelated to glare).
    await waitCallState(a, ['idle']);
    await waitCallState(b, ['idle']);
    await startCall(a, b.id, 'audio');
    await waitCallState(b, ['incoming']);
    await accept(b);
    await waitCallState(a, ['connected']);
    await hangup(a);

    await ctxA.close();
    await ctxB.close();
  });
}

test('mismatched kinds: the yielder gets a normal ring (no auto-camera); decline ends both cleanly', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const first = await createAccount(ctxA, 'GLMM1A');
  const second = await createAccount(ctxB, 'GLMM1B');
  await pair(first, second);
  // The SMALLER id wins the tie-break; give the winner an AUDIO call and the yielder a
  // VIDEO call, so the surviving (audio) offer mismatches the yielder's own intent.
  const winner = first.id < second.id ? first : second;
  const loser = winner === first ? second : first;
  await trackStates(winner);

  await Promise.all([startCall(winner, loser.id, 'audio'), startCall(loser, winner.id, 'video')]);

  // The yielder is presented the surviving AUDIO call as a normal incoming ring (FR-004) —
  // its own video attempt is withdrawn, and no camera is auto-enabled for an audio call.
  await waitCallState(loser, ['incoming']);
  expect((await loser.page.evaluate(() => (window as any).__ringTest.callMeta()))?.kind).toBe('audio');
  // The winner never rings (its attempt survived).
  expect(await seenStates(winner)).not.toContain('incoming');

  // Declining settles BOTH sides promptly — no stuck states, no waiting out a timeout (US2).
  await reject(loser);
  await settled(winner);
  await settled(loser);

  await ctxA.close();
  await ctxB.close();
});

test('mismatched kinds: accepting the surviving call connects it at the surviving kind', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const first = await createAccount(ctxA, 'GLMM2A');
  const second = await createAccount(ctxB, 'GLMM2B');
  await pair(first, second);
  const winner = first.id < second.id ? first : second;
  const loser = winner === first ? second : first;

  await Promise.all([startCall(winner, loser.id, 'video'), startCall(loser, winner.id, 'audio')]);

  // Surviving offer is VIDEO; the yielder placed audio → ring, not auto-connect (consent).
  await waitCallState(loser, ['incoming']);
  await accept(loser);
  await waitCallState(winner, ['connected']);
  await waitCallState(loser, ['connected']);

  await hangup(winner);
  await settled(winner);
  await settled(loser);
  await ctxA.close();
  await ctxB.close();
});

test('a third caller in the same instant cannot corrupt the call being placed', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'GL3P1A');
  const b = await createAccount(ctxB, 'GL3P1B');
  const c = await createAccount(ctxC, 'GL3P1C');
  await pair(a, b);
  await pair(b, c);

  // B places a call to A while C calls B in the same instant. C's offer lands during (or
  // right after) B's setup window — before the fix it clobbered B's outgoing call state.
  await Promise.all([startCall(b, a.id, 'audio'), startCall(c, b.id, 'audio')]);

  // B's call to A proceeds and connects normally (FR-006).
  await waitCallState(a, ['incoming']);
  await accept(a);
  await waitCallState(b, ['connected']);
  expect((await b.page.evaluate(() => (window as any).__ringTest.callMeta()))?.peerUserId).toBe(a.id);

  // C is never silently connected: it got busy (ended) or is parked in B's call-waiting
  // prompt (both are the existing "calling a busy person" outcomes).
  expect(await callState(c)).not.toBe('connected');
  if (await hasSecondIncoming(b)) await rejectSecond(b);
  await settled(c);

  await hangup(b);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('a mutual attempt while already in a call follows busy/call-waiting rules, not glare', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'GLBZ1A');
  const b = await createAccount(ctxB, 'GLBZ1B');
  const c = await createAccount(ctxC, 'GLBZ1C');
  await pair(a, b);
  await pair(b, c);

  // A and B are connected.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);

  // C calls B (who is busy). B's connected call is NOT glare — C lands in the existing
  // call-waiting prompt; the A↔B call is undisturbed (FR-009, spec edge case).
  await startCall(c, b.id, 'audio');
  await b.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  expect(await callState(a)).toBe('connected');
  expect(await callState(b)).toBe('connected');

  await rejectSecond(b);
  await settled(c);
  await hangup(a);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
