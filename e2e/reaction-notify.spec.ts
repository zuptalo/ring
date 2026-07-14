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

/** Arm a wait for a banner whose body contains `text`. ARM BEFORE triggering the
 *  event: banners auto-dismiss after ~4.5s, so a wait started after the trigger can
 *  miss a banner that came and went while the (loaded) runner was elsewhere. */
const bannerSeen = (p: any, text: string) =>
  p.page.waitForFunction(
    (t: string) => (window as any).__ringTest.notices().some((n: any) => String(n.body).includes(t)),
    text,
    { timeout: 30_000 },
  );

/** Wait until no banner is showing (they auto-dismiss after ~4.5s). */
const waitQuiet = (p: any) =>
  p.page.waitForFunction(() => (window as any).__ringTest.notices().length === 0, undefined, { timeout: 30_000 });

/** Wait until `predicate` holds over the target message's reaction emojis on `who`'s
 *  device. The e2e relay occasionally leaves a half-open socket that stalls delivery
 *  for tens of seconds (the app's own keepalive recovers it eventually); after ~12s
 *  of nothing we compress that recovery by force-reconnecting both sides, exactly the
 *  lever the app itself pulls. 60s hard budget. */
async function reactionState(who: any, other: any, messageId: string, predicate: (emojis: string[]) => boolean): Promise<void> {
  const read = (): Promise<string[]> =>
    who.page.evaluate(
      (id: string) => (window as any).__ringTest.getReactions(id).then((rs: any[]) => rs.map((r: any) => r.emoji)),
      messageId,
    );
  const t0 = Date.now();
  let kicked = false;
  for (;;) {
    const emojis = await read();
    if (predicate(emojis)) return;
    if (Date.now() - t0 > 60_000) throw new Error(`reaction state not reached in 60s (have: ${emojis.join(' ') || 'none'})`);
    if (!kicked && Date.now() - t0 > 12_000) {
      kicked = true;
      await who.page.evaluate(() => (window as any).__ringTest.forceReconnect());
      await other.page.evaluate(() => (window as any).__ringTest.forceReconnect());
    }
    await who.page.waitForTimeout(400);
  }
}

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

  // A's post-unlock settle window (2.5s after registration) damps non-escalated
  // banners BY DESIGN — and reactions never escalate. On a warm runner the whole
  // setup can finish inside it, so wait it out before asserting banners.
  await a.page.waitForFunction(() => (window as any).__ringTest.settleMsLeft() === 0, undefined, { timeout: 30_000 });

  // 1) B reacts ❤️ → A (on the Chats tab, not in the chat) gets the reaction banner.
  const first = bannerSeen(a, 'Reacted ❤️ to: my painting is done');
  await react(b, msgId, '❤️');
  // Split diagnosis: the reaction must LAND on A (delivery, reconnect-hardened)…
  await reactionState(a, b, msgId, (e) => e.includes('❤️'));
  // …and the armed wait must have caught the banner (alerting).
  await first;

  // 2) Removal is silent: B toggles the same emoji off → no new banner appears.
  await waitQuiet(a);
  await react(b, msgId, '❤️'); // second tap = remove
  await reactionState(a, b, msgId, (e) => !e.includes('❤️')); // the removal has landed…
  expect(await banners(a)).toEqual([]); // …and produced no banner

  // 3) Viewing the chat suppresses the banner (the reaction is visible inline).
  //    Wait until the chat page has actually registered itself as active — the
  //    route push and the page's onMounted are async.
  await a.page.evaluate((id) => (window as any).__ringTest.navigate(`/chat/${id}`), aChat);
  await a.page.waitForFunction((id: string) => (window as any).__ringTest.isChatActive(id), aChat, { timeout: 30_000 });
  await react(b, msgId, '👍');
  await reactionState(a, b, msgId, (e) => e.includes('👍')); // landed while viewing…
  expect(await banners(a)).toEqual([]); // …with no banner (active-chat suppress)
  await a.page.evaluate(() => (window as any).__ringTest.navigate('/tabs/chats'));
  await a.page.waitForFunction((id: string) => !(window as any).__ringTest.isChatActive(id), aChat, { timeout: 30_000 });

  // 4) Toggle OFF (SC-005 — the control must really gate): no banner, but the
  //    reaction still syncs and the chat list still shows the "reacted" preview.
  await a.page.evaluate(() => (window as any).__ringTest.setGlobalSetting('notifications.message.reactions', false));
  await react(b, msgId, '😂');
  await reactionState(a, b, msgId, (e) => e.includes('😂'));
  expect(await banners(a)).toEqual([]);
  const preview = await a.page.evaluate((id) => (window as any).__ringTest.chatPreview(id), aChat);
  expect(preview?.lastMessage ?? '').toContain('reacted');
  expect(preview?.lastKind).toBe('reaction');

  // 5) Toggle back ON → notifications resume.
  await a.page.evaluate(() => (window as any).__ringTest.setGlobalSetting('notifications.message.reactions', true));
  const resumed = bannerSeen(a, 'Reacted 🎉 to: my painting is done');
  await react(b, msgId, '🎉');
  await reactionState(a, b, msgId, (e) => e.includes('🎉'));
  await resumed;

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

  // Carol's first group SEND is about to happen. Make it a plain message first and
  // wait for Alice to receive it: that proves Carol's sender key reached Alice, so
  // the reaction that follows is decryptable immediately (otherwise the reaction —
  // Carol's first-ever frame in a seconds-old group — can race the key distribution
  // and arrive undecryptable, flaking the banner wait).
  await c.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'carol is here'), gid);
  await a.page.waitForFunction(
    (id) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.some((m: any) => m.body === 'carol is here')),
    gid,
    { timeout: 30_000 },
  );

  // Let the ordinary "new message" banners dismiss first, so the assertions below
  // isolate the REACTION's effect.
  await waitQuiet(b);
  await waitQuiet(a);

  // Alice's settle window must have lapsed before a banner can be asserted
  // (reactions never pierce it — by design).
  await a.page.waitForFunction(() => (window as any).__ringTest.settleMsLeft() === 0, undefined, { timeout: 30_000 });

  // Carol reacts to ALICE's message → Alice gets the banner naming Carol…
  const carolSeen = bannerSeen(a, 'Carol reacted 🔥 to: sketch for the mural');
  await react(c, msgId, '🔥');
  await reactionState(a, c, msgId, (e) => e.includes('🔥'));
  await carolSeen;

  // …and Bob (a member, but not the author) sees nothing for it.
  await b.page.waitForTimeout(1500);
  expect(await banners(b)).toEqual([]);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

