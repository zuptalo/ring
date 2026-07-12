import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, accept, hangup, waitCallState, waitRemotes,
} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1030, US1 — kind reconciliation after a merge. A merged/promoted call that
// still fits the video cap is VIDEO-CAPABLE: the per-participant "Turn on video"
// control works, and turning it on enables ONLY that person's camera (no
// auto-camera, no room-wide consent). Past the cap it refuses. AUDIO mesh with a
// single video publisher (the full multi-camera video RESULT is drive/real-device
// — see drive/scenarios/merge-video.mjs).

const startDial = (c: any, peer: string): Promise<void> =>
  c.page.evaluate((p: string) => (window as any).__ringTest.startCall(p, 'audio'), peer);
const mergeIncoming = (c: any): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.mergeIncoming());
const toggleVideo = (c: any): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.toggleVideo());
const callKind = (c: any): Promise<string> =>
  c.page.evaluate(() => (window as any).__ringTest.callMeta()?.kind);
const localVideoTracks = (c: any): Promise<number> =>
  c.page.evaluate(() => (window as any).__ringTest.localVideoTracks());

const awaitJoinPrompt = (c: any): Promise<unknown> =>
  c.page.waitForFunction(() => !!(window as any).__ringTest.joinRequest(), null, { timeout: 20_000 });
const acceptJoin = (c: any): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.acceptJoinRequest());
const setCaps = (c: any, video?: number, audio?: number): Promise<void> =>
  c.page.evaluate(([v, x]: (number | undefined)[]) => (window as any).__ringTest.setCallCaps(v, x), [video, audio]);
const noticeSeen = (c: any, needle: string): Promise<unknown> =>
  c.page.waitForFunction(
    (t: string) => ((window as any).__ringTest.notices() as { body: string }[]).some((n) => (n.name + n.body).includes(t)),
    needle, { timeout: 15_000 },
  );

async function mergedAudioTrio(browser: any, codes: [string, string, string]) {
  const ctx = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [a, b, c] = await Promise.all(codes.map((code, i) => createAccount(ctx[i], code)));
  await pair(a, b); await pair(a, c); await pair(b, c);
  // A and B in a 1:1 audio call; C calls A; A merges C in → 3-way audio mesh.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await startDial(c, a.id);
  await a.page.waitForFunction(() => !!(window as any).__ringTest.hasSecondIncoming(), null, { timeout: 30_000 });
  await mergeIncoming(a); // spec 1041: now a consent-gated request…
  await awaitJoinPrompt(c);
  await acceptJoin(c); // …which C accepts
  for (const p of [a, b, c]) await waitRemotes(p, 2);
  return { ctx, a, b, c };
}

test('a merged call ≤ the video cap is video-capable per participant — no auto-camera (US1)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, a, b, c } = await mergedAudioTrio(browser, ['MKA1', 'MKA2', 'MKA3']);

  // The merged call is an audio GROUP of 3 (≤ 4) → video-capable: the existing
  // per-participant control works for one participant…
  expect(await callKind(a)).toBe('audio');
  await toggleVideo(a);
  await a.page.waitForFunction(() => (window as any).__ringTest.callMeta()?.kind === 'video', null, { timeout: 15_000 });
  expect(await localVideoTracks(a)).toBe(1); // A's own camera is on

  // …and does NOT touch anyone else's camera: B and C stay audio, zero local
  // video tracks, and their own "Turn on video" control still applies (kind audio).
  await a.page.waitForTimeout(1500); // give a (wrong) auto-enable time to happen
  for (const p of [b, c]) {
    expect(await callKind(p)).toBe('audio');
    expect(await localVideoTracks(p)).toBe(0);
  }

  for (const p of [a, b, c]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});

test('a merged call past the video cap stays audio-only — turning on video is refused (US1)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, a, b, c } = await mergedAudioTrio(browser, ['MKB1', 'MKB2', 'MKB3']);

  // Shrink the CLIENT video cap to 2 so this 3-person call is "past the cap"
  // without spinning up 5 browsers (mirrors the server's call-config override).
  await setCaps(a, 2, undefined);
  await toggleVideo(a);
  await noticeSeen(a, 'Video is limited to 2 people'); // refused with the cap reason
  expect(await callKind(a)).toBe('audio'); // still audio-only…
  expect(await localVideoTracks(a)).toBe(0); // …and no camera was enabled

  for (const p of [a, b, c]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});
