import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, startGroup, accept, hangup, waitCallState, waitRemotes,
  waitHook, goOffline, setCallConfig, resetCallConfig, callState,
} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1030, US5 — growing a call converges under churn: a join racing a leave,
// two people adding the SAME person at once (one participant, one leg), an
// invitee reloading mid-ring (spec-2012 recovery), and a promotion whose peer
// never follows (clean end via the lone-in-the-room timeout — no stuck ringing,
// no orphans). AUDIO meshes only (headless CI constraint).

const addPeople = (c: any, ids: string[]): Promise<void> =>
  c.page.evaluate((x: string[]) => (window as any).__ringTest.addPeople(x), ids);
const waitIncoming = (c: any): Promise<void> =>
  c.page.waitForFunction(() => (window as any).__ringTest.callState() === 'incoming', null, { timeout: 30_000 });
const rosterOf = (c: any): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.callRoster());
const remoteStreams = (c: any): Promise<number> =>
  c.page.evaluate(() => (window as any).__ringTest.remoteStreamCount());

/** Poll until the client's roster is exactly `ids` (set-equal, no duplicates). */
async function waitRoster(c: any, ids: string[], timeout = 30_000): Promise<void> {
  await c.page.waitForFunction(
    (want: string[]) => {
      const r = (window as any).__ringTest.callRoster() as string[];
      return r.length === want.length && want.every((id) => r.includes(id)) && new Set(r).size === r.length;
    },
    ids, { timeout },
  );
}

test.afterEach(async () => {
  await resetCallConfig();
});

test('a join racing a leave converges to the correct roster on every device (US5)', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const [a, b, c, d] = await Promise.all([
    createAccount(ctx[0], 'CHA1'), createAccount(ctx[1], 'CHA2'),
    createAccount(ctx[2], 'CHA3'), createAccount(ctx[3], 'CHA4'),
  ]);
  await pair(a, b); await pair(a, c); await pair(a, d);
  await pair(b, c); await pair(b, d); await pair(c, d);

  const room = 'e2e-churn-joinleave';
  await startGroup(a, room, 'audio');
  await startGroup(b, room, 'audio');
  await startGroup(c, room, 'audio');
  for (const p of [a, b, c]) await waitRemotes(p, 2);

  // D is rung in while C leaves — fired in the same instant.
  await Promise.all([addPeople(a, [d.id]), hangup(c)]);
  await waitIncoming(d);
  await accept(d);

  // Every remaining device converges to exactly {A, B, D}: no stuck tile for C,
  // no duplicate, and the mesh is fully connected.
  for (const p of [a, b, d]) await waitRoster(p, [a.id, b.id, d.id]);
  for (const p of [a, b, d]) await waitRemotes(p, 2);
  expect(await callState(c)).toMatch(/idle|ended/);

  for (const p of [a, b, d]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});

test('two participants adding the SAME person at once resolve to one participant with one leg (US5)', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const [a, b, c, d] = await Promise.all([
    createAccount(ctx[0], 'CHB1'), createAccount(ctx[1], 'CHB2'),
    createAccount(ctx[2], 'CHB3'), createAccount(ctx[3], 'CHB4'),
  ]);
  await pair(a, b); await pair(a, c); await pair(a, d);
  await pair(b, c); await pair(b, d); await pair(c, d);

  const room = 'e2e-churn-dupadd';
  await startGroup(a, room, 'audio');
  await startGroup(b, room, 'audio');
  await startGroup(c, room, 'audio');
  for (const p of [a, b, c]) await waitRemotes(p, 2);

  // A and B add D simultaneously.
  await Promise.all([addPeople(a, [d.id]), addPeople(b, [d.id])]);
  await waitIncoming(d);
  await accept(d);

  // D is ONE participant everywhere: exactly one roster entry, one leg per pair
  // (each of the 4 sees exactly 3 remote streams — not 4).
  for (const p of [a, b, c, d]) await waitRoster(p, [a.id, b.id, c.id, d.id]);
  for (const p of [a, b, c, d]) await waitRemotes(p, 3);
  expect(await remoteStreams(a)).toBe(3);
  expect(await remoteStreams(d)).toBe(3);

  for (const p of [a, b, c, d]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});

test('an invitee reloading mid-ring returns, is re-rung, and joins cleanly with no duplicate (US5)', async ({ browser }) => {
  test.setTimeout(180_000);
  // Fast reminder rounds so the reloaded invitee is re-rung within seconds.
  await setCallConfig({ ringIntervalMs: 1500, ringCount: 8 });
  const ctx = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [a, b, c] = await Promise.all([
    createAccount(ctx[0], 'CHC1'), createAccount(ctx[1], 'CHC2'), createAccount(ctx[2], 'CHC3'),
  ]);
  await pair(a, b); await pair(a, c); await pair(b, c);

  const room = 'e2e-churn-reload';
  await startGroup(a, room, 'audio');
  await startGroup(b, room, 'audio');
  for (const p of [a, b]) await waitRemotes(p, 1);

  await addPeople(a, [c.id]);
  await waitIncoming(c);

  // C reloads mid-ring (app killed and reopened). Device-key auto-unlock brings
  // the hook back; the server's reminder round (spec 2012 recovery) re-rings C.
  await c.page.reload();
  await waitHook(c.page);
  await waitIncoming(c);
  await accept(c);

  // C joins exactly once; everyone converges with no duplicate or stuck tile.
  for (const p of [a, b, c]) await waitRoster(p, [a.id, b.id, c.id]);
  for (const p of [a, b, c]) await waitRemotes(p, 2);

  for (const p of [a, b, c]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});

test('a promotion whose peer never follows (and nobody joins) ends cleanly via the idle timeout (US5)', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [a, b, d] = await Promise.all([
    createAccount(ctx[0], 'CHD1'), createAccount(ctx[1], 'CHD2'), createAccount(ctx[2], 'CHD3'),
  ]);
  await pair(a, b); await pair(a, d);

  // A and B in a 1:1 audio call.
  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);

  // Shrink A's lone-in-the-room window so the test runs in seconds (prod: 60s).
  await a.page.evaluate(() => (window as any).__ringTest.setGroupIdleMs(5000));

  // B drops off the network, so the sealed `joinroom` never reaches it — the
  // promoted peer NEVER follows. A promotes by adding D, who never answers.
  await goOffline(b);
  await addPeople(a, [d.id]);

  // The half-formed room (A alone, D ringing, B never following) must end
  // CLEANLY on the idle timeout: back to idle (past the ended dwell), no stuck
  // ringing tile, no orphan.
  await waitCallState(a, ['idle'], 30_000);
  expect(await a.page.evaluate(() => (window as any).__ringTest.callMeta())).toBeFalsy();
  expect(await a.page.evaluate(() => (window as any).__ringTest.hasSecondIncoming())).toBe(false);

  // D's phantom ring dies with the room (server-side give-up); just tidy up.
  await d.page.evaluate(() => (window as any).__ringTest.reject()).catch(() => {});
  await Promise.all(ctx.map((x) => x.close()));
});