/**
 * Spec 1051: a short message with many reactions WIDENS so the chips sit on the
 * bubble instead of spilling over the wallpaper. Bounding-box proof: the
 * reactions row stays horizontally inside the bubble (±2px).
 */
test('a short bubble grows to hold its reaction row', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'GROW01');
  const b = await createAccount(ctxB, 'GROW02');
  await pair(a, b);

  const aChat = await a.page.evaluate((id) => (window as any).__ringTest.chatWith(id), b.id);
  await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'ok'), aChat);
  const msgId = (await a.page
    .waitForFunction(
      (id) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.find((m) => m.body === 'ok')?.id),
      aChat,
      { timeout: 30_000 },
    )
    .then((h) => h.jsonValue())) as string;
  await b.page.waitForFunction(
    async (aid) => {
      const id = await (window as any).__ringTest.chatWith(aid);
      return id ? (await (window as any).__ringTest.messages(id)).some((m: any) => m.body === 'ok') : false;
    },
    a.id,
    { timeout: 30_000 },
  );

  // Five distinct emojis (per-user cap 3 + message cap 5), INTERLEAVED so no
  // side ever sends twice in a row on the fresh session (spec-2033 dodge: the
  // responder's consecutive sends are the lost-frame trigger).
  await react(b, msgId, '👍');
  await reactionState(a, b, msgId, (e) => e.includes('👍'));
  await react(a, msgId, '😂');
  await reactionState(b, a, msgId, (e) => e.includes('😂'));
  await react(b, msgId, '😮');
  await reactionState(a, b, msgId, (e) => e.includes('😮'));
  await react(a, msgId, '😢');
  await reactionState(b, a, msgId, (e) => e.includes('😢'));
  await react(b, msgId, '❤️');
  await reactionState(a, b, msgId, (e) => e.length >= 5);

  // Open the chat and measure: chips must sit within the bubble's horizontal box.
  await a.page.evaluate((id) => (window as any).__ringTest.navigate(`/chat/${id}`), aChat);
  await a.page.waitForFunction((id: string) => (window as any).__ringTest.isChatActive(id), aChat, { timeout: 30_000 });
  const row = a.page.locator('.bubble-col', { has: a.page.locator('.reactions') }).last();
  const bubble = (await row.locator('.bubble').first().boundingBox())!;
  const chips = (await row.locator('.reactions').first().boundingBox())!;
  expect(chips.x).toBeGreaterThanOrEqual(bubble.x - 2);
  expect(chips.x + chips.width).toBeLessThanOrEqual(bubble.x + bubble.width + 2);

  await ctxA.close();
  await ctxB.close();
});
