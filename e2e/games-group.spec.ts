/**
 * Group game challenges (spec 0009 US1): an open challenge, first-to-accept
 * seating, quiet read-only observers, deterministic accept races across an
 * offline gap (the seq-1 seat lock), cancel, leave-resigns, and the one-game
 * gate. Three real accounts over the pairwise group fan-out, driven through
 * window.__ringTest like games.spec.ts / group-seen-receipts.spec.ts.
 */
import { test, expect, type Browser } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

async function setProfile(c: RingClient, name: string): Promise<void> {
  await c.page.evaluate(([n, av]: [string, string]) => (window as any).__ringTest.setProfile(n, av), [name, AVATAR]);
}

async function awaitGroup(c: RingClient, gid: string): Promise<void> {
  await c.page.waitForFunction(
    (id) => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.some((g) => g.id === id)),
    gid,
    { timeout: 30_000 },
  );
}

async function setupTrio(browser: Browser, codes: [string, string, string]) {
  const ctx = [await browser.newContext(), await browser.newContext(), await browser.newContext()];
  const a = await createAccount(ctx[0], codes[0]);
  const b = await createAccount(ctx[1], codes[1]);
  const c = await createAccount(ctx[2], codes[2]);
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');
  await setProfile(c, 'Carol');
  await pair(a, b);
  await pair(a, c);
  const gid = (await a.page.evaluate(
    (ids) => (window as any).__ringTest.createGroup('Arena', ids),
    [b.id, c.id],
  )) as string;
  await awaitGroup(b, gid);
  await awaitGroup(c, gid);
  return { a, b, c, gid, ctx };
}

const gameInfo = (p: RingClient, mid: string): Promise<any> =>
  p.page.evaluate((id: string) => (window as any).__ringTest.gameInfo(id), mid);

const accept = (p: RingClient, mid: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.acceptGameChallenge(id), mid);

const move = (p: RingClient, gid: string, mid: string, cell: number) =>
  p.page.evaluate(
    (a: { gid: string; mid: string; cell: number }) =>
      (window as any).__ringTest.playGameMove(a.gid, a.mid, { cell: a.cell }),
    { gid, mid, cell },
  );

/** Start a challenge on `starter` and wait until every listed device holds it. */
async function startChallenge(starter: RingClient, gid: string, everyone: RingClient[]): Promise<string> {
  const mid = (await starter.page.evaluate(
    (id: string) => (window as any).__ringTest.sendGameChallenge(id, 'tictactoe', 'space'),
    gid,
  )) as string;
  for (const p of everyone) {
    await p.page.waitForFunction(
      async (args: { gid: string; mid: string }) => {
        const ms = await (window as any).__ringTest.messages(args.gid);
        return ms.some((m: any) => m.id === args.mid && m.kind === 'gamechallenge');
      },
      { gid, mid },
      { timeout: 30_000 },
    );
  }
  return mid;
}

