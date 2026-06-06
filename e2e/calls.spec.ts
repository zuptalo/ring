import { test, expect } from '@playwright/test';
import { createAccount, pair, startCall, accept, hangup, waitCallState, remoteTracks } from './helpers';

/**
 * 1:1 call verification against the real, E2EE signalling + DTLS-SRTP path,
 * relayed through the embedded TURN. This both proves 1:1 calling works AND
 * validates the multi-client harness before it's used for group (SFU) calls.
 */
test('1:1 audio call connects end-to-end and both sides receive media', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  const a = await createAccount(ctxA, 'RINGDEV1');
  const b = await createAccount(ctxB, 'RINGDEV2');

  await pair(a, b);

  // A places the call; B's device should ring.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);

  // B accepts; both sides should reach 'connected' (ICE via the local TURN).
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);

  // Each side received the other's audio track.
  expect(await remoteTracks(a)).toBeGreaterThan(0);
  expect(await remoteTracks(b)).toBeGreaterThan(0);

  // Hang up cleanly.
  await hangup(a);
  await waitCallState(a, ['idle', 'ended']);
  await waitCallState(b, ['idle', 'ended']);

  await ctxA.close();
  await ctxB.close();
});

/**
 * Background ringing: a callee that is OFFLINE when the call is placed should
 * still ring once it reconnects (push-woken). The server briefly buffers the
 * offer and delivers it on reconnect.
 */
test('background ringing: an offline callee rings after reconnecting', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  const a = await createAccount(ctxA, 'RINGDEV6');
  const b = await createAccount(ctxB, 'RINGDEV7');
  await pair(a, b);

  // B drops offline, then A calls (the server buffers the offer + would push).
  await ctxB.setOffline(true);
  await a.page.waitForTimeout(1500); // let the server observe B's disconnect
  await startCall(a, b.id, 'audio');

  // B comes back → reconnects, receives the buffered offer, and rings.
  await ctxB.setOffline(false);
  await waitCallState(b, ['incoming'], 40_000);

  // And the call completes normally.
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);
  await hangup(a);

  await ctxA.close();
  await ctxB.close();
});

/**
 * Group-call (SFU) verification: three participants join one room; each should
 * receive the other two's media, forwarded by the SFU. The media is E2EE via
 * insertable streams (the SFU only sees opaque RTP), keyed by a group key
 * distributed peer-to-peer over each pair's 1:1 ratchet - so all three are
 * paired first.
 */
test('group call: three participants exchange media via the SFU', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();

  const a = await createAccount(ctxA, 'RINGDEV3');
  const b = await createAccount(ctxB, 'RINGDEV4');
  const c = await createAccount(ctxC, 'RINGDEV5');

  // Pair every pair so the group media key can be distributed to all members.
  await pair(a, b);
  await pair(a, c);
  await pair(b, c);

  const room = 'e2e-group-room';
  for (const p of [a, b, c]) {
    await p.page.evaluate((r) => (window as any).__ringTest.startGroup(r, 'audio'), room);
  }

  // Each participant should end up with two remote streams (the other two).
  for (const p of [a, b, c]) {
    await p.page.waitForFunction(
      () => (window as any).__ringTest.remoteStreamCount() >= 2,
      null,
      { timeout: 60_000 },
    );
  }

  // Everyone tears down.
  for (const p of [a, b, c]) {
    await p.page.evaluate(() => (window as any).__ringTest.hangup());
  }

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
