/**
 * Wall game challenges (spec 0009 US3): a challenge post plays out ON the post
 * for its sealed audience — accepts and moves ride engagement records of kind
 * 'game', replayed deterministically from the pulled set on every device.
 * Audience isolation, first-accept seating, full-game convergence, observer
 * read-only, and post-deletion pruning, all through __ringTest (the same
 * queries.ts orchestration the UI uses).
 */
import { test, expect, type Browser } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const syncPosts = (c: RingClient): Promise<void> => c.page.evaluate(() => (window as any).__ringTest.syncPosts());
const wallIds = (c: RingClient): Promise<string[]> => c.page.evaluate(() => (window as any).__ringTest.wallPostIds());
const syncEng = (c: RingClient, id: string): Promise<void> =>
  c.page.evaluate((i) => (window as any).__ringTest.syncEngagement(i), id);
const gameInfo = (c: RingClient, id: string): Promise<any> =>
  c.page.evaluate((i) => (window as any).__ringTest.wallGameInfo(i), id);
const acceptGame = (c: RingClient, id: string): Promise<void> =>
  c.page.evaluate((i) => (window as any).__ringTest.acceptWallChallenge(i), id);
const play = (c: RingClient, id: string, cell: number): Promise<void> =>
  c.page.evaluate(
    (a: { id: string; cell: number }) => (window as any).__ringTest.playWallGameMove(a.id, { cell: a.cell }),
    { id, cell },
  );

/** Pull the post feed + this post's engagement, then read the derived game. */
async function synced(c: RingClient, id: string): Promise<any> {
  await syncPosts(c);
  await syncEng(c, id);
  return gameInfo(c, id);
}

test('a Wall challenge plays out on the post for exactly its audience', async ({ browser }) => {
  const ctxs = [await browser.newContext(), await browser.newContext(), await browser.newContext(), await browser.newContext()];
  const a = await createAccount(ctxs[0], 'RINGWG1'); // author = challenger
  const b = await createAccount(ctxs[1], 'RINGWG2'); // first accepter
  const c = await createAccount(ctxs[2], 'RINGWG3'); // audience observer
  const d = await createAccount(ctxs[3], 'RINGWG4'); // NOT in the audience
  await pair(a, b);
  await pair(a, c);
  await pair(b, d); // dave exists, but is not alice's friend
  // Bob sets a profile so his sealed accept can carry his name to non-contacts.
  await b.page.evaluate(() => (window as any).__ringTest.setProfile('Bob Builder', ''));

  // Alice throws a challenge post to her friends.
  const pid = (await a.page.evaluate(
    () => (window as any).__ringTest.post({ game: { gameType: 'tictactoe', theme: 'space' } }),
    )) as string;

  // Bob and Carol see the challenge, open, with Alice seated; Dave sees nothing.
  for (const p of [b, c]) {
    await expect
      .poll(async () => { await syncPosts(p); return (await wallIds(p)).includes(pid); }, { timeout: 30_000 })
      .toBe(true);
    const g = await synced(p, pid);
    expect(g.phase).toBe('open');
    expect(g.players).toEqual([a.id]);
  }
  await syncPosts(d);
  expect((await wallIds(d)).includes(pid)).toBe(false);

  // Bob takes the seat; everyone converges on the matchup.
  await acceptGame(b, pid);
  for (const p of [a, c]) {
    await expect.poll(async () => (await synced(p, pid)).opponent, { timeout: 30_000 }).toBe(b.id);
  }

  // Carol cannot move — the board is read-only for the audience.
  await play(c, pid, 4);
  expect((await synced(c, pid)).moves).toBe(0);

  // Alice opens play (her seq-1 locks Bob's seat as wire data) and they play to
  // Alice's diagonal win: 4, 0, 8 vs Bob's 3, 5.
  await play(a, pid, 4);
  await expect.poll(async () => (await synced(b, pid)).moves, { timeout: 30_000 }).toBe(1);
  await play(b, pid, 3);
  await expect.poll(async () => (await synced(a, pid)).moves, { timeout: 30_000 }).toBe(2);
  await play(a, pid, 0);
  await expect.poll(async () => (await synced(b, pid)).moves, { timeout: 30_000 }).toBe(3);
  await play(b, pid, 5);
  await expect.poll(async () => (await synced(a, pid)).moves, { timeout: 30_000 }).toBe(4);
  await play(a, pid, 8);

  // The result converges for players AND the observer, seats named by userId.
  for (const p of [a, b, c]) {
    await expect
      .poll(async () => (await synced(p, pid)).status, { timeout: 30_000 })
      .toEqual({ state: 'won', winner: 0 });
    expect((await gameInfo(p, pid)).players).toEqual([a.id, b.id]);
  }

  // Carol is NOT Bob's friend, yet she resolves his NAME: the accept carried
  // his display info sealed under the post key (spec 0009 cross-audience naming).
  await expect
    .poll(async () => (await gameInfo(c, pid)).names?.[b.id], { timeout: 15_000 })
    .toBe('Bob Builder');

  // Deleting the post deletes the game with it, everywhere.
  await a.page.evaluate((i) => (window as any).__ringTest.deletePost(i), pid);
  await expect
    .poll(async () => { await syncPosts(b); return (await wallIds(b)).includes(pid); }, { timeout: 30_000 })
    .toBe(false);
  expect(await gameInfo(b, pid)).toBeNull();

  for (const x of ctxs) await x.close();
});
