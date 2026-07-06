/**
 * Battleship (spec 0011): hidden fleets over the unchanged platform. Proves
 * SC-001 (a full verified game converging, incl. an offline gap), SC-002 (the
 * opponent device provably never holds your layout before the reveal), the
 * real auto-answer flow through a mounted board, and SC-004 (group observers
 * see the battle, never the fleets).
 */
import { test, expect, type Browser } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The unit suite's fixed fleets.
const L0 = [
  { r: 0, c: 0, len: 4, dir: 'h' }, { r: 2, c: 0, len: 3, dir: 'h' },
  { r: 4, c: 0, len: 3, dir: 'h' }, { r: 6, c: 0, len: 2, dir: 'h' },
];
const L1 = [
  { r: 0, c: 7, len: 4, dir: 'v' }, { r: 0, c: 5, len: 3, dir: 'v' },
  { r: 4, c: 5, len: 3, dir: 'v' }, { r: 6, c: 3, len: 2, dir: 'h' },
];
const cellsOf = (s: any): number[] =>
  Array.from({ length: s.len }, (_, i) => (s.dir === 'h' ? s.r * 8 + s.c + i : (s.r + i) * 8 + s.c));
const T1 = L1.flatMap(cellsOf); // P0's hunting list

const gameInfo = (p: RingClient, mid: string): Promise<any> =>
  p.page.evaluate((id: string) => (window as any).__ringTest.gameInfo(id), mid);
const raw = (p: RingClient, mid: string): Promise<any> =>
  p.page.evaluate((id: string) => (window as any).__ringTest.gameSessionRaw(id), mid);
const play = (p: RingClient, chat: string, mid: string, move: unknown): Promise<void> =>
  p.page.evaluate(
    (a: { chat: string; mid: string; move: unknown }) =>
      (window as any).__ringTest.playGameMove(a.chat, a.mid, a.move),
    { chat, mid, move },
  );
const judge = (p: RingClient, layout: any, cell: number, hits: number[]): Promise<'miss' | 'hit' | 'sunk'> =>
  p.page.evaluate(
    (a: { layout: any; cell: number; hits: number[] }) =>
      (window as any).__ringTest.battleshipJudge(a.layout, a.cell, a.hits),
    { layout, cell, hits },
  );

async function setupGame(browser: Browser, codes: [string, string]) {
  const ctxs = [await browser.newContext(), await browser.newContext()];
  const a = await createAccount(ctxs[0], codes[0]);
  const b = await createAccount(ctxs[1], codes[1]);
  await pair(a, b);
  const aChat = (await a.page.evaluate((id) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  const bChat = (await b.page.evaluate((id) => (window as any).__ringTest.chatWith(id), a.id)) as string;
  const mid = (await a.page.evaluate(
    (chat: string) => (window as any).__ringTest.sendGame(chat, 'battleship', 'pirates'),
    aChat,
  )) as string;
  await b.page.waitForFunction(
    async (arg: { chat: string; mid: string }) => {
      const ms = await (window as any).__ringTest.messages(arg.chat);
      return ms.some((m: any) => m.id === arg.mid);
    },
    { chat: bChat, mid },
    { timeout: 30_000 },
  );
  return { a, b, aChat, bChat, mid, ctxs };
}

test('a full verified game: commitments, shots, forced reveals — and the loser device never held the winner layout', async ({ browser }) => {
  const { a, b, aChat, bChat, mid, ctxs } = await setupGame(browser, ['RINGBS1', 'RINGBS2']);

  await a.page.evaluate(
    (arg: { chat: string; mid: string; layout: any }) =>
      (window as any).__ringTest.battleshipCommit(arg.chat, arg.mid, arg.layout, 'c2FsdDA'),
    { chat: aChat, mid, layout: L0 },
  );
  await expect.poll(async () => (await gameInfo(b, mid))?.moves, { timeout: 30_000 }).toBe(1);
  await b.page.evaluate(
    (arg: { chat: string; mid: string; layout: any }) =>
      (window as any).__ringTest.battleshipCommit(arg.chat, arg.mid, arg.layout, 'c2FsdDE'),
    { chat: bChat, mid, layout: L1 },
  );
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(2);

  // SC-002: mid-placing, NEITHER stored session contains any layout data —
  // only opaque commitments. (The string 'layout' appears only in reveals.)
  for (const p of [a, b]) {
    const json = JSON.stringify(await raw(p, mid));
    expect(json).not.toContain('"layout"');
    expect(json).not.toContain('"dir"');
  }

  // A hunts B's 12 cells; B answers honestly (its own layout) and fires misses
  // back; a mid-game offline gap converges from the queue.
  let moves = 2;
  let bHits: number[] = [];
  for (let i = 0; i < T1.length; i++) {
    const cell = T1[i];
    if (i === 5) await b.page.evaluate(() => (window as any).__ringTest.disconnect());
    await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(moves);
    await play(a, aChat, mid, { t: 'shot', cell });
    moves += 1;
    if (i === 5) await b.page.evaluate(() => (window as any).__ringTest.reconnect());
    await expect.poll(async () => (await gameInfo(b, mid))?.moves, { timeout: 30_000 }).toBe(moves);
    const r = await judge(b, L1, cell, bHits);
    if (r !== 'miss') bHits = [...bHits, cell];
    if (bHits.length === 12) {
      await play(b, bChat, mid, { t: 'answer', r: 'sunk', reveal: { layout: L1, salt: 'c2FsdDE' } });
      moves += 1;
      break;
    }
    await play(b, bChat, mid, { t: 'answer', r });
    moves += 1;
    // B's return shot into A's open water (rows 5 and 7 are empty in L0 —
    // sixteen safe cells cover the eleven return shots).
    const WATER = [56, 57, 58, 59, 60, 61, 62, 63, 40, 41, 42, 43, 44, 45, 46, 47];
    await expect.poll(async () => (await gameInfo(b, mid))?.moves, { timeout: 30_000 }).toBe(moves);
    await play(b, bChat, mid, { t: 'shot', cell: WATER[i] });
    moves += 1;
    await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(moves);
    await play(a, aChat, mid, { t: 'answer', r: 'miss' });
    moves += 1;
  }

  // Verify phase: still ongoing until the winner's closing reveal.
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(moves);
  expect((await gameInfo(a, mid)).status.state).toBe('ongoing');
  await play(a, aChat, mid, { t: 'reveal', layout: L0, salt: 'c2FsdDA' });

  for (const p of [a, b]) {
    await expect
      .poll(async () => (await gameInfo(p, mid))?.status, { timeout: 30_000 })
      .toEqual({ state: 'won', winner: 0 });
  }

  for (const x of ctxs) await x.close();
});

test('the real flow: Deploy fleet commits, and the defender device answers by itself', async ({ browser }) => {
  const { a, b, aChat, bChat, mid, ctxs } = await setupGame(browser, ['RINGBS3', 'RINGBS4']);

  // Both players open the chat and lock their randomly shuffled fleets.
  await a.page.goto(`/chat/${aChat}`);
  await b.page.goto(`/chat/${bChat}`);
  await a.page.getByRole('button', { name: /Deploy fleet/ }).click();
  // Bisect: A's OWN device must apply the commit locally first…
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 15_000 }).toBe(1);
  // …then the sealed signal reaches B.
  await expect.poll(async () => (await gameInfo(b, mid))?.moves, { timeout: 30_000 }).toBe(1);
  await b.page.getByRole('button', { name: /Deploy fleet/ }).click();
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(2);

  // A fires one shot; B's OPEN board answers automatically from its secret.
  await play(a, aChat, mid, { t: 'shot', cell: 0 });
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(4);

  for (const x of ctxs) await x.close();
});

