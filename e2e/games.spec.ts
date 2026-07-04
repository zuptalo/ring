import { test, expect } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Spec 0008 — in-chat turn-based games (tic-tac-toe, 1:1). Drives the real
// send → seal → relay → open → validate path through __ringTest, like
// reactions.spec.ts. Board/turn/outcome are read via gameInfo (the derived
// session status), which is exactly what the GameBubble renders.

const gameInfo = (p: RingClient, messageId: string): Promise<any> =>
  p.page.evaluate((id: string) => (window as any).__ringTest.gameInfo(id), messageId);

const playMove = (p: RingClient, chatId: string, messageId: string, cell: number) =>
  p.page.evaluate(
    (a: { chatId: string; messageId: string; cell: number }) =>
      (window as any).__ringTest.playGameMove(a.chatId, a.messageId, { cell: a.cell }),
    { chatId, messageId, cell },
  );

const hasOngoing = (p: RingClient, chatId: string): Promise<boolean> =>
  p.page.evaluate((id: string) => (window as any).__ringTest.hasOngoingGame(id), chatId);

/** Start a game from `starter` and wait until BOTH sides hold the bubble. */
async function startGame(a: RingClient, b: RingClient, aChat: string, bChat: string): Promise<string> {
  const before = (await a.page.evaluate(
    (id: string) => (window as any).__ringTest.messages(id),
    aChat,
  )) as any[];
  const seen = new Set(before.filter((m) => m.kind === 'game').map((m) => m.id));
  await a.page.evaluate((id: string) => (window as any).__ringTest.sendGame(id, 'tictactoe'), aChat);
  const msgId = (await a.page
    .waitForFunction(
      async (args: { chatId: string; seen: string[] }) => {
        const ms = await (window as any).__ringTest.messages(args.chatId);
        return ms.find((m: any) => m.kind === 'game' && !args.seen.includes(m.id))?.id;
      },
      { chatId: aChat, seen: [...seen] },
      { timeout: 30_000 },
    )
    .then((h) => h.jsonValue())) as string;
  // The bubble arrives on B under the SAME id (receiver stores the sender's id).
  await b.page.waitForFunction(
    async (args: { chatId: string; msgId: string }) => {
      const ms = await (window as any).__ringTest.messages(args.chatId);
      return ms.some((m: any) => m.id === args.msgId && m.kind === 'game');
    },
    { chatId: bChat, msgId },
    { timeout: 30_000 },
  );
  return msgId;
}

