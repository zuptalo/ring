import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

const setProfile = (p: any, name: string) =>
  p.page.evaluate(([n, av]: [string, string]) => (window as any).__ringTest.setProfile(n, av), [name, AVATAR]);

const react = (p: any, messageId: string, emoji: string) =>
  p.page.evaluate((args: [string, string]) => (window as any).__ringTest.reactToMessage(args[0], args[1]), [messageId, emoji]);

/** Current in-app banner bodies. */
const banners = (p: any): Promise<string[]> =>
  p.page.evaluate(() => (window as any).__ringTest.notices().map((n: any) => n.body));

/** Wait until a banner whose body contains `text` is showing. */
const waitBanner = (p: any, text: string) =>
  p.page.waitForFunction(
    (t: string) => (window as any).__ringTest.notices().some((n: any) => String(n.body).includes(t)),
    text,
    { timeout: 30_000 },
  );

/** Wait until no banner is showing (they auto-dismiss after ~4.5s). */
const waitQuiet = (p: any) =>
  p.page.waitForFunction(() => (window as any).__ringTest.notices().length === 0, undefined, { timeout: 30_000 });

/**
 * Spec 1048 (US1/US3): a reaction to YOUR message notifies you — and only you —
 * through the in-app banner path; removals stay silent; viewing the chat suppresses
 * the banner; and the settings toggle really gates it (no more dead control).
 */
test('reaction notifications: author-only, viewing suppresses, toggle gates', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RNOTIF1');
  const b = await createAccount(ctxB, 'RNOTIF2');
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');
  await pair(a, b);

  // A sends a message; the id is shared by both sides of the chat.
  const aChat = await a.page.evaluate((id) => (window as any).__ringTest.chatWith(id), b.id);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'my painting is done'), aChat);
  const msgId = (await a.page
    .waitForFunction(
      (id) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.find((m) => m.body === 'my painting is done')?.id),
      aChat,
      { timeout: 30_000 },
    )
    .then((h) => h.jsonValue())) as string;
  await b.page.waitForFunction(
    async (aid) => {
      const id = await (window as any).__ringTest.chatWith(aid);
      if (!id) return false;
      const ms = await (window as any).__ringTest.messages(id);
      return ms.some((m: any) => m.body === 'my painting is done');
    },
    a.id,
    { timeout: 30_000 },
  );

  // 1) B reacts ❤️ → A (on the Chats tab, not in the chat) gets the reaction banner.
  await react(b, msgId, '❤️');
  await waitBanner(a, 'Reacted ❤️ to: my painting is done');

  // 2) Removal is silent: B toggles the same emoji off → no new banner appears.
  await waitQuiet(a);
  await react(b, msgId, '❤️'); // second tap = remove
  await a.page.waitForTimeout(2500);
  expect(await banners(a)).toEqual([]);

  // 3) Viewing the chat suppresses the banner (the reaction is visible inline).
  //    Wait until the chat page has actually registered itself as active — the
  //    route push and the page's onMounted are async.
  await a.page.evaluate((id) => (window as any).__ringTest.navigate(`/chat/${id}`), aChat);
  await a.page.waitForFunction((id: string) => (window as any).__ringTest.isChatActive(id), aChat, { timeout: 30_000 });
  await react(b, msgId, '👍');
  await a.page.waitForTimeout(2500);
  expect(await banners(a)).toEqual([]);
  await a.page.evaluate(() => (window as any).__ringTest.navigate('/tabs/chats'));
  await a.page.waitForFunction((id: string) => !(window as any).__ringTest.isChatActive(id), aChat, { timeout: 30_000 });

  // 4) Toggle OFF (SC-005 — the control must really gate): no banner, but the
  //    reaction still syncs and the chat list still shows the "reacted" preview.
  await a.page.evaluate(() => (window as any).__ringTest.setGlobalSetting('notifications.message.reactions', false));
  await react(b, msgId, '😂');
  await expect
    .poll(
      () => a.page.evaluate((id: string) => (window as any).__ringTest.getReactions(id).then((rs: any[]) => rs.map((r: any) => r.emoji)), msgId),
      { timeout: 30_000 },
    )
    .toContain('😂');
  expect(await banners(a)).toEqual([]);
  const preview = await a.page.evaluate((id) => (window as any).__ringTest.chatPreview(id), aChat);
  expect(preview?.lastMessage ?? '').toContain('reacted');
  expect(preview?.lastKind).toBe('reaction');

  // 5) Toggle back ON → notifications resume.
  await a.page.evaluate(() => (window as any).__ringTest.setGlobalSetting('notifications.message.reactions', true));
  await react(b, msgId, '🎉');
  await waitBanner(a, 'Reacted 🎉 to: my painting is done');

  await ctxA.close();
  await ctxB.close();
});

/**
 * Spec 1048 (US1 AC3): in a group, only the AUTHOR of the reacted-to message is
 * notified — other members see nothing for someone else's reaction.
 */
test('group reactions notify only the message author', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await createAccount(ctxA, 'RNOTIF3');
  const b = await createAccount(ctxB, 'RNOTIF4');
  const c = await createAccount(ctxC, 'RNOTIF5');
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');
  await setProfile(c, 'Carol');
  await pair(a, b);
  await pair(a, c);

  const gid = await a.page.evaluate((ids) => (window as any).__ringTest.createGroup('Studio', ids), [b.id, c.id]);
  for (const p of [b, c]) {
    await p.page.waitForFunction(
      (g) => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.some((x: any) => x.id === g)),
      gid,
      { timeout: 30_000 },
    );
  }

  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'sketch for the mural'), gid);
  const msgId = (await a.page
    .waitForFunction(
      (id) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.find((m) => m.body === 'sketch for the mural')?.id),
      gid,
      { timeout: 30_000 },
    )
    .then((h) => h.jsonValue())) as string;
  await c.page.waitForFunction(
    (id) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.some((m: any) => m.body === 'sketch for the mural')),
    gid,
    { timeout: 30_000 },
  );

  // Let Bob's ordinary "new message" banner for Alice's post dismiss first, so the
  // assertion below isolates the REACTION's effect.
  await waitQuiet(b);

  // Carol reacts to ALICE's message → Alice gets the banner naming Carol…
  await react(c, msgId, '🔥');
  await waitBanner(a, 'Carol reacted 🔥 to: sketch for the mural');

  // …and Bob (a member, but not the author) sees nothing for it.
  await b.page.waitForTimeout(1500);
  expect(await banners(b)).toEqual([]);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
