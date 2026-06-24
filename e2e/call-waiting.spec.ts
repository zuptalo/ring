import { test, expect, type Browser } from '@playwright/test';
import {
  createAccount, pair, startCall, startGroup, accept, hangup, waitCallState, waitRemotes,
  remoteTracks, callState, acceptAndHold, hasSecondIncoming, canHoldIncoming, heldCallId,
  isRemoteHeld, groupHeldPeers, swapCalls, endHeld, rejectSecond, recordCues, cuesFired,
  setGlobalSetting, type RingClient, resetCallConfig, callLogCount, waitCallLog, resumeCountdown,
  isRemoteQueued,
} from './helpers';

/** Set up the common state: A↔B connected (1:1), then C calls A and A accepts-and-holds, so
 *  A↔C is ACTIVE and A↔B is HELD (B sees on hold). Returns the clients + a cleanup. */
async function twoCalls(browser: Browser, tag: string): Promise<{ a: RingClient; b: RingClient; c: RingClient; close: () => Promise<void> }> {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, `${tag}A`);
  const b = await createAccount(ctxB, `${tag}B`);
  const c = await createAccount(ctxC, `${tag}C`);
  await pair(a, b);
  await pair(a, c);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  await acceptAndHold(a);
  await waitCallState(a, ['connected']);
  await waitCallState(c, ['connected']);
  await b.page.waitForFunction(() => (window as any).__ringTest.isRemoteHeld() === true, null, { timeout: 10_000 });
  return {
    a, b, c,
    close: async () => {
      await ctxA.close();
      await ctxB.close();
      await ctxC.close();
    },
  };
}

/**
 * Call waiting — US1 (spec 0005): take a second call without losing the first. Accepting a
 * second incoming call holds the current one (media paused both ways, "on hold" shown to the
 * other side) and connects the new one. Covers 1:1↔1:1 and holding a GROUP for a 1:1.
 */

test.afterEach(async () => {
  await resetCallConfig();
});

test('accepting a second 1:1 call holds the first (paused both ways, peer sees on hold)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CW1A');
  const b = await createAccount(ctxB, 'CW1B');
  const c = await createAccount(ctxC, 'CW1C');
  await pair(a, b);
  await pair(a, c);

  // A and B are in a connected 1:1 call.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);

  // C calls A → A is offered Accept & hold (a slot is free), not busy.
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  expect(await canHoldIncoming(a)).toBe(true);

  // A accepts-and-holds: the A↔B call is held; A↔C connects live.
  await acceptAndHold(a);
  await waitCallState(a, ['connected']); // now active on A↔C
  await waitCallState(c, ['connected']);
  expect(await remoteTracks(a)).toBeGreaterThan(0); // live media with C
  expect(await heldCallId(a)).not.toBeNull(); // A↔B parked in the held slot

  // B sees the call on hold (the held peer's "on hold" indication).
  await b.page.waitForFunction(() => (window as any).__ringTest.isRemoteHeld() === true, null, { timeout: 10_000 });
  expect(await isRemoteHeld(b)).toBe(true);

  // Hang up the ACTIVE call (C) → A RETURNS to the held call (B), which resumes — it must NOT
  // strand B or drop everything (the reported bug).
  await hangup(a);
  await waitCallState(a, ['connected']); // back on the A↔B call, not idle
  expect(await heldCallId(a)).toBeNull(); // nothing held anymore
  await b.page.waitForFunction(() => (window as any).__ringTest.isRemoteHeld() === false, null, { timeout: 10_000 });
  await waitCallState(c, ['idle', 'ended']); // C's call ended cleanly
  expect(await callState(b)).toBe('connected'); // B's call is alive again

  await hangup(a); // end the resumed A↔B call
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('holding a GROUP call to take a 1:1 leaves the other members talking; they see the holder on hold', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const ctxD = await browser.newContext();
  const a = await createAccount(ctxA, 'CW2A');
  const b = await createAccount(ctxB, 'CW2B');
  const c = await createAccount(ctxC, 'CW2C');
  const d = await createAccount(ctxD, 'CW2D');
  for (const [x, y] of [[a, b], [a, c], [b, c], [a, d]] as const) await pair(x, y);

  // A, B, C in a group call (mesh).
  const room = 'cw-group-room';
  await startGroup(a, room, 'audio');
  await startGroup(b, room, 'audio');
  await startGroup(c, room, 'audio');
  for (const x of [a, b, c]) await waitRemotes(x, 2);

  // D calls A 1:1 → A accepts-and-holds the GROUP.
  await startCall(d, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  await acceptAndHold(a);
  await waitCallState(a, ['connected']); // A↔D active
  await waitCallState(d, ['connected']);
  expect(await heldCallId(a)).toBe(room); // the group is held

  // B and C still see each other (mesh intact) and see A "on hold".
  for (const x of [b, c]) {
    expect(await callState(x)).toBe('connected');
    expect(await remoteTracks(x)).toBeGreaterThan(0);
    await x.page.waitForFunction(
      (id: string) => (window as any).__ringTest.groupHeldPeers().includes(id),
      a.id,
      { timeout: 10_000 },
    );
  }

  await hangup(a);
  await hangup(d);
  for (const x of [b, c]) await hangup(x);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
  await ctxD.close();
});

