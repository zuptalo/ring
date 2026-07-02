import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startGroup, hangup, waitRemotes, remoteStreamCount, roster,
} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1028, US2 — add people to an ongoing GROUP call (the MVP add path; no 1:1
// promotion yet). An existing participant rings a NEW person into the room; on
// accept they mesh with EVERYONE already in the call, not just the inviter. AUDIO
// mesh only (headless CI can't run a 3+ person video mesh — see call-quality.spec).

const addPeople = (c: any, ids: string[]): Promise<void> =>
  c.page.evaluate((x: string[]) => (window as any).__ringTest.addPeople(x), ids);
const acceptCall = (c: any): Promise<void> =>
  c.page.evaluate(() => (window as any).__ringTest.accept());
const waitIncoming = (c: any): Promise<void> =>
  c.page.waitForFunction(() => (window as any).__ringTest.callState() === 'incoming', null, { timeout: 30_000 });

test('add a new person to an ongoing group audio call — they mesh with everyone (US2)', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const [a, b, c, d] = await Promise.all([
    createAccount(ctx[0], 'ADD01'),
    createAccount(ctx[1], 'ADD02'),
    createAccount(ctx[2], 'ADD03'),
    createAccount(ctx[3], 'ADD04'),
  ]);
  // Full pairing so every leg has a ratchet (the same-room key gate would also
  // cover it, but explicit pairs keep the mesh deterministic under CI load).
  await pair(a, b); await pair(a, c); await pair(a, d);
  await pair(b, c); await pair(b, d); await pair(c, d);

  // A, B, C are in a 3-way group audio call.
  const room = 'e2e-add-people';
  await startGroup(a, room, 'audio');
  await startGroup(b, room, 'audio');
  await startGroup(c, room, 'audio');
  for (const p of [a, b, c]) await waitRemotes(p, 2);

  // A adds D. D rings, accepts, and joins the mesh.
  await addPeople(a, [d.id]);
  await waitIncoming(d);
  await acceptCall(d);

  // Everyone — including the non-initiators B and C — ends up meshed with all 3 others.
  for (const p of [a, b, c, d]) await waitRemotes(p, 3);
  expect(await remoteStreamCount(b)).toBeGreaterThanOrEqual(3); // B (not the adder) sees D
  expect((await roster(b))).toContain(d.id); // B knows about the newly-added D
  const rd = await roster(d);
  for (const id of [a.id, b.id, c.id]) expect(rd).toContain(id); // D is meshed with all three

  for (const p of [a, b, c, d]) await hangup(p);
  await Promise.all(ctx.map((x) => x.close()));
});
