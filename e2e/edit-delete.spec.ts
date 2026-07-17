import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

const messages = (p: any, chatId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.messages(id), chatId);

const send = (p: any, chatId: string, body: string) =>
  p.page.evaluate(
    (args: [string, string]) => (window as any).__ringTest.sendChatMessage(args[0], args[1]),
    [chatId, body] as [string, string],
  );

/** Wait until B has A's message with this body, then return its (shared) id. */
async function waitForBody(p: any, chatId: string, body: string): Promise<string> {
  await expect
    .poll(async () => ((await messages(p, chatId)) as any[]).find((m) => m.body === body)?.id ?? '', {
      timeout: 30_000,
    })
    .not.toBe('');
  return ((await messages(p, chatId)) as any[]).find((m) => m.body === body).id as string;
}

/**
 * Message edit + delete-for-everyone ride the E2EE side-effect channel (like
 * reactions): an edit rewrites the peer's copy in place (with an editedAt
 * stamp); a traced delete leaves the "deleted" placeholder on both sides; a
 * no-trace delete removes the row outright on both sides.
 */
test('edit and both delete-for-everyone modes propagate to the peer', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'EDITDEL1');
  const b = await createAccount(ctxB, 'EDITDEL2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  expect(aChat).toBeTruthy();

  // --- edit: B's copy is rewritten in place and stamped edited ---
  await send(a, aChat, 'first draft');
  const bChat = (await chatWith(b, a.id)) as string;
  const editId = await waitForBody(b, bChat, 'first draft');
  await a.page.evaluate(
    (args: [string, string]) => (window as any).__ringTest.editChatMessage(args[0], args[1]),
    [editId, 'final wording'] as [string, string],
  );
  await expect
    .poll(async () => ((await messages(b, bChat)) as any[]).find((m) => m.id === editId)?.body, {
      timeout: 30_000,
    })
    .toBe('final wording');
  const edited = ((await messages(b, bChat)) as any[]).find((m) => m.id === editId);
  expect(edited.editedAt).toBeTruthy();

  // --- traced delete (default): both sides keep the placeholder row ---
  await send(a, aChat, 'take this back');
  const tracedId = await waitForBody(b, bChat, 'take this back');
  await a.page.evaluate((id: string) => (window as any).__ringTest.deleteForEveryone(id, true), tracedId);
  await expect
    .poll(
      async () => {
        const m = ((await messages(b, bChat)) as any[]).find((x) => x.id === tracedId);
        return m ? { deleted: !!m.deleted, body: m.body } : null;
      },
      { timeout: 30_000 },
    )
    .toEqual({ deleted: true, body: '' });

  // --- no-trace delete: the row vanishes outright on both sides ---
  await send(a, aChat, 'never happened');
  const ghostId = await waitForBody(b, bChat, 'never happened');
  await a.page.evaluate((id: string) => (window as any).__ringTest.deleteForEveryone(id, false), ghostId);
  await expect
    .poll(async () => ((await messages(b, bChat)) as any[]).some((m) => m.id === ghostId), {
      timeout: 30_000,
    })
    .toBe(false);
  // A's own copy is gone too (and the edit earlier never created extra rows).
  const aMsgs = (await messages(a, aChat)) as any[];
  expect(aMsgs.some((m) => m.id === ghostId)).toBe(false);
  expect(aMsgs.find((m) => m.id === editId)?.body).toBe('final wording');

  await ctxA.close();
  await ctxB.close();
});