test('1:1 tic-tac-toe: play to a win, turn enforcement, one-game gate, no forward', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGTST5');
  const b = await createAccount(ctxB, 'RINGTST6');
  await pair(a, b);

  const aChat = (await a.page.evaluate((id) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  expect(aChat).toBeTruthy();
  // B's chat id for the same conversation (1:1 ids differ per device until keyed by peer).
  const bChat = (await b.page.evaluate((id) => (window as any).__ringTest.chatWith(id), a.id)) as string;
  expect(bChat).toBeTruthy();

  const msgId = await startGame(a, b, aChat, bChat);

  // Instantly playable, no accept step — and the one-game gate engages on BOTH sides.
  expect(await hasOngoing(a, aChat)).toBe(true);
  await expect.poll(() => hasOngoing(b, bChat), { timeout: 15_000 }).toBe(true);

  // The starter (A) is player 0 and moves first: B moving first is refused locally.
  await playMove(b, bChat, msgId, 0);
  expect((await gameInfo(b, msgId)).moves).toBe(0);

  // A cannot move twice in a row either.
  await playMove(a, aChat, msgId, 4);
  await playMove(a, aChat, msgId, 0);
  expect((await gameInfo(a, msgId)).moves).toBe(1);

  // B catches up and the boards alternate to A's win (row 0-1-2 vs B's 3,4).
  await expect.poll(async () => (await gameInfo(b, msgId)).moves, { timeout: 30_000 }).toBe(1);
  // A occupied 4 already; play a proper win line for A: 0,1,2 with B on 3,5.
  await playMove(b, bChat, msgId, 3);
  await expect.poll(async () => (await gameInfo(a, msgId)).moves, { timeout: 30_000 }).toBe(2);
  await playMove(a, aChat, msgId, 0);
  await expect.poll(async () => (await gameInfo(b, msgId)).moves, { timeout: 30_000 }).toBe(3);
  await playMove(b, bChat, msgId, 5);
  await expect.poll(async () => (await gameInfo(a, msgId)).moves, { timeout: 30_000 }).toBe(4);
  await playMove(a, aChat, msgId, 1);
  await expect.poll(async () => (await gameInfo(b, msgId)).moves, { timeout: 30_000 }).toBe(5);
  await playMove(b, bChat, msgId, 7);
  await expect.poll(async () => (await gameInfo(a, msgId)).moves, { timeout: 30_000 }).toBe(6);
  await playMove(a, aChat, msgId, 2); // completes 0-1-2

  // Both sides converge on the identical outcome: A (player 0) won.
  await expect.poll(async () => (await gameInfo(a, msgId)).status, { timeout: 30_000 }).toEqual({
    state: 'won',
    winner: 0,
  });
  await expect.poll(async () => (await gameInfo(b, msgId)).status, { timeout: 30_000 }).toEqual({
    state: 'won',
    winner: 0,
  });

  // Terminal game frees the gate on both sides.
  await expect.poll(() => hasOngoing(a, aChat), { timeout: 15_000 }).toBe(false);
  await expect.poll(() => hasOngoing(b, bChat), { timeout: 15_000 }).toBe(false);

  // FR-014: forwarding a game bubble is a no-op (no new message anywhere).
  const countBefore = ((await a.page.evaluate((id) => (window as any).__ringTest.messages(id), aChat)) as any[])
    .length;
  await a.page.evaluate(
    (args: { msgId: string; chatId: string }) =>
      (window as any).__ringTest.forwardMessage(args.msgId, [args.chatId]),
    { msgId, chatId: aChat },
  );
  const countAfter = ((await a.page.evaluate((id) => (window as any).__ringTest.messages(id), aChat)) as any[])
    .length;
  expect(countAfter).toBe(countBefore);

  await ctxA.close();
  await ctxB.close();
});

test('1:1 tic-tac-toe: resign ends it for both, and Play again starts a fresh game (US2)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGTST2');
  const b = await createAccount(ctxB, 'RINGTST3');
  await pair(a, b);

  const aChat = (await a.page.evaluate((id) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  const bChat = (await b.page.evaluate((id) => (window as any).__ringTest.chatWith(id), a.id)) as string;
  const msgId = await startGame(a, b, aChat, bChat);

  // Mid-game, B resigns → both sides show A (player 0) as winner by concession.
  await playMove(a, aChat, msgId, 4);
  await expect.poll(async () => (await gameInfo(b, msgId)).moves, { timeout: 30_000 }).toBe(1);
  await b.page.evaluate(
    (args: { chatId: string; msgId: string }) => (window as any).__ringTest.resignGame(args.chatId, args.msgId),
    { chatId: bChat, msgId },
  );
  await expect.poll(async () => (await gameInfo(b, msgId)).status, { timeout: 30_000 }).toEqual({
    state: 'resigned',
    winner: 0,
  });
  await expect.poll(async () => (await gameInfo(a, msgId)).status, { timeout: 30_000 }).toEqual({
    state: 'resigned',
    winner: 0,
  });

  // The finished board is locked (a late move is refused/dropped on both sides)…
  await playMove(a, aChat, msgId, 0);
  expect((await gameInfo(a, msgId)).moves).toBe(1);
  // …and the one-game gate is free again.
  await expect.poll(() => hasOngoing(b, bChat), { timeout: 15_000 }).toBe(false);

  // "Play again" = a fresh bubble started by whoever tapped it (B here): B is
  // the new game's player 0 and moves first; the old bubble stays as it was.
  const rematchId = await startGame(b, a, bChat, aChat);
  expect(rematchId).not.toBe(msgId);
  await playMove(b, bChat, rematchId, 4);
  expect((await gameInfo(b, rematchId)).moves).toBe(1);
  expect((await gameInfo(b, msgId)).status).toEqual({ state: 'resigned', winner: 0 });

  await ctxA.close();
  await ctxB.close();
});

test('1:1 tic-tac-toe: draw, and an offline gap converges (FR-018)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RINGTST7');
  const b = await createAccount(ctxB, 'RINGTST8');
  await pair(a, b);

  const aChat = (await a.page.evaluate((id) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  const bChat = (await b.page.evaluate((id) => (window as any).__ringTest.chatWith(id), a.id)) as string;
  const msgId = await startGame(a, b, aChat, bChat);

  // Play toward a known draw: A 0,2,3,7,8 / B 1,4,5,6 — with an OFFLINE GAP:
  // B drops its transport mid-game; A keeps playing; B reconnects and catches up.
  const script: Array<{ who: 'a' | 'b'; cell: number }> = [
    { who: 'a', cell: 0 }, { who: 'b', cell: 1 }, { who: 'a', cell: 2 }, { who: 'b', cell: 4 },
    { who: 'a', cell: 3 }, { who: 'b', cell: 5 }, { who: 'a', cell: 7 }, { who: 'b', cell: 6 },
    { who: 'a', cell: 8 },
  ];
  // First four moves online.
  for (const step of script.slice(0, 4)) {
    const p = step.who === 'a' ? a : b;
    const chat = step.who === 'a' ? aChat : bChat;
    const mover = step.who === 'a' ? 0 : 1;
    await expect
      .poll(async () => ((await gameInfo(p, msgId)).status as any).turn, { timeout: 30_000 })
      .toBe(mover);
    await playMove(p, chat, msgId, step.cell);
  }
  await expect.poll(async () => (await gameInfo(b, msgId)).moves, { timeout: 30_000 }).toBe(4);

  // B goes offline; A plays its 5th move into the queue.
  await b.page.evaluate(() => (window as any).__ringTest.disconnect());
  await expect.poll(async () => ((await gameInfo(a, msgId)).status as any).turn, { timeout: 30_000 }).toBe(0);
  await playMove(a, aChat, msgId, 3);

  // B reconnects → the queued move arrives and the board catches up identically.
  await b.page.evaluate(() => (window as any).__ringTest.reconnect());
  await expect.poll(async () => (await gameInfo(b, msgId)).moves, { timeout: 30_000 }).toBe(5);

  // Finish the game online to the draw.
  for (const step of script.slice(5)) {
    const p = step.who === 'a' ? a : b;
    const chat = step.who === 'a' ? aChat : bChat;
    const mover = step.who === 'a' ? 0 : 1;
    await expect
      .poll(async () => ((await gameInfo(p, msgId)).status as any).turn, { timeout: 30_000 })
      .toBe(mover);
    await playMove(p, chat, msgId, step.cell);
  }
  await expect.poll(async () => (await gameInfo(a, msgId)).status, { timeout: 30_000 }).toEqual({ state: 'draw' });
  await expect.poll(async () => (await gameInfo(b, msgId)).status, { timeout: 30_000 }).toEqual({ state: 'draw' });

  await ctxA.close();
  await ctxB.close();
});
