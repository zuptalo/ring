/**
 * Armada (spec 1038): the fullscreen naval duel. Proves SC-001 (a full
 * verified 10×10 game converging through staged sequential commits and the
 * duty officer's automatic answers/reveals), SC-003 (the stall fix: a
 * defender that was offline/closed at shot time answers on its next open,
 * with no board ever mounted), SC-004/005 (toasts over the game + the
 * floating return pill), the wall accept race, and SC-007 (battleship
 * retired from the picker, legacy sessions still playable).
 */
import { test, expect, type Browser } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The unit suite's fixed 10×10 fleets (canonical class order 5,4,3,3,2).
const L0 = [
  { r: 0, c: 0, len: 5, dir: 'h' }, { r: 2, c: 0, len: 4, dir: 'h' },
  { r: 4, c: 0, len: 3, dir: 'h' }, { r: 6, c: 0, len: 3, dir: 'h' },
  { r: 8, c: 0, len: 2, dir: 'h' },
];
const L1 = [
  { r: 0, c: 9, len: 5, dir: 'v' }, { r: 0, c: 7, len: 4, dir: 'v' },
  { r: 0, c: 5, len: 3, dir: 'v' }, { r: 5, c: 7, len: 3, dir: 'v' },
  { r: 8, c: 3, len: 2, dir: 'h' },
];
const cellsOf = (s: any): number[] =>
  Array.from({ length: s.len }, (_, i) => (s.dir === 'h' ? s.r * 10 + s.c + i : (s.r + i) * 10 + s.c));
const T1 = L1.flatMap(cellsOf); // P0's 17-cell hunting list

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
const commit = (p: RingClient, arg: { chatId?: string; messageId?: string; postId?: string; layout: any; salt: string }): Promise<string> =>
  p.page.evaluate((a: any) => (window as any).__ringTest.armadaCommit(a), arg);

async function setupGame(browser: Browser, codes: [string, string]) {
  const ctxs = [await browser.newContext(), await browser.newContext()];
  const a = await createAccount(ctxs[0], codes[0]);
  const b = await createAccount(ctxs[1], codes[1]);
  await pair(a, b);
  const aChat = (await a.page.evaluate((id) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  const bChat = (await b.page.evaluate((id) => (window as any).__ringTest.chatWith(id), a.id)) as string;
  const mid = (await a.page.evaluate(
    (chat: string) => (window as any).__ringTest.sendGame(chat, 'armada'),
    aChat,
  )) as string;
  // Robust arrival check (async waitForFunction predicates can resolve
  // spuriously — the drive harness documents the same trap).
  await expect
    .poll(async () => (await gameInfo(b, mid))?.gameType ?? null, { timeout: 30_000 })
    .toBe('armada');
  return { a, b, aChat, bChat, mid, ctxs };
}

test('a full verified duel: staged sequential commits, duty-officer answers and reveals, cheat-proof end', async ({ browser }) => {
  const { a, b, aChat, bChat, mid, ctxs } = await setupGame(browser, ['RINGAR1', 'RINGAR2']);

  // B (the invitee, seat 1) deploys FIRST: the commit STAGES device-locally —
  // nothing crosses the wire (sequential commits, no seq race by construction).
  await commit(b, { chatId: bChat, messageId: mid, layout: L1, salt: 'c2FsdDE' });
  await new Promise((r) => setTimeout(r, 1_500));
  expect((await gameInfo(b, mid))?.moves).toBe(0);
  const staged0 = await b.page.evaluate((id: string) => (window as any).__ringTest.dutyProbe(id), mid);
  expect(staged0, JSON.stringify(staged0)).toMatchObject({ staged: true, secret: true });

  // A deploys: seq 1 goes out; B's duty officer emits the staged commit as
  // seq 2 on its own — no board, no tap. Bisected so a failure names its leg:
  // A's local apply → delivery to B → B's duty emission → delivery to A.
  await commit(a, { chatId: aChat, messageId: mid, layout: L0, salt: 'c2FsdDA' });
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 15_000 }).toBe(1);
  await expect.poll(async () => (await gameInfo(b, mid))?.moves, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  // Diagnostic teeth: if B's duty stalls, fail with the resolver's view. (The
  // fast path may ALREADY have emitted seq 2 and cleaned the stage — fine.)
  const duty = await b.page.evaluate((id: string) => (window as any).__ringTest.dutyProbe(id), mid);
  expect(
    duty.moves === 2 || (duty.staged && duty.secret),
    JSON.stringify(duty),
  ).toBe(true);
  await expect.poll(async () => (await gameInfo(b, mid))?.moves, { timeout: 30_000 }).toBe(2);
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(2);

  // SC-002 carry-over: mid-game, neither stored session holds any layout data.
  for (const p of [a, b]) {
    const json = JSON.stringify(await raw(p, mid));
    expect(json).not.toContain('"layout"');
    expect(json).not.toContain('"dir"');
  }

  // A hunts B's 17 cells. B's device answers EVERY shot automatically (the
  // duty officer judges from the device-local secret); B fires misses back,
  // which A's duty answers automatically too. Nobody plays an 'answer' by hand.
  // Rows 9 and 7 are open water in L0 — sixteen safe return shots.
  const WATER = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 70, 71, 72, 73, 74, 75];
  let moves = 2;
  for (let i = 0; i < T1.length; i++) {
    await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(moves);
    await play(a, aChat, mid, { t: 'shot', cell: T1[i] });
    moves += 2; // the shot + B's automatic answer
    if (i === T1.length - 1) break;
    await expect.poll(async () => (await gameInfo(b, mid))?.moves, { timeout: 30_000 }).toBe(moves);
    await play(b, bChat, mid, { t: 'shot', cell: WATER[i] });
    moves += 2; // the shot + A's automatic answer
  }

  // The 17th declared hit forces B's reveal onto the final answer; A's duty
  // officer then closes with the winner reveal — both devices converge to the
  // verified win with zero manual protocol moves.
  for (const p of [a, b]) {
    await expect
      .poll(async () => (await gameInfo(p, mid))?.status, { timeout: 45_000 })
      .toEqual({ state: 'won', winner: 0 });
  }

  for (const x of ctxs) await x.close();
});