test('challenge → first accept seats → observers watch read-only → win for all; cancel; gate', async ({ browser }) => {
  const { a, b, c, gid, ctx } = await setupTrio(browser, ['RINGGC1', 'RINGGC2', 'RINGGC3']);

  const mid = await startChallenge(a, gid, [a, b, c]);

  // Open on every device, challenger seated alone, gate engaged.
  for (const p of [a, b, c]) {
    const g = await gameInfo(p, mid);
    expect(g.phase).toBe('open');
    expect(g.players).toEqual([a.id]);
  }
  await expect
    .poll(() => a.page.evaluate((id: string) => (window as any).__ringTest.hasOngoingGame(id), gid))
    .toBe(true);

  // The creator cannot take their own challenge.
  await accept(a, mid);
  expect((await gameInfo(a, mid)).phase).toBe('open');

  // B accepts → everyone converges on Bob as the opponent.
  await accept(b, mid);
  for (const p of [a, b, c]) {
    await expect.poll(async () => (await gameInfo(p, mid)).opponent, { timeout: 30_000 }).toBe(b.id);
  }

  // Carol is an observer: her taps do nothing, before and after play starts.
  await move(c, gid, mid, 4);
  expect((await gameInfo(c, mid)).moves).toBe(0);

  // Alice (challenger, player 0) opens play — the seq-1 lock pins Bob's seat.
  await move(a, gid, mid, 4);
  await expect.poll(async () => (await gameInfo(b, mid)).moves, { timeout: 30_000 }).toBe(1);
  await expect.poll(async () => (await gameInfo(c, mid)).moves, { timeout: 30_000 }).toBe(1);
  await move(c, gid, mid, 0); // observer still can't move mid-game
  expect((await gameInfo(c, mid)).moves).toBe(1);

  // Play to Alice's win: 4,0,1 vs Bob's 3,5 — wait, row win 0-1-2 with 4 first:
  // A: 4, 0, 8 (diagonal 0-4-8) vs B: 3, 5.
  await move(b, gid, mid, 3);
  await expect.poll(async () => (await gameInfo(a, mid)).moves, { timeout: 30_000 }).toBe(2);
  await move(a, gid, mid, 0);
  await expect.poll(async () => (await gameInfo(b, mid)).moves, { timeout: 30_000 }).toBe(3);
  await move(b, gid, mid, 5);
  await expect.poll(async () => (await gameInfo(a, mid)).moves, { timeout: 30_000 }).toBe(4);
  await move(a, gid, mid, 8); // 0-4-8

  // The result reaches players AND the observer identically.
  for (const p of [a, b, c]) {
    await expect
      .poll(async () => (await gameInfo(p, mid)).status, { timeout: 30_000 })
      .toEqual({ state: 'won', winner: 0 });
  }
  // Gate freed → a fresh open challenge (the group rematch) can start…
  await expect
    .poll(() => c.page.evaluate((id: string) => (window as any).__ringTest.hasOngoingGame(id), gid), { timeout: 15_000 })
    .toBe(false);

  // …and the creator can withdraw an untaken challenge for everyone.
  const mid2 = await startChallenge(b, gid, [a, b, c]);
  await b.page.evaluate((id: string) => (window as any).__ringTest.cancelGameChallenge(id), mid2);
  for (const p of [a, b, c]) {
    await expect.poll(async () => (await gameInfo(p, mid2)).phase, { timeout: 30_000 }).toBe('cancelled');
  }
  await expect
    .poll(() => a.page.evaluate((id: string) => (window as any).__ringTest.hasOngoingGame(id), gid), { timeout: 15_000 })
    .toBe(false);

  for (const x of ctx) await x.close();
});

test('accept race across an offline gap converges via the seat lock; a leaving player resigns', async ({ browser }) => {
  const { a, b, c, gid, ctx } = await setupTrio(browser, ['RINGGC4', 'RINGGC5', 'RINGGC6']);

  const mid = await startChallenge(a, gid, [a, b, c]);

  // Carol goes offline and accepts FIRST (earlier timestamp, queued unsent).
  await c.page.evaluate(() => (window as any).__ringTest.disconnect());
  await accept(c, mid);
  await new Promise((r) => setTimeout(r, 400)); // ensure Bob's stamp is strictly later
  await accept(b, mid);

  // Alice sees only Bob's accept and starts play — the seq-1 lock closes the race.
  await expect.poll(async () => (await gameInfo(a, mid)).opponent, { timeout: 30_000 }).toBe(b.id);
  await move(a, gid, mid, 4);

  // Carol reconnects: her earlier accept arrives late and loses; every device
  // (including hers) agrees the seat is Bob's.
  await c.page.evaluate(() => (window as any).__ringTest.reconnect());
  for (const p of [a, b, c]) {
    await expect.poll(async () => (await gameInfo(p, mid)).players, { timeout: 30_000 }).toEqual([a.id, b.id]);
  }

  // Mid-game, the seated opponent leaves the group → the game ends as Bob's
  // resignation on every remaining device, from the shared roster card alone.
  await expect.poll(async () => (await gameInfo(b, mid)).moves, { timeout: 30_000 }).toBe(1);
  await b.page.evaluate((id: string) => (window as any).__ringTest.leaveGroup(id), gid);
  for (const p of [a, c]) {
    await expect
      .poll(async () => (await gameInfo(p, mid)).status, { timeout: 30_000 })
      .toEqual({ state: 'resigned', winner: 0 });
  }

  for (const x of ctx) await x.close();
});
