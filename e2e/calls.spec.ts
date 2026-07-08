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

  // The upgrade adds EXACTLY ONE video transceiver per side (a clean single upgrade — a
  // duplicate m-line would make this 2 and strand the live track). A call no longer drops
  // back to audio, so there is no downgrade/re-upgrade path to exercise here.
  for (const p of [a, b]) {
    await p.page.waitForFunction(() => (window as any).__ringTest.callMeta()?.kind === 'video', null, {
      timeout: 20_000,
    });
    expect(await p.page.evaluate(() => (window as any).__ringTest.videoTransceivers())).toBe(1);
  }

  // And real media flows: each side decodes the other's video frames (the live confirmation
  // that video reaches the peer, not just previews locally).
  for (const p of [a, b]) {
    await p.page.waitForFunction(
      () => (window as any).__ringTest.inboundVideoFrames().then((f: number) => f > 0),
      null,
      { timeout: 25_000 },
    );
  }

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

  // Let A finish gathering + trickling its ICE candidates while B is still offline. These
  // arrive at the server AFTER the offer, so they only reach B if the server buffers
  // undelivered 1:1 ICE alongside the offer — otherwise B answers with no candidates from A
  // and the call is stuck connecting (the real-device ">30s backgrounded" bug).
  await a.page.waitForTimeout(3000);

  // B comes back → reconnects, receives the buffered offer + ICE, and rings.
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
 * Group-call (mesh) verification: three participants join one room; each opens a
 * direct peer connection to the other two (no SFU), so each should receive the
 * other two's media. Every leg is natively E2EE via DTLS-SRTP, and the per-pair
 * SDP/ICE is sealed over that pair's 1:1 ratchet - so all three are paired first.
 */
