import { test, expect } from '@playwright/test';
import { createAccount, pair, type RingClient } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: RingClient, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

const audioMsgId = async (p: RingClient, chatId: string): Promise<string> => {
  const ms = (await p.page.evaluate(
    (c: string) => (window as any).__ringTest.messages(c),
    chatId,
  )) as Array<{ id: string; kind: string }>;
  return ms.find((m) => m.kind === 'audio')?.id ?? '';
};

const mediaInfo = (p: RingClient, msgId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.mediaInfo(id), msgId) as Promise<{
    hasMedia: boolean;
    pending: boolean;
    sentBlobId: string | null;
  }>;

const blobExists = (p: RingClient, blobId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.blobExists(id), blobId) as Promise<boolean>;

/**
 * Media blob lifecycle: a sender's encrypted media blob is deleted from the server the
 * moment the recipient confirms it has downloaded the bytes — instant cleanup of big media
 * once it's no longer needed, instead of waiting for the age-based backstop sweep.
 */
test('media blob is deleted server-side once the recipient has downloaded it', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'BLOBDEL1');
  const b = await createAccount(ctxB, 'BLOBDEL2');
  await pair(a, b);

  // A sends an audio message (uploads a real encrypted blob via the background job).
  const aChat = (await chatWith(a, b.id)) as string;
  expect(aChat).toBeTruthy();
  await a.page.evaluate((id) => (window as any).__ringTest.sendAudio(id, 'clip', 'Title', 'Artist'), aChat);

  // Wait for the upload to finish and A to record the server blob id it must later delete.
  await expect.poll(() => audioMsgId(a, aChat), { timeout: 30_000 }).not.toBe('');
  const msgId = await audioMsgId(a, aChat);
  let blobId = '';
  await expect
    .poll(
      async () => {
        blobId = (await mediaInfo(a, msgId)).sentBlobId ?? '';
        return blobId;
      },
      { timeout: 30_000 },
    )
    .not.toBe('');

  // The blob is on the server (a second account holding the id can fetch it).
  expect(await blobExists(b, blobId)).toBe(true);

  // B receives the message and downloads its media bytes.
  await b.page.waitForFunction(
    async (aid) => {
      const c = await (window as any).__ringTest.chatWith(aid);
      if (!c) return false;
      const ms = await (window as any).__ringTest.messages(c);
      return ms.some((m: any) => m.kind === 'audio');
    },
    a.id,
    { timeout: 30_000 },
  );
  const bChat = (await chatWith(b, a.id)) as string;
  await b.page.evaluate((id: string) => (window as any).__ringTest.downloadMedia(id), msgId);
  await expect.poll(async () => (await mediaInfo(b, msgId)).hasMedia, { timeout: 30_000 }).toBe(true);

  // B confirms the download to A (the 'downloaded' receipt the UI sends on view).
  await b.page.evaluate((c: string) => (window as any).__ringTest.confirmDownloads(c), bChat);

  // A, on receiving the confirmation, deletes the blob and clears its id (so it never retries).
  await expect.poll(async () => (await mediaInfo(a, msgId)).sentBlobId, { timeout: 30_000 }).toBeNull();

  // And the blob is gone from the server.
  expect(await blobExists(b, blobId)).toBe(false);

  await ctxA.close();
  await ctxB.close();
});
