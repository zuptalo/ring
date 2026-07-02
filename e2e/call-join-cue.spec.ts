import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startGroup, hangup, waitRemotes, goOffline, goOnline,
} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1030, US2 — the join cue. When a genuinely-new participant joins a call,
// every EXISTING participant sees a "{name} joined the call" cue; nobody sees a
// cue for their own arrival, and a reconnect (which doesn't change the server
// roster) never re-fires one. AUDIO mesh (headless CI can't run a 3+ person
// video mesh). The cue history is read via the dev joinCues hook (the visible
// banner is asserted once, on the adder, while it's still on screen).

const addPeople = (c: any, ids: string[]): Promise<void> =>
  c.page.evaluate((x: string[]) => (window as any).__ringTest.addPeople(x), ids);
const acceptCall = (c: any): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.accept());
const waitIncoming = (c: any): Promise<void> =>
  c.page.waitForFunction(() => (window as any).__ringTest.callState() === 'incoming', null, { timeout: 30_000 });
const joinCues = (c: any): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.joinCues());

test('every existing participant sees a "joined the call" cue — never for self or a reconnect (US2)', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const [a, b, c, d] = await Promise.all([
    createAccount(ctx[0], 'CUE01'),
    createAccount(ctx[1], 'CUE02'),
    createAccount(ctx[2], 'CUE03'),
    createAccount(ctx[3], 'CUE04'),
  ]);
  await pair(a, b); await pair(a, c); await pair(a, d);
  await pair(b, c); await pair(b, d); await pair(c, d);

  // A, B, C form a group audio call.
  const room = 'e2e-join-cue';
  await startGroup(a, room, 'audio');
  await startGroup(b, room, 'audio');
  await startGroup(c, room, 'audio');
  for (const p of [a, b, c]) await waitRemotes(p, 2);

  // A adds D. While D's join propagates, watch A's banner surface for the visible
  // cue text (it only stays up ~3.5s, so the watcher is armed BEFORE the join).
  const bannerSeen = a.page.waitForFunction(
    () => ((window as any).__ringTest.notices() as { body: string }[])
      .some((n) => (n.name + n.body).includes('joined the call')),
    null, { timeout: 30_000 },
  );
  await addPeople(a, [d.id]);
  await waitIncoming(d);
  await acceptCall(d);
  await bannerSeen; // the cue was actually shown to the user (FR-004)

  // Every EXISTING participant announced D — including the non-adders B and C.
  for (const p of [a, b, c]) {
    await p.page.waitForFunction(
      (id: string) => ((window as any).__ringTest.joinCues() as string[]).includes(id),
      d.id, { timeout: 30_000 },
    );
  }

  // The joiner sees no cue for their own arrival, nor for the people they walked
  // in on (they were already in the call) — FR-005.
  for (const p of [a, b, c, d]) await waitRemotes(p, 3);
  expect(await joinCues(d)).toEqual([]);
  // And nobody ever announces themselves.
  for (const p of [a, b, c, d]) expect(await joinCues(p)).not.toContain(p.id);

  // A reconnect is NOT a new arrival: bounce B's transport; after B's legs recover,
  // nobody's cue history has changed (the server roster membership never changed).
  const cuesA = await joinCues(a);
  const cuesC = await joinCues(c);
  await goOffline(b);
  await b.page.waitForTimeout(1500);
  await goOnline(b);
  await waitRemotes(b, 3); // B's mesh recovered
  await b.page.waitForTimeout(1000); // let any (wrong) cue land before we look
  expect(await joinCues(a)).toEqual(cuesA);
  expect(await joinCues(c)).toEqual(cuesC);

  for (const p of [a, b, c, d]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});
