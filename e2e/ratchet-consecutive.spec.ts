import { test, expect } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 2033 — consecutive sealed frames on a fresh carrier session.
//
// In a group whose members aren't all mutually paired, a co-member pair's
// Double-Ratchet session is the group's hidden 1:1 carrier, bootstrapped on
// demand. The field bug (found by spec 1050's fan-out e2e): the RESPONDER
// side's SECOND consecutive frame — sent with no frame received in between —
// failed to decrypt on the initiator ("ciphertext cannot be decrypted") and,
// since the relay had already dropped it, was lost forever. FR-001: a member
// must be able to send arbitrarily many consecutive frames.

const sendMsg = (c: RingClient, chatId: string, body: string): Promise<void> =>
  c.page.evaluate(({ id, b }) => (window as any).__ringTest.sendChatMessage(id, b), { id: chatId, b: body });
const awaitBody = (c: RingClient, chatId: string, body: string): Promise<unknown> =>
  c.page.waitForFunction(
    ({ id, b }) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.some((m: any) => m.body === b)),
    { id: chatId, b: body },
    { timeout: 30_000 },
  );
const setProfile = (c: RingClient, name: string): Promise<void> =>
  c.page.evaluate((n) => (window as any).__ringTest.setProfile(n, ''), name);
// Poll via evaluate (NOT waitForFunction + jsonValue, which returns undefined
// for ids often enough to flake — e2e lesson from spec 1048).
const msgIdOf = async (c: RingClient, chatId: string, body: string): Promise<string> => {
  for (let i = 0; i < 60; i++) {
    const id = (await c.page.evaluate(
      ({ cid, b }) => (window as any).__ringTest.messages(cid).then((ms: any[]) => ms.find((m: any) => m.body === b)?.id ?? null),
      { cid: chatId, b: body },
    )) as string | null;
    if (id) return id;
    await c.page.waitForTimeout(500);
  }
  throw new Error(`message "${body}" never appeared in ${chatId}`);
};
const react = (c: RingClient, messageId: string, emoji: string): Promise<void> =>
  c.page.evaluate(({ id, e }) => (window as any).__ringTest.reactToMessage(id, e), { id: messageId, e: emoji });
const emojisOn = (c: RingClient, chatId: string, messageId: string): Promise<string[]> =>
  c.page.evaluate(
    ({ cid, mid }) =>
      (window as any).__ringTest
        .messages(cid)
        .then((ms: any[]) => (ms.find((m: any) => m.id === mid)?.reactions ?? []).map((r: any) => r.emoji)),
    { cid: chatId, mid: messageId },
  );

test('a responder can send many consecutive frames over a fresh carrier session (FR-001)', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [a, b, c] = await Promise.all(
    ['RAT1A', 'RAT1B', 'RAT1C'].map((code, i) => createAccount(ctx[i], code)),
  );
  // Profiles first (the 1050 repro had them): contact/profile cards ride the
  // same pairwise sessions as messages, so they're part of the field traffic.
  await setProfile(a, 'Alice');
  await setProfile(b, 'Bob');
  await setProfile(c, 'Carol');
  // B and C are deliberately NOT paired: their pairwise session is the group's
  // hidden carrier, bootstrapped when B first fans out to C.
  await pair(a, b);
  await pair(a, c);

  const gid = (await a.page.evaluate(
    (ids) => (window as any).__ringTest.createGroup('Ratchet crew', ids),
    [b.id, c.id],
  )) as string;
  for (const p of [b, c]) {
    await p.page.waitForFunction(
      (g) => (window as any).__ringTest.groupChats().then((gs: any[]) => gs.some((x: any) => x.id === g)),
      gid,
      { timeout: 30_000 },
    );
  }

  // A speaks; then B speaks FIRST (B initiates X3DH B→C), serialized so B and C
  // can't both initiate the pair session (that fork is a separate known issue).
  await sendMsg(a, gid, 'hello crew');
  for (const p of [b, c]) await awaitBody(p, gid, 'hello crew');
  await sendMsg(b, gid, 'bob here');
  for (const p of [a, c]) await awaitBody(p, gid, 'bob here');

  // C's first frame rides the freshly-established responder side — this works.
  await sendMsg(c, gid, 'carol 1');
  for (const p of [a, b]) await awaitBody(p, gid, 'carol 1');

  // The bug: with B staying silent, C's SECOND consecutive frame was lost on B.
  // The field repro's second frame was a REACTION (to Alice's message) — use
  // exactly that, then more plain messages to pin the whole chain.
  const helloId = await msgIdOf(c, gid, 'hello crew');
  await react(c, helloId, '🔥');
  for (const p of [a, b]) {
    await expect
      .poll(async () => emojisOn(p, gid, await msgIdOf(p, gid, 'hello crew')), { timeout: 30_000 })
      .toContain('🔥');
  }
  await sendMsg(c, gid, 'carol 2');
  await sendMsg(c, gid, 'carol 3');
  for (const p of [a, b]) {
    await awaitBody(p, gid, 'carol 2');
    await awaitBody(p, gid, 'carol 3');
  }

  await Promise.all(ctx.map((x) => x.close()));
});
