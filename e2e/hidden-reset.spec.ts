import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1027 US5 (FR-018, bug B3): a hidden-chats reset must hold against the
// LIVE relay path too. The 1019 reset only tombstoned the chat id, but a new
// inbound message simply minted a fresh chat id and re-materialized the
// conversation as a visible chat. Now the reset records a peer-keyed localOnly
// block: inbound 1:1 content from that person is acked and dropped without a
// trace until the user deliberately starts a new chat with them.

const ev = (p: any, fn: (...a: any[]) => any, ...args: any[]): Promise<any> =>
  p.page.evaluate(fn, ...args);
const visibleIds = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.visibleChatIds());
const chatsWith = (p: any, peerId: string): Promise<{ id: string }[]> =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatsWith(id), peerId);

test('reset wipes the hidden chat and a live inbound message cannot re-materialize it (FR-018)', async ({ browser }) => {
  test.setTimeout(150_000);
  const a = await createAccount(await browser.newContext(), 'RESET001');
  const b = await createAccount(await browser.newContext(), 'RESET002');
  await pair(a, b);

  // Hidden 1:1 with traffic (a real ratchet to destroy).
  await ev(a, (id: string) => (window as any).__ringTest.startChat(id), b.id);
  const chat = await ev(a, (id: string) => (window as any).__ringTest.chatWith(id), b.id);
  const bChat = await ev(b, (id: string) => (window as any).__ringTest.startChat(id), a.id);
  await ev(b, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'pre-reset'), bChat);
  await expect
    .poll(async () => (await ev(a, (c: string) => (window as any).__ringTest.messages(c), chat)).length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await ev(a, (pin: string) => (window as any).__ringTest.hiddenSetPin(pin), '1234');
  await ev(a, (id: string) => (window as any).__ringTest.hiddenAdd(id), chat);

  // Destructive reset.
  const res = await ev(a, () => (window as any).__ringTest.hiddenReset());
  expect(res.wiped).toContain(chat);
  expect(await chatsWith(a, b.id)).toHaveLength(0);

  // THE B3 REGRESSION: B keeps sending over the live relay. Nothing may
  // re-materialize — no chat row (hidden or visible), nothing identifying B.
  await ev(b, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'are you there?'), bChat);
  await ev(b, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'hello??'), bChat);
  await a.page.waitForTimeout(5000); // give the relay + client time to (not) act
  expect(await chatsWith(a, b.id)).toHaveLength(0);
  expect(await visibleIds(a)).toHaveLength(0);

  // Deliberate re-engagement lifts the block: A starts a new chat with B and
  // the conversation works again (fresh session both ways).
  const fresh = await ev(a, (id: string) => (window as any).__ringTest.startChat(id), b.id);
  expect(fresh).not.toBe('');
  expect(fresh).not.toBe(chat);
  await ev(a, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'starting over'), fresh);
  await expect
    .poll(async () => (await ev(b, (c: string) => (window as any).__ringTest.messages(c), bChat)).map((m: any) => m.body), { timeout: 20_000 })
    .toContain('starting over');
  await ev(b, (c: string) => (window as any).__ringTest.sendChatMessage(c, 'welcome back'), bChat);
  await expect
    .poll(async () => (await ev(a, (c: string) => (window as any).__ringTest.messages(c), fresh)).map((m: any) => m.body), { timeout: 20_000 })
    .toContain('welcome back');
});
