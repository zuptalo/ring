import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, startGroup, accept, hangup, waitCallState, waitRemotes,
  hasSecondIncoming, acceptAndHold, endHeld, rejectSecond, setCallConfig, resetCallConfig,
} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1030, US3 — merge an incoming GROUP invite: "Add to call" now applies to a
// group invite arriving mid-call, folding its people into the CURRENT call
// (promoting a 1:1 first), deduping a member present in both, and leaving the
// invite's own room (FR-008). An over-cap fold is blocked with a reason and both
// calls stay untouched (FR-007). AUDIO only (headless CI constraint).

const mergeGroupInvite = (c: any): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.mergeGroupInvite());
const isGroup = (c: any): Promise<boolean> =>
  c.page.evaluate(() => !!(window as any).__ringTest.callMeta()?.isGroup);
const roomOf = (c: any): Promise<string | undefined> =>
  c.page.evaluate(() => (window as any).__ringTest.callMeta()?.roomId);
const rosterOf = (c: any): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.callRoster());
const invitedOf = (c: any): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.callInvited());
const setCaps = (c: any, video?: number, audio?: number): Promise<void> =>
  c.page.evaluate(([v, x]: (number | undefined)[]) => (window as any).__ringTest.setCallCaps(v, x), [video, audio]);
const waitSecondIncoming = (c: any): Promise<unknown> =>
  c.page.waitForFunction(() => !!(window as any).__ringTest.hasSecondIncoming(), null, { timeout: 30_000 });
const noticeSeen = (c: any, needle: string): Promise<unknown> =>
  c.page.waitForFunction(
    (t: string) => ((window as any).__ringTest.notices() as { body: string }[]).some((n) => (n.name + n.body).includes(t)),
    needle, { timeout: 15_000 },
  );

test.afterEach(async () => {
  await resetCallConfig();
});

test('folding a group invite brings its people into the current call, dedups a shared member, and leaves the invite room (US3)', async ({ browser }) => {
  test.setTimeout(180_000);
  // Fast re-ring so "the server stopped ringing us for the folded room" is
  // observable in seconds: if A had NOT left the invite's room, the next reminder
  // round would re-raise the prompt below.
  await setCallConfig({ ringIntervalMs: 1500, ringCount: 5 });
  const ctx = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [a, b, c] = await Promise.all([
    createAccount(ctx[0], 'GMA1'),
    createAccount(ctx[1], 'GMA2'),
    createAccount(ctx[2], 'GMA3'),
  ]);
  await pair(a, b); await pair(a, c); await pair(b, c);

  // A and B in a 1:1 audio call.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);

  // C starts a group call inviting BOTH A and B (B is the shared member — already
  // in A's call). Both get the second-incoming prompt (new in 1030: no auto-busy).
  const inviteRoom = 'e2e-group-merge-src';
  await startGroup(c, inviteRoom, 'audio', [a.id, b.id]);
  await waitSecondIncoming(a);
  await waitSecondIncoming(b);
  await rejectSecond(b); // B ignores its copy; A does the folding

  // A folds the invite into the current call: 1:1 promoted, C rung into A's room,
  // B deduped (already present), A leaves the invite's room.
  await mergeGroupInvite(a);

  // C, still alone in its own room, is rung for A's room and joins it (holding,
  // then dropping, its now-empty original room).
  await waitSecondIncoming(c);
  await acceptAndHold(c);
  await endHeld(c).catch(() => {});

  // Everyone converges in A's ONE combined call.
  for (const p of [a, b, c]) await waitRemotes(p, 2);
  expect(await isGroup(a)).toBe(true);
  expect(await isGroup(b)).toBe(true);
  const mergedRoom = await roomOf(a);
  expect(mergedRoom).not.toBe(inviteRoom); // folded INTO A's call, not into C's room (FR-008)
  for (const p of [a, b, c]) {
    const r = await rosterOf(p);
    for (const id of [a.id, b.id, c.id]) expect(r).toContain(id);
    expect(new Set(r).size).toBe(r.length); // no duplicate participants
  }
  // The shared member B was never re-rung: only C was invited into A's room.
  expect(await invitedOf(a)).not.toContain(b.id);

  // FR-008: A left the invite's room — with the fast re-ring config, a still-live
  // membership would re-raise the prompt within ~2s. It must not.
  await a.page.waitForTimeout(4000);
  expect(await hasSecondIncoming(a)).toBe(false);
  expect(await roomOf(a)).toBe(mergedRoom);

  for (const p of [a, b, c]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});

test('an over-cap group fold is blocked with a clear reason and both calls stay unchanged (US3)', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const [a, b, c, d] = await Promise.all([
    createAccount(ctx[0], 'GMB1'),
    createAccount(ctx[1], 'GMB2'),
    createAccount(ctx[2], 'GMB3'),
    createAccount(ctx[3], 'GMB4'),
  ]);
  await pair(a, b); await pair(a, c); await pair(a, d); await pair(c, d);

  // A and B in a 1:1 audio call; A's client audio cap shrunk to 3 (mirrors the
  // server override) so C's 2-newcomer invite (C + D) won't fit: 2 + 2 = 4 > 3.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await setCaps(a, undefined, 3);

  const inviteRoom = 'e2e-group-merge-cap';
  await startGroup(c, inviteRoom, 'audio', [a.id, d.id]);
  await a.page.waitForFunction(() => !!(window as any).__ringTest.hasSecondIncoming(), null, { timeout: 30_000 });

  // The fold is blocked with the kind-specific cap reason…
  await mergeGroupInvite(a);
  await noticeSeen(a, 'Audio calls are limited to 3 people');
  // …and BOTH calls are exactly as they were: A still in the 1:1 with B (never
  // promoted), the invite still in the waiting slot (Hold/Decline still work),
  // and C's own room untouched.
  expect(await isGroup(a)).toBe(false);
  expect(await hasSecondIncoming(a)).toBe(true);
  expect(await a.page.evaluate(() => (window as any).__ringTest.callMeta()?.peerUserId)).toBe(b.id);
  expect(await a.page.evaluate(() => (window as any).__ringTest.callState())).toBe('connected');
  expect(await roomOf(c)).toBe(inviteRoom);

  await rejectSecond(a);
  await hangup(a);
  await hangup(b).catch(() => {});
  await hangup(c).catch(() => {});
  await Promise.all(ctx.map((x) => x.close()));
});