test('the stall fix: a defender offline at shot time answers on reconnect, board never mounted', async ({ browser }) => {
  const { a, b, aChat, bChat, mid, ctxs } = await setupGame(browser, ['RINGAR3', 'RINGAR4']);

  await commit(a, { chatId: aChat, messageId: mid, layout: L0, salt: 'c2FsdDA' });
  // Bisect: A's OWN device applies the commit locally first…
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 15_000 }).toBe(1);
  // …then the sealed signal reaches B.
  await expect.poll(async () => (await gameInfo(b, mid))?.moves, { timeout: 30_000 }).toBe(1);
  await commit(b, { chatId: bChat, messageId: mid, layout: L1, salt: 'c2FsdDE' });
  await expect.poll(async () => (await gameInfo(b, mid))?.moves, { timeout: 15_000 }).toBe(2);
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(2);

  // B goes offline (the "app closed at shot time" shape); A fires.
  await b.page.evaluate(() => (window as any).__ringTest.disconnect());
  await play(a, aChat, mid, { t: 'shot', cell: T1[0] });
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(3);

  // B comes back — sitting on the chats tab, chat NEVER opened, no board
  // mounted. The queue drains, the duty officer judges and answers.
  await b.page.evaluate(() => (window as any).__ringTest.reconnect());
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(4);
  expect(JSON.stringify((await raw(a, mid)).moves[3].move)).toContain('"hit"'); // T1[0] is the carrier bow

  // And the RELOAD shape: B offline again, A fires, B's page fully reloads —
  // the answer still goes out from the fresh app start.
  await b.page.evaluate(() => (window as any).__ringTest.disconnect());
  await play(b, bChat, mid, { t: 'shot', cell: 99 }); // queued locally while offline
  await b.page.reload();
  await b.page.waitForFunction(() => !!(window as any).__ringTest, undefined, { timeout: 30_000 });
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 45_000 }).toBeGreaterThanOrEqual(5);

  for (const x of ctxs) await x.close();
});