test('US2: swapping flips which call is active vs held (on-hold follows the held call)', async ({ browser }) => {
  const { a, b, c, close } = await twoCalls(browser, 'CWSWAP');
  // Start: A↔C active, A↔B held → B held, C not.
  expect(await isRemoteHeld(b)).toBe(true);
  expect(await isRemoteHeld(c)).toBe(false);

  for (let i = 0; i < 3; i++) {
    await swapCalls(a);
    // After an odd number of swaps: A↔B active, A↔C held. Even: back to the start.
    const bHeldExpected = i % 2 === 1; // i=0 → B not held (active), i=1 → B held, i=2 → B not held
    await b.page.waitForFunction((want: boolean) => (window as any).__ringTest.isRemoteHeld() === want, bHeldExpected, { timeout: 10_000 });
    await c.page.waitForFunction((want: boolean) => (window as any).__ringTest.isRemoteHeld() === want, !bHeldExpected, { timeout: 10_000 });
    expect(await callState(a)).toBe('connected'); // exactly one call active throughout
    expect(await heldCallId(a)).not.toBeNull(); // one call always held
  }

  await hangup(a);
  await close();
});

test('US3: dropping the HELD call leaves the active call undisturbed', async ({ browser }) => {
  const { a, b, c, close } = await twoCalls(browser, 'CWDH');
  await endHeld(a); // drop A↔B (the held one)
  await waitCallState(b, ['idle', 'ended']); // B's call ended
  expect(await heldCallId(a)).toBeNull(); // nothing held now
  expect(await callState(a)).toBe('connected'); // A↔C undisturbed
  expect(await callState(c)).toBe('connected');
  expect(await remoteTracks(a)).toBeGreaterThan(0);
  await hangup(a);
  await close();
});

test('US3/FR-009: the held call ending remotely frees the slot; the active call is undisturbed', async ({ browser }) => {
  const { a, b, c, close } = await twoCalls(browser, 'CWRH');
  await hangup(b); // the HELD peer hangs up
  await a.page.waitForFunction(() => (window as any).__ringTest.heldCallId() === null, null, { timeout: 10_000 });
  expect(await callState(a)).toBe('connected'); // A↔C untouched
  expect(await callState(c)).toBe('connected');
  await hangup(a);
  await close();
});

test('US4: at the two-call cap, a third caller gets busy and no third prompt is shown', async ({ browser }) => {
  const { a, c, close } = await twoCalls(browser, 'CWCAP');
  // A now has two calls (active + held). A fourth account D calls A → busy, no prompt.
  const ctxD = await browser.newContext();
  const d = await createAccount(ctxD, 'CWCAPD');
  await pair(a, d);
  expect(await canHoldIncoming(a)).toBe(false); // slot full
  await startCall(d, a.id, 'audio');
  await waitCallState(d, ['idle', 'ended'], 15_000); // D got busy
  expect(await hasSecondIncoming(a)).toBe(false); // A never prompted for a third
  expect(await callState(a)).toBe('connected'); // both A's calls undisturbed
  await hangup(a);
  await hangup(c).catch(() => {});
  await close();
  await ctxD.close();
});

