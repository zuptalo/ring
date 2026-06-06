import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);
const messages = (p: any, chatId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.messages(id), chatId);

/**
 * Location, poll (with cross-peer voting) and shared-contact all travel E2EE and
 * arrive on the peer; a poll vote made on one side updates the tally on the other.
 */
test('location, contact and poll (with voting) sync to the peer', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SHARETST');
  const b = await createAccount(ctxB, 'SHARETS2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;

  await a.page.evaluate((id) => (window as any).__ringTest.sendLocation(id, 37.7749, -122.4194, 'Ferry Building'), aChat);
  await a.page.evaluate((id) => (window as any).__ringTest.sendContact(id, 'u-charlie', 'Charlie Diaz', ''), aChat);
  await a.page.evaluate((id) => (window as any).__ringTest.sendPoll(id, 'Where to eat?', ['Tacos', 'Sushi'], false), aChat);
  await a.page.evaluate((id) => (window as any).__ringTest.sendAudio(id, 'song.mp3', 'Midnight City', 'M83'), aChat);

  // B receives all four.
  await b.page.waitForFunction(
    async (aid) => {
      const id = await (window as any).__ringTest.chatWith(aid);
      if (!id) return false;
      const ms = await (window as any).__ringTest.messages(id);
      const kinds = ms.map((m: any) => m.kind);
      return ['location', 'contact', 'poll', 'audio'].every((k) => kinds.includes(k));
    },
    a.id,
    { timeout: 30_000 },
  );

  const bChat = (await chatWith(b, a.id)) as string;
  const find = async (kind: string) =>
    (await messages(b, bChat)).find((m: any) => m.kind === kind) ?? null;
  await expect.poll(() => find('location').then((m: any) => m?.location ?? null), { timeout: 30_000 }).toMatchObject({
    label: 'Ferry Building',
  });
  await expect.poll(() => find('contact').then((m: any) => m?.contact ?? null), { timeout: 30_000 }).toMatchObject({
    name: 'Charlie Diaz',
    userId: 'u-charlie',
  });
  await expect.poll(() => find('poll').then((m: any) => m?.poll?.options ?? null), { timeout: 30_000 }).toEqual([
    'Tacos',
    'Sushi',
  ]);
  const poll = await find('poll');
  await expect
    .poll(
      async () => {
        const ms = await messages(b, bChat);
        return ms.find((m: any) => m.kind === 'audio')?.audio ?? null;
      },
      { timeout: 30_000 },
    )
    .toMatchObject({ title: 'Midnight City', artist: 'M83' });

  // Background compression job: A sends a photo at SD → it compresses off the UI
  // thread, uploads, and reaches the peer; A's copy leaves the 'compressing' state.
  await a.page.evaluate((id) => (window as any).__ringTest.sendMediaQuality(id, 'image', 'pic.png', 'sd'), aChat);
  await expect
    .poll(
      async () => {
        const ms = await messages(b, bChat);
        return ms.some((m: any) => m.kind === 'image');
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect
    .poll(
      async () => {
        const ms = await messages(a, aChat);
        return ms.find((m: any) => m.kind === 'image')?.status;
      },
      { timeout: 30_000 },
    )
    .not.toBe('compressing');

  // B votes Sushi (option 1); A sees the tally update on its own poll copy.
  await b.page.evaluate((mid) => (window as any).__ringTest.votePoll(mid, 1), poll.id);
  await expect
    .poll(() => a.page.evaluate((mid) => (window as any).__ringTest.pollCounts(mid), poll.id), { timeout: 30_000 })
    .toEqual([0, 1]);

  // A also votes Tacos; both tallies converge.
  await a.page.evaluate((mid) => (window as any).__ringTest.votePoll(mid, 0), poll.id);
  await expect
    .poll(() => b.page.evaluate((mid) => (window as any).__ringTest.pollCounts(mid), poll.id), { timeout: 30_000 })
    .toEqual([1, 1]);

  await ctxA.close();
  await ctxB.close();
});