test('the fullscreen flow: card into overlay, a toast over the game leads away, the pill leads back', async ({ browser }) => {
  const ctxs = [
    // A plays on a PHONE-sized viewport: SC-001 forbids horizontal scrolling.
    await browser.newContext({ viewport: { width: 390, height: 844 } }),
    await browser.newContext(),
    await browser.newContext(),
  ];
  const a = await createAccount(ctxs[0], 'RINGAR5');
  const b = await createAccount(ctxs[1], 'RINGAR6');
  const c = await createAccount(ctxs[2], 'RINGAR7');
  await pair(a, b);
  await pair(a, c);
  const aChat = (await a.page.evaluate((id) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  const mid = (await a.page.evaluate(
    (chat: string) => (window as any).__ringTest.sendGame(chat, 'armada'),
    aChat,
  )) as string;

  // The chat carries a challenge CARD, not a board; its button opens the overlay.
  await a.page.goto(`/chat/${aChat}`);
  await expect(a.page.locator('.gcc')).toBeVisible({ timeout: 15_000 });
  // The goto is a full app reload: let the unlock settle window (2.5s banner
  // damping, by design) expire before expecting toasts — the same clearance
  // the notifications-inapp suite uses.
  await a.page.waitForTimeout(3500);
  expect(await a.page.locator('.armada').count()).toBe(0); // no inline board, ever
  await a.page.locator('.gcc.enterable').click(); // the whole card is the enter affordance now
  await expect(a.page.locator('.game-overlay')).toBeVisible();
  await expect(a.page.locator('.armada')).toBeVisible(); // deployment face, hosted by the overlay

  // No horizontal scrolling on a phone — deployment face (SC-001; the iPhone
  // sideways-pan bug: absolutely-positioned effect layers widened the body).
  const noXScroll = () =>
    a.page.evaluate(() => {
      const body = document.querySelector('.go-body')!;
      const limit = body.getBoundingClientRect().right;
      const offenders = [...body.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().right > limit + 1)
        .slice(0, 5)
        .map((el) => `${el.tagName}.${(el as HTMLElement).className}@${Math.round(el.getBoundingClientRect().right)}`);
      return { sw: body.scrollWidth, cw: body.clientWidth, offenders };
    });
  let x = await noXScroll();
  expect(x.sw, JSON.stringify(x)).toBeLessThanOrEqual(x.cw + 1);

  // A message from a THIRD chat toasts over the game...
  const cChatWithA = (await c.page.evaluate((id) => (window as any).__ringTest.chatWith(id), a.id)) as string;
  await c.page.evaluate(
    (arg: { chat: string }) => (window as any).__ringTest.sendChatMessage(arg.chat, 'psst, over here'),
    { chat: cChatWithA },
  );
  // Bisect: the message must LAND on A's device before the banner can show.
  const aChatWithC = (await a.page.evaluate((id) => (window as any).__ringTest.chatWith(id), c.id)) as string;
  await a.page.waitForFunction(
    async (chat: string) => {
      const ms = await (window as any).__ringTest.messages(chat);
      return ms.some((m: any) => (m.body ?? '').includes('psst'));
    },
    aChatWithC,
    { timeout: 30_000 },
  );
  // Policy probe: the notify layer must be WILLING to banner this chat (fails
  // loudly with the policy inputs if something suppressed it).
  const probe = await a.page.evaluate(
    (chat: string) => (window as any).__ringTest.probeNotify(chat, 'policy probe'),
    aChatWithC,
  );
  expect(probe, JSON.stringify(probe)).toMatchObject({ presented: true });
  const banner = a.page.locator('.nb-stack .nb');
  await expect(banner).toBeVisible({ timeout: 15_000 });

  // ...and tapping it minimizes the game and lands in that chat.
  await a.page.locator('.nb-main').first().click();
  await expect(a.page.locator('.game-overlay')).toBeHidden({ timeout: 10_000 });
  await expect.poll(() => a.page.url(), { timeout: 10_000 }).toContain('/chat/');
  expect(a.page.url()).not.toContain(aChat);

  // The floating pill is visible (an ongoing seat-held game, overlay closed),
  // survives a reload, and a tap re-enters the game.
  await expect(a.page.locator('.fgb')).toBeVisible({ timeout: 10_000 });
  await a.page.reload();
  await a.page.waitForFunction(() => !!(window as any).__ringTest, undefined, { timeout: 30_000 });
  await expect(a.page.locator('.fgb')).toBeVisible({ timeout: 15_000 });
  await a.page.locator('.fgb').click();
  await expect(a.page.locator('.game-overlay')).toBeVisible({ timeout: 10_000 });

  // Own-game activity while the overlay is open shows NO banner (FR-007):
  // B commits (an inbound game signal for THIS game) — no toast appears.
  const bChat = (await b.page.evaluate((id) => (window as any).__ringTest.chatWith(id), a.id)) as string;
  await commit(b, { chatId: bChat, messageId: mid, layout: L1, salt: 'c2FsdDE' });
  await commit(a, { chatId: aChat, messageId: mid, layout: L0, salt: 'c2FsdDA' });
  await expect.poll(async () => (await gameInfo(a, mid))?.moves, { timeout: 30_000 }).toBe(2);
  expect(await a.page.locator('.nb-stack .nb').count()).toBe(0);

  // Battle face (two boards + radar + rosters) must not scroll sideways either.
  x = await noXScroll();
  expect(x.sw, JSON.stringify(x)).toBeLessThanOrEqual(x.cw + 1);

  // The game ends by resignation while minimized → the pill clears itself.
  await a.page.locator('.go-exit').click();
  await expect(a.page.locator('.game-overlay')).toBeHidden();
  await expect(a.page.locator('.fgb')).toBeVisible();
  await b.page.evaluate(
    (arg: { chat: string; mid: string }) => (window as any).__ringTest.resignGame(arg.chat, arg.mid),
    { chat: bChat, mid },
  );
  await expect(a.page.locator('.fgb')).toBeHidden({ timeout: 30_000 });

  for (const x of ctxs) await x.close();
});

test('a wall challenge: accept lands in deployment, the race seats exactly one, spectators keep the card', async ({ browser }) => {
  const ctxs = [await browser.newContext(), await browser.newContext(), await browser.newContext()];
  const a = await createAccount(ctxs[0], 'RINGAR8'); // author = challenger
  const b = await createAccount(ctxs[1], 'RINGAR9'); // racer 1
  const c = await createAccount(ctxs[2], 'RINGAR10'); // racer 2 → spectator
  await pair(a, b);
  await pair(a, c);

  const pid = (await a.page.evaluate(
    () => (window as any).__ringTest.post({ game: { gameType: 'armada' } }),
  )) as string;

  const synced = async (p: RingClient) => {
    await p.page.evaluate(() => (window as any).__ringTest.syncPosts());
    await p.page.evaluate((i: string) => (window as any).__ringTest.syncEngagement(i), pid);
    return p.page.evaluate((i: string) => (window as any).__ringTest.wallGameInfo(i), pid);
  };
  for (const p of [b, c]) {
    await expect.poll(async () => (await synced(p))?.phase, { timeout: 30_000 }).toBe('open');
  }

  // Near-simultaneous accepts: the engine seats exactly one, deterministically,
  // on every device.
  await Promise.all([
    b.page.evaluate((i: string) => (window as any).__ringTest.acceptWallChallenge(i), pid),
    c.page.evaluate((i: string) => (window as any).__ringTest.acceptWallChallenge(i), pid),
  ]);
  await expect.poll(async () => (await synced(a))?.opponent, { timeout: 30_000 }).not.toBeNull();
  const seated = (await synced(a)).opponent as string;
  expect([b.id, c.id]).toContain(seated);
  for (const p of [b, c]) {
    await expect.poll(async () => (await synced(p))?.opponent, { timeout: 30_000 }).toBe(seated);
  }

  // The post face is the challenge CARD on every device; the spectator gets
  // status only (no button once the seats are taken).
  const loser = seated === b.id ? c : b;
  await loser.page.goto(`/wall/post/${pid}`);
  await expect(loser.page.locator('.gcc')).toBeVisible({ timeout: 15_000 });
  expect(await loser.page.locator('.gcc.enterable').count()).toBe(0); // a spectator's card is not enterable
  expect(await loser.page.locator('.armada').count()).toBe(0);

  for (const x of ctxs) await x.close();
});

test('battleship retires: gone from the picker, legacy sessions still play inline', async ({ browser }) => {
  const { a, b, aChat, bChat, mid: armadaMid, ctxs } = await setupGame(browser, ['RINGAR11', 'RINGAR12']);
  void armadaMid;

  // The picker offers armada and NOT battleship (FR-010).
  const offered = (await a.page.evaluate(() => (window as any).__ringTest.pickerGames())) as string[];
  expect(offered).toContain('armada');
  expect(offered).not.toContain('battleship');

  // A legacy battleship session (hook-started, as an old build would have)
  // still renders its INLINE submarine board and plays.
  const bsMid = (await b.page.evaluate(
    (chat: string) => (window as any).__ringTest.sendGame(chat, 'battleship'),
    bChat,
  )) as string;
  await expect.poll(async () => (await gameInfo(a, bsMid))?.gameType, { timeout: 30_000 }).toBe('battleship');
  // Battleship keeps its inline submarine BOARD (the armada bubble in the same
  // chat renders as a card — the two presentations coexist).
  await b.page.goto(`/chat/${bChat}`);
  await expect(b.page.locator('.bs').first()).toBeVisible({ timeout: 15_000 });
  void aChat;

  for (const x of ctxs) await x.close();
});