test('crazy combo: declining the second call leaves the first undisturbed', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CWDECA');
  const b = await createAccount(ctxB, 'CWDECB');
  const c = await createAccount(ctxC, 'CWDECC');
  await pair(a, b);
  await pair(a, c);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);

  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  await rejectSecond(a); // decline the second
  expect(await hasSecondIncoming(a)).toBe(false);
  await waitCallState(c, ['idle', 'ended'], 15_000); // C is told busy
  expect(await callState(a)).toBe('connected'); // A↔B undisturbed
  expect(await callState(b)).toBe('connected');

  await hangup(a);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('crazy combo: the second caller hanging up before answer clears the prompt; first call undisturbed', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CWCANA');
  const b = await createAccount(ctxB, 'CWCANB');
  const c = await createAccount(ctxC, 'CWCANC');
  await pair(a, b);
  await pair(a, c);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);

  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  await hangup(c); // caller gives up before A answers
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === false, null, { timeout: 15_000 });
  expect(await callState(a)).toBe('connected'); // A↔B undisturbed
  expect(await callState(b)).toBe('connected');

  await hangup(a);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('US5: the call-waiting cues fire (alert, hold, swap, resume) and silence when Call sounds is off', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CWCUEA');
  const b = await createAccount(ctxB, 'CWCUEB');
  const c = await createAccount(ctxC, 'CWCUEC');
  await pair(a, b);
  await pair(a, c);
  await recordCues(a, true);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);

  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.cuesFired().includes('callwaiting'), null, { timeout: 15_000 });
  await acceptAndHold(a);
  await a.page.waitForFunction(() => (window as any).__ringTest.cuesFired().includes('hold'), null, { timeout: 10_000 });
  await swapCalls(a);
  await a.page.waitForFunction(() => (window as any).__ringTest.cuesFired().includes('swap'), null, { timeout: 10_000 });
  expect(await cuesFired(a)).toEqual(expect.arrayContaining(['callwaiting', 'hold', 'swap']));

  await hangup(a);
  await hangup(c).catch(() => {});
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();

  // Silence when Call sounds is off.
  const ctx2A = await browser.newContext();
  const ctx2B = await browser.newContext();
  const ctx2C = await browser.newContext();
  const a2 = await createAccount(ctx2A, 'CWSILA');
  const b2 = await createAccount(ctx2B, 'CWSILB');
  const c2 = await createAccount(ctx2C, 'CWSILC');
  await pair(a2, b2);
  await pair(a2, c2);
  await setGlobalSetting(a2, 'notifications.callSounds', false);
  await recordCues(a2, true);
  await startCall(a2, b2.id, 'audio');
  await waitCallState(b2, ['incoming']);
  await accept(b2);
  await waitCallState(a2, ['connected']);
  await startCall(c2, a2.id, 'audio');
  await a2.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  await acceptAndHold(a2);
  await a2.page.waitForTimeout(800);
  expect(await cuesFired(a2)).toEqual([]); // nothing sounded

  await hangup(a2);
  await ctx2A.close();
  await ctx2B.close();
  await ctx2C.close();
});

test('FR-010: a held-then-resumed call logs as ONE history entry (hold/swap/resume never log)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CWLOGA');
  const b = await createAccount(ctxB, 'CWLOGB');
  const c = await createAccount(ctxC, 'CWLOGC');
  await pair(a, b);
  await pair(a, c);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);

  // Take a second call (B is held), swap back and forth, then drop C → resume B, then end B.
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  await acceptAndHold(a);
  await waitCallState(c, ['connected']);
  await swapCalls(a); // active B, held C
  await swapCalls(a); // active C, held B
  await endHeld(a); // drop B (held) → it logs its single entry now
  await waitCallState(b, ['idle', 'ended']);
  await hangup(a); // end the remaining A↔C call

  // Exactly one call-log entry in each 1:1 chat — no per-hold/swap/resume noise (FR-010).
  await waitCallLog(a, b.id);
  await waitCallLog(a, c.id);
  await a.page.waitForTimeout(500); // let any stray duplicate land if the impl were wrong
  expect(await callLogCount(a, b.id)).toBe(1);
  expect(await callLogCount(a, c.id)).toBe(1);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('the party coming off hold gets a resume countdown before going live again', async ({ browser }) => {
  // A↔B connected; A takes a 2nd call from C (B held); A drops C → returns to B, which RESUMES B.
  // B (the held party) should see a countdown before its camera/mic go live, then it clears.
  const { a, b, c, close } = await twoCalls(browser, 'CWRC');
  // While A is on C, B is held: B's outgoing is paused and B is not yet counting down.
  expect(await resumeCountdown(b)).toBeNull();
  expect(await isRemoteHeld(b)).toBe(true);

  await hangup(a); // drop the active call (C) → A returns to the held call (B), resuming it
  await waitCallState(c, ['idle', 'ended']);

  // B is told it resumed → B runs a heads-up countdown before becoming visible again.
  await b.page.waitForFunction(() => (window as any).__ringTest.resumeCountdown() !== null, null, { timeout: 10_000 });
  expect(await isRemoteHeld(b)).toBe(false); // the freeze/blur clears immediately
  const n = await resumeCountdown(b);
  expect(typeof n).toBe('number');
  expect(n as number).toBeGreaterThan(0);
  expect(n as number).toBeLessThanOrEqual(5);

  // After the countdown elapses it clears and the call carries on connected.
  await b.page.waitForFunction(() => (window as any).__ringTest.resumeCountdown() === null, null, { timeout: 10_000 });
  expect(await callState(b)).toBe('connected');
  expect(await callState(a)).toBe('connected');

  await hangup(a);
  await close();
});