test('group call: three participants exchange media over the mesh', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();

  const a = await createAccount(ctxA, 'RINGDEV3');
  const b = await createAccount(ctxB, 'RINGDEV4');
  const c = await createAccount(ctxC, 'RINGDEV5');

  // Pair every pair so each mesh leg can seal its SDP/ICE over that pair's ratchet.
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

  // Mid-call audio->video: A turns on video. Each mesh leg renegotiates (perfect
  // negotiation) so B and C start receiving A's new video track. This proves the
  // group video toggle + per-pair renegotiation path end-to-end.
  await a.page.evaluate(() => (window as any).__ringTest.toggleVideo());
  for (const p of [b, c]) {
    await p.page.waitForFunction(
      () => (window as any).__ringTest.remoteVideoTracks() >= 1,
      null,
      { timeout: 30_000 },
    );
  }

  // (A call no longer drops back to audio mid-call — the video→audio downgrade was removed —
  // so there's no "back to audio-only" leg to exercise here.)

  // Everyone tears down.
  for (const p of [a, b, c]) {
    await p.page.evaluate(() => (window as any).__ringTest.hangup());
  }

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

/**
 * Group-call tile LABELLING: each participant announces its outgoing stream id to the
 * others (sealed, peer-to-peer), so every client can map an otherwise-anonymous
 * incoming MediaStream to its owner and show that contact's name/avatar on the tile.
 *
 * In the mesh each remote stream arrives over a direct connection to a KNOWN peer, so
 * the owner map ({ stream.id -> userId }) is derived locally from which leg delivered
 * the stream - no announcement to get lost. We assert the mapping at the data layer
 * (the same groupStreamOwners map the tile computed reads); the template then just
 * binds contactsMap.get(userId).name, so a correct owner id means a correct label.
 */
test('group call: each remote stream is mapped to its owner for tile labels', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();

  const a = await createAccount(ctxA, 'CALLLBL1');
  const b = await createAccount(ctxB, 'CALLLBL2');
  const c = await createAccount(ctxC, 'CALLLBL3');

  await pair(a, b);
  await pair(a, c);
  await pair(b, c);

  // Give each account a known local name for its peers, so the owner id a tile
  // resolves would render a non-empty, predictable label.
  const names: Record<string, string> = { [a.id]: 'Alice', [b.id]: 'Bob', [c.id]: 'Carol' };
  for (const [self, peers] of [
    [a, [b, c]],
    [b, [a, c]],
    [c, [a, b]],
  ] as const) {
    for (const peer of peers) {
      await self.page.evaluate(
        ([id, name]) => (window as any).__ringTest.setContactName(id, name),
        [peer.id, names[peer.id]] as const,
      );
    }
  }

  const room = 'e2e-group-labels';
  for (const p of [a, b, c]) {
    await p.page.evaluate((r) => (window as any).__ringTest.startGroup(r, 'video'), room);
  }

  // Each participant receives the other two's streams...
  for (const p of [a, b, c]) {
    await p.page.waitForFunction(
      () => (window as any).__ringTest.remoteStreamCount() >= 2,
      null,
      { timeout: 60_000 },
    );
  }

  // ...and crucially, EVERY remote stream id resolves to an owner via the announced
  // map (this is the msid-survival proof - keys match the streams we actually got).
  for (const p of [a, b, c]) {
    await p.page.waitForFunction(
      () => {
        const t = (window as any).__ringTest;
        const owners = t.groupStreamOwners();
        const ids = t.remoteStreamIds() as string[];
        return ids.length >= 2 && ids.every((id) => typeof owners[id] === 'string');
      },
      null,
      { timeout: 60_000 },
    );
  }

  // Assert the mapping is CORRECT, not merely present: the set of owners each peer
  // sees is exactly the other two accounts, and each resolves to the expected name.
  const idsByName = { Alice: a.id, Bob: b.id, Carol: c.id };
  for (const [p, expected] of [
    [a, ['Bob', 'Carol']],
    [b, ['Alice', 'Carol']],
    [c, ['Alice', 'Bob']],
  ] as const) {
    const owners = (await p.page.evaluate(() => {
      const t = (window as any).__ringTest;
      const map = t.groupStreamOwners();
      const ids = t.remoteStreamIds() as string[];
      return ids.map((id) => map[id]);
    })) as string[];
    const expectedIds = expected.map((n) => idsByName[n]).sort();
    expect(owners.slice().sort()).toEqual(expectedIds);
    // Each owner id resolves to the contact name the tile would render.
    for (const ownerId of owners) {
      const label = await p.page.evaluate(
        (id) => (window as any).__ringTest.contactName(id),
        ownerId,
      );
      expect(expected).toContain(label);
    }
  }

  for (const p of [a, b, c]) {
    await p.page.evaluate(() => (window as any).__ringTest.hangup());
  }
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

/**
 * Ad-hoc mesh between members who AREN'T mutual contacts. The initiator (a) knows both b
 * and c, but b and c have never connected — so their leg has no pre-existing 1:1 ratchet
 * and, under the connect gate, neither could normally fetch the other's prekey bundle. The
 * call must still mesh fully: each non-contact pair opens an EPHEMERAL, call-scoped session
 * (the server lets co-members of a live call room fetch each other's bundles for the
 * duration of the call), so all three receive everyone's media — and crucially nobody lands
 * in anyone's contacts, and the session is torn down when the call ends.
 */
test('group call: members who are not mutual contacts still mesh', async ({ browser }) => {
  // NOT CI-FRIENDLY. A full 3-person WebRTC mesh (each peer opens 2 connections)
  // across three browser contexts on a shared CI runner is the classic ICE/timing
  // flake — it clears on retry but intermittently fails all of them on a loaded
  // runner. Covered by the 2-person call tests + unit tests + real-device runs
  // (see project notes). Runs locally; skipped in CI.
  test.skip(!!process.env.CI, '3-person WebRTC mesh is too flaky for headless CI runners');
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CALLINTRO1');
  const b = await createAccount(ctxB, 'CALLINTRO2');
  const c = await createAccount(ctxC, 'CALLINTRO3');

  // a is the common contact; b and c are deliberately NOT paired with each other.
  await pair(a, b);
  await pair(a, c);

  const knows = (p: typeof a, id: string) =>
    p.page.evaluate((x) => (window as any).__ringTest.contactName(x), id);
  // Before the call, b and c are strangers to each other.
  expect(await knows(b, c.id)).toBe('');
  expect(await knows(c, b.id)).toBe('');

  const room = 'e2e-group-intro';
  for (const p of [a, b, c]) {
    await p.page.evaluate((r) => (window as any).__ringTest.startGroup(r, 'audio'), room);
  }

  // Every participant — including the non-contact b<->c leg — receives the other two.
  for (const p of [a, b, c]) {
    await p.page.waitForFunction(
      () => (window as any).__ringTest.remoteStreamCount() >= 2,
      null,
      { timeout: 60_000 },
    );
  }

  for (const p of [a, b, c]) {
    await p.page.evaluate(() => (window as any).__ringTest.hangup());
  }

  // Ephemeral: meshing with a stranger for one call never deposits them in your contacts.
  expect(await knows(b, c.id)).toBe('');
  expect(await knows(c, b.id)).toBe('');

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

/**
 * Late joiner: someone arriving after the call is underway must mesh with EVERYONE already
 * in it — they get all the existing feeds and each existing member gets theirs. Driven
 * purely by the roster broadcast: each side opens a fresh leg to the newcomer (and the
 * newcomer to each of them) when the roster grows.
 */
test('group call: a late joiner meshes with everyone already in the call', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'CALLLATE1');
  const b = await createAccount(ctxB, 'CALLLATE2');
  const c = await createAccount(ctxC, 'CALLLATE3');
  await pair(a, b);
  await pair(a, c);
  await pair(b, c);

  const room = 'e2e-group-late';
  // A and B start first and connect to each other.
  for (const p of [a, b]) {
    await p.page.evaluate((r) => (window as any).__ringTest.startGroup(r, 'audio'), room);
  }
  for (const p of [a, b]) {
    await p.page.waitForFunction(
      () => (window as any).__ringTest.remoteStreamCount() >= 1,
      null,
      { timeout: 60_000 },
    );
  }

  // C joins late — now everyone (including C) should end up with both others' feeds.
  await c.page.evaluate((r) => (window as any).__ringTest.startGroup(r, 'audio'), room);
  for (const p of [a, b, c]) {
    await p.page.waitForFunction(
      () => (window as any).__ringTest.remoteStreamCount() >= 2,
      null,
      { timeout: 60_000 },
    );
  }

  for (const p of [a, b, c]) {
    await p.page.evaluate(() => (window as any).__ringTest.hangup());
  }
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

/**
 * Active-speaker highlight: each tile is metered (Web Audio RMS of the DECODED audio),
 * and a tile whose level crosses the threshold is flagged as speaking for the UI ring.
 *
 * The load-bearing risk is that a remote WebRTC stream tapped by Web Audio can read as
 * silent if it isn't also rendered to a media element - and our metering runs on the
 * decoded, E2EE'd remote audio. This test proves the meter reads real energy from a
 * remote feed and that the speaking set surfaces (the fake media device emits a tone,
 * so the remote registers as speaking). Threshold tuning isn't asserted - just that the
 * pipeline reads decoded audio and drives the speaking flag.
 */
test('group call: active-speaker metering reads decoded remote audio', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'CALLSPK1');
  const b = await createAccount(ctxB, 'CALLSPK2');
  await pair(a, b);

  const room = 'e2e-group-speaker';
  for (const p of [a, b]) {
    await p.page.evaluate((r) => (window as any).__ringTest.startGroup(r, 'video'), room);
  }
  for (const p of [a, b]) {
    await p.page.waitForFunction(
      () => (window as any).__ringTest.remoteStreamCount() >= 1,
      null,
      { timeout: 60_000 },
    );
  }

  // The meter must read positive energy from the decoded remote audio (the silent-tap
  // failure mode would leave every remote level at 0 forever).
  for (const p of [a, b]) {
    await p.page.waitForFunction(
      () => {
        const t = (window as any).__ringTest;
        const levels = t.groupAudioLevels() as Record<string, number>;
        const remoteIds = t.remoteStreamIds() as string[];
        return remoteIds.some((id) => (levels[id] ?? 0) > 0);
      },
      null,
      { timeout: 30_000 },
    );
  }

  // ...and that energy drives the speaking set the UI ring binds to.
  for (const p of [a, b]) {
    await p.page.waitForFunction(
      () => ((window as any).__ringTest.activeSpeakers() as string[]).length > 0,
      null,
      { timeout: 30_000 },
    );
  }

  for (const p of [a, b]) {
    await p.page.evaluate(() => (window as any).__ringTest.hangup());
  }
  await ctxA.close();
  await ctxB.close();
});
