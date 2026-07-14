import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, accept, hangup, waitCallState, waitRemotes,
  acceptAndHold, heldCallId, type RingClient,
} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 2031 — inviting the HELD party into the active call and having them accept
// makes the old 1:1 between the same two people redundant: it must retire by
// itself on both sides the moment the invitee actually lands in the merged call
// (FR-001), and it logs as a normally-ended call, not missed (FR-003). The
// waiting-caller variant of the merge is covered by call-merge-consent.spec.ts;
// this file covers the HELD variant the field report came from. AUDIO only
// (headless CI constraint).

const mergeHeld = (c: RingClient): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.mergeHeld());
const acceptJoin = (c: RingClient): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.acceptJoinRequest());
const addPeople = (c: RingClient, ids: string[]): Promise<void> =>
  c.page.evaluate((x: string[]) => (window as any).__ringTest.addPeople(x), ids);
const isGroup = (c: RingClient): Promise<boolean> =>
  c.page.evaluate(() => !!(window as any).__ringTest.callMeta()?.isGroup);
const callRows = (c: RingClient): Promise<Array<{ contactId: string; missed: boolean }>> =>
  c.page.evaluate(() => (window as any).__ringTest.callRows());

const awaitJoinPrompt = (c: RingClient): Promise<unknown> =>
  c.page.waitForFunction(() => !!(window as any).__ringTest.joinRequest(), null, { timeout: 20_000 });
const awaitHeldGone = (c: RingClient): Promise<unknown> =>
  c.page.waitForFunction(() => (window as any).__ringTest.heldCallId() === null, null, { timeout: 15_000 });
// Mesh streams can land a beat BEFORE the server's roster broadcast updates the
// local roster array — poll for membership instead of asserting a snapshot.
const awaitRoster = (c: RingClient, ids: string[]): Promise<unknown> =>
  c.page.waitForFunction(
    (want: string[]) => {
      const r = (window as any).__ringTest.callRoster() as string[];
      return want.every((id) => r.includes(id));
    },
    ids,
    { timeout: 30_000 },
  );

/** A and B connected 1:1 (the call that will be parked); C calls A and A
 *  accepts-and-holds → active A↔C, held A↔B (B sees "on hold"). */
async function heldTrio(browser: any, codes: [string, string, string]) {
  const ctx = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [a, b, c] = await Promise.all(codes.map((code, i) => createAccount(ctx[i], code)));
  await pair(a, b); await pair(a, c); await pair(b, c);
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await waitCallState(b, ['connected']);
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => !!(window as any).__ringTest.hasSecondIncoming(), null, { timeout: 30_000 });
  await acceptAndHold(a);
  await waitCallState(c, ['connected']);
  await b.page.waitForFunction(() => (window as any).__ringTest.isRemoteHeld() === true, null, { timeout: 15_000 });
  return { ctx, a, b, c };
}

test('held party accepting the invite retires the redundant 1:1 on both sides (US1)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, a, b, c } = await heldTrio(browser, ['RET1A', 'RET1B', 'RET1C']);
  expect(await heldCallId(a)).not.toBeNull();

  // A invites the held B into the active A↔C call; B consents.
  await mergeHeld(a);
  await awaitJoinPrompt(b);
  await acceptJoin(b);

  // Everyone lands in one merged 3-way call…
  for (const p of [a, b, c]) await waitRemotes(p, 2);
  for (const p of [a, b, c]) await awaitRoster(p, [a.id, b.id, c.id]);

  // …and the redundant held 1:1 is gone from A (no swap pill), while B has only
  // the merged call (his old 1:1 dissolved into it on accept).
  await awaitHeldGone(a);
  expect(await heldCallId(b)).toBeNull();

  // FR-003: the retired 1:1 logged as a normal completed call on both sides.
  await a.page.waitForTimeout(3500); // let the deferred spec-1040 markers settle
  const aRows = (await callRows(a)).filter((r) => r.contactId === b.id);
  expect(aRows.length).toBeGreaterThan(0);
  expect(aRows.filter((r) => r.missed)).toEqual([]);
  expect((await callRows(b)).filter((r) => r.contactId === a.id && r.missed)).toEqual([]);

  for (const p of [a, b, c]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});

test('the retire also fires when the active call is already a group (the family-call shape)', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx4 = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const [a, b, c, d] = await Promise.all(
    ['RET2A', 'RET2B', 'RET2C', 'RET2D'].map((code, i) => createAccount(ctx4[i], code)),
  );
  await pair(a, b); await pair(a, c); await pair(a, d); await pair(c, d);

  // A↔B 1:1 (the call that gets parked), then C calls A → A accepts & holds.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await startCall(c, a.id, 'audio');
  await a.page.waitForFunction(() => !!(window as any).__ringTest.hasSecondIncoming(), null, { timeout: 30_000 });
  await acceptAndHold(a);
  await waitCallState(c, ['connected']);
  await b.page.waitForFunction(() => (window as any).__ringTest.isRemoteHeld() === true, null, { timeout: 15_000 });

  // Grow the ACTIVE call into a room (A, C, D) — the held 1:1 with B stays parked.
  await addPeople(a, [d.id]);
  await waitCallState(d, ['incoming']);
  await accept(d);
  for (const p of [a, c, d]) await waitRemotes(p, 2);
  expect(await isGroup(a)).toBe(true);
  expect(await heldCallId(a)).not.toBeNull();

  // Invite held B into the group; B accepts → 4-way, held 1:1 retires.
  await mergeHeld(a);
  await awaitJoinPrompt(b);
  await acceptJoin(b);
  for (const p of [a, b, c, d]) await waitRemotes(p, 3);
  await awaitHeldGone(a);
  expect(await heldCallId(b)).toBeNull();

  for (const p of [a, b, c, d]) await hangup(p);
  await Promise.all(ctx4.map((x) => x.close()));
});
