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
 * 1:1 audio->video upgrade is CONSENT-gated: the requester asks, the other party
 * must accept, and only then do BOTH sides add their cameras (so each receives the
 * other's video, fixing the old one-way/black-tile behaviour). Proves the new
 * call-upgrade-request/accept flow end-to-end.
 */
test('1:1 audio call upgrades to video only with the peer’s consent', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGUPG1');
  const b = await createAccount(ctxB, 'RINGUPG2');
  await pair(a, b);

  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);

  // A requests video. B must get a prompt; no unilateral switch happens.
  await a.page.evaluate(() => (window as any).__ringTest.toggleVideo());
  await b.page.waitForFunction(() => (window as any).__ringTest.upgradeRequested() === true, null, {
    timeout: 15_000,
  });

  // B accepts → both add cameras → each side receives the other's video track.
  await b.page.evaluate(() => (window as any).__ringTest.acceptVideoUpgrade());
  for (const p of [a, b]) {
    await p.page.waitForFunction(() => (window as any).__ringTest.remoteVideoTracks() >= 1, null, {
      timeout: 20_000,
    });
  }

  // Regression: "video previewed locally but never sent" on a RE-upgrade. Downgrade to
  // audio (this nulls the video sender's track but keeps its m-line/transceiver alive),
  // then upgrade to video AGAIN. The re-upgrade must REUSE that dormant video
  // transceiver (replaceTrack) rather than pc.addTrack a SECOND video m-line, which
  // would strand the live track on a direction the peer never receives. (We key off
  // callMeta().kind, not muted state: a 1:1 downgrade leaves the receiver track live in
  // the stream, and its muted attribute doesn't flip reliably in headless Chromium.)
  await a.page.evaluate(() => (window as any).__ringTest.toggleVideo()); // downgrade, peer mirrors
  for (const p of [a, b]) {
    await p.page.waitForFunction(() => (window as any).__ringTest.callMeta()?.kind === 'audio', null, {
      timeout: 20_000,
    });
  }

  // Baseline decoded-frame counts (frozen while audio-only) to prove NEW video flows after.
  const aFrames0 = await a.page.evaluate(() => (window as any).__ringTest.inboundVideoFrames());
  const bFrames0 = await b.page.evaluate(() => (window as any).__ringTest.inboundVideoFrames());

  await a.page.evaluate(() => (window as any).__ringTest.toggleVideo()); // re-request video
  await b.page.waitForFunction(() => (window as any).__ringTest.upgradeRequested() === true, null, {
    timeout: 15_000,
  });
  await b.page.evaluate(() => (window as any).__ringTest.acceptVideoUpgrade());
  for (const p of [a, b]) {
    await p.page.waitForFunction(() => (window as any).__ringTest.callMeta()?.kind === 'video', null, {
      timeout: 20_000,
    });
  }

  // The fix, deterministically: exactly ONE video transceiver per side (a duplicate
  // m-line from re-addTrack would make this 2 and is what stranded the video).
  for (const p of [a, b]) {
    expect(await p.page.evaluate(() => (window as any).__ringTest.videoTransceivers())).toBe(1);
  }

  // And real media flows again: each side decodes NEW video frames from the other after
  // the re-upgrade (the live confirmation that video reaches the peer, not just locally).
  await a.page.waitForFunction(
    (base) => (window as any).__ringTest.inboundVideoFrames().then((f: number) => f > base),
    aFrames0,
    { timeout: 25_000 },
  );
  await b.page.waitForFunction(
    (base) => (window as any).__ringTest.inboundVideoFrames().then((f: number) => f > base),
    bFrames0,
    { timeout: 25_000 },
  );

  await hangup(a);
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

  // Mid-call audio->video: A turns on video. The SFU must re-offer (it was an
  // audio-only call) so B and C start receiving A's new video track. This proves the
  // group video toggle + sfu-renegotiate path end-to-end.
  await a.page.evaluate(() => (window as any).__ringTest.toggleVideo());
  for (const p of [b, c]) {
    await p.page.waitForFunction(
      () => (window as any).__ringTest.remoteVideoTracks() >= 1,
      null,
      { timeout: 30_000 },
    );
  }

  // And back to audio-only: A's video track is removed and the SFU re-offers, so B
  // and C stop receiving video.
  await a.page.evaluate(() => (window as any).__ringTest.toggleVideo());
  for (const p of [b, c]) {
    await p.page.waitForFunction(
      () => (window as any).__ringTest.remoteVideoTracks() === 0,
      null,
      { timeout: 30_000 },
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