test('group observers watch the battle but provably never hold a fleet', async ({ browser }) => {
  const ctxs = [await browser.newContext(), await browser.newContext(), await browser.newContext()];
  const a = await createAccount(ctxs[0], 'RINGBS5');
  const b = await createAccount(ctxs[1], 'RINGBS6');
  const c = await createAccount(ctxs[2], 'RINGBS7');
  await pair(a, b);
  await pair(a, c);
  const gid = (await a.page.evaluate(
    (ids) => (window as any).__ringTest.createGroup('Fleet Night', ids),
    [b.id, c.id],
  )) as string;
  for (const p of [b, c]) {
    await p.page.waitForFunction(
      (id) => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.some((g) => g.id === id)),
      gid,
      { timeout: 30_000 },
    );
  }
  const mid = (await a.page.evaluate(
    (id: string) => (window as any).__ringTest.sendGameChallenge(id, 'battleship'),
    gid,
  )) as string;
  await expect.poll(async () => (await gameInfo(b, mid))?.phase, { timeout: 30_000 }).toBe('open');
  await b.page.evaluate((id: string) => (window as any).__ringTest.acceptGameChallenge(id), mid);
  await expect.poll(async () => (await gameInfo(a, mid))?.opponent, { timeout: 30_000 }).toBe(b.id);

  await a.page.evaluate(
    (arg: { chat: string; mid: string; layout: any }) =>
      (window as any).__ringTest.battleshipCommit(arg.chat, arg.mid, arg.layout, 'c2FsdDA'),
    { chat: gid, mid, layout: L0 },
  );
  await expect.poll(async () => (await gameInfo(b, mid))?.moves, { timeout: 30_000 }).toBe(1);
  await b.page.evaluate(
    (arg: { chat: string; mid: string; layout: any }) =>
      (window as any).__ringTest.battleshipCommit(arg.chat, arg.mid, arg.layout, 'c2FsdDE'),
    { chat: gid, mid, layout: L1 },
  );
  await expect.poll(async () => (await gameInfo(c, mid))?.moves, { timeout: 30_000 }).toBe(2);

  // Two shots land; the observer replays them — and holds zero fleet data.
  await play(a, gid, mid, { t: 'shot', cell: T1[0] });
  await expect.poll(async () => (await gameInfo(b, mid))?.moves, { timeout: 30_000 }).toBe(3);
  await play(b, gid, mid, { t: 'answer', r: 'hit' });
  await expect.poll(async () => (await gameInfo(c, mid))?.moves, { timeout: 30_000 }).toBe(4);
  const json = JSON.stringify(await raw(c, mid));
  expect(json).not.toContain('"layout"');
  expect(json).not.toContain('"dir"');
  expect(json).toContain('"h"'); // it does hold the commitments (opaque)

  for (const x of ctxs) await x.close();
});