test('on a video call, the held party sees the frozen frame blurred with a pause overlay', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CWBLA');
  const b = await createAccount(ctxB, 'CWBLB');
  const c = await createAccount(ctxC, 'CWBLC');
  await pair(a, b);
  await pair(a, c);

  // A↔B on a VIDEO call.
  await startCall(a, b.id, 'video');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);

  // C calls A; A accepts-and-holds → B is put on hold (A stops sending; B's frame freezes).
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  await acceptAndHold(a);
  await b.page.waitForFunction(() => (window as any).__ringTest.isRemoteHeld() === true, null, { timeout: 10_000 });

  // B's screen shows the pause overlay and the main video is blurred (held-frozen).
  await expect(b.page.locator('.held-overlay')).toBeVisible();
  await expect(b.page.locator('.main-video.held-frozen')).toHaveCount(1);

  await hangup(a);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('the call-waiting alert keeps repeating while the second call goes unanswered', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CWREPA');
  const b = await createAccount(ctxB, 'CWREPB');
  const c = await createAccount(ctxC, 'CWREPC');
  await pair(a, b);
  await pair(a, c);
  await recordCues(a, true);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);

  // C calls A; A doesn't answer the call-waiting prompt. The alert should re-sound (~5s apart),
  // not play just once — so over ~6.5s we expect at least two 'callwaiting' cues.
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  await a.page.waitForTimeout(6_500);
  const repeats = (await cuesFired(a)).filter((n) => n === 'callwaiting').length;
  expect(repeats).toBeGreaterThanOrEqual(2);

  // Once the prompt is dismissed, the repeating alert stops.
  await rejectSecond(a);
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === false, null, { timeout: 10_000 });
  const afterDismiss = (await cuesFired(a)).filter((n) => n === 'callwaiting').length;
  await a.page.waitForTimeout(6_000);
  expect((await cuesFired(a)).filter((n) => n === 'callwaiting').length).toBe(afterDismiss);

  await hangup(a);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('calling someone already in a call shows the caller they are queued (not just ringing)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CWQA');
  const b = await createAccount(ctxB, 'CWQB');
  const c = await createAccount(ctxC, 'CWQC');
  await pair(a, b);
  await pair(a, c);

  // A and B are on a call.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);

  // C calls A (who is busy but has a free hold slot). C should land in the call-waiting queue:
  // A is told (gets the prompt), and C sees the queued status, not plain ringing.
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => (window as any).__ringTest.hasSecondIncoming() === true, null, { timeout: 15_000 });
  await c.page.waitForFunction(() => (window as any).__ringTest.isRemoteQueued() === true, null, { timeout: 15_000 });
  expect(await callState(c)).toBe('remote-ringing');
  await expect(c.page.locator('.queue-note')).toBeVisible();

  // When A accepts-and-holds, C connects and the queued flag no longer affects the status.
  await acceptAndHold(a);
  await waitCallState(c, ['connected']);

  await hangup(a);
  await hangup(c).catch(() => {});
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
