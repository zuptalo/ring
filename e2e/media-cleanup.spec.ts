import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);
const messages = (p: any, chatId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.messages(id), chatId);
const imageMsgId = async (p: any, chatId: string): Promise<string> =>
  (await messages(p, chatId)).find((m: any) => m.kind === 'image')?.id;

/**
 * Granular media cleanup: delete by type and by size, freeing exactly the
 * matching blobs and updating the storage totals.
 */
test('media cleanup: delete by type, then by size', async ({ browser }) => {
  const a = await createAccount(await browser.newContext(), 'MEDIACLN');
  const chat = 'chat-x';
  const seed = (kind: string, bytes: number) =>
    a.page.evaluate(([c, k, b]) => (window as any).__ringTest.seedMedia(c, k, b), [chat, kind, bytes] as const);
  const byType = (): Promise<{ total: number; byKind: Record<string, number> }> =>
    a.page.evaluate(() => (window as any).__ringTest.storageByType());

  await seed('image', 1_000_000); // 1 MB photo
  await seed('image', 2_000_000); // 2 MB photo
  await seed('video', 50_000_000); // 50 MB video (large)
  await seed('file', 500_000); // 0.5 MB doc

  let s = await byType();
  expect(s.byKind.image).toBe(3_000_000);
  expect(s.byKind.video).toBe(50_000_000);
  expect(s.byKind.file).toBe(500_000);

  // Delete all photos → only image bytes go to zero.
  await a.page.evaluate(() => (window as any).__ringTest.deleteMediaByKind(['image']));
  s = await byType();
  expect(s.byKind.image).toBe(0);
  expect(s.byKind.video).toBe(50_000_000);

  // Delete files larger than 10 MB → removes the video, keeps the small doc.
  await a.page.evaluate(() => (window as any).__ringTest.deleteMediaLargerThan(10 * 1024 * 1024));
  s = await byType();
  expect(s.byKind.video).toBe(0);
  expect(s.byKind.file).toBe(500_000);
});

/**
 * Spec 1014 US4 — storage accounting and cleanup are thumbnail-aware, scoped per chat,
 * and support "free space but keep previews".
 *  - FR-016: storage totals (by type + by chat) include thumbnail bytes, distinct from originals.
 *  - FR-017: deleting media removes all of its tiers (no orphans).
 *  - FR-018: freeKeepingPreviews removes the full image but keeps the bubble/grid/strip tiers.
 *  - FR-019: cleanup is per-chat (scoped) as well as app-wide.
 */
test('storage: thumbnail-aware accounting, keep-previews, per-chat cleanup', async ({ browser }) => {
  const a = await createAccount(await browser.newContext(), 'STORA1');
  const b = await createAccount(await browser.newContext(), 'STORB1');
  const c = await createAccount(await browser.newContext(), 'STORC1');
  await pair(a, b);
  await pair(a, c);
  const chatB = (await chatWith(a, b.id)) as string;
  const chatC = (await chatWith(a, c.id)) as string;

  // A real image into each chat (the sender keeps the original + generates the tiers).
  await a.page.evaluate((id) => (window as any).__ringTest.sendImage(id, 1024, 768, 'b.png'), chatB);
  await a.page.evaluate((id) => (window as any).__ringTest.sendImage(id, 1024, 768, 'c.png'), chatC);
  // Wait until both originals + tiers are persisted.
  const tiersReady = (chatId: string) =>
    a.page.evaluate(async (id) => {
      for (let i = 0; i < 100; i++) {
        const ms = await (window as any).__ringTest.messages(id);
        const m = ms.find((x: any) => x.kind === 'image');
        if (m) {
          const t = await (window as any).__ringTest.mediaTierDims(m.id);
          if (t.full && t.bubble && t.grid && t.strip) return true;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    }, chatId);
  expect(await tiersReady(chatB)).toBe(true);
  expect(await tiersReady(chatC)).toBe(true);

  // FR-016: by-type totals include thumbnail bytes, distinct from (and smaller than) originals.
  const t0 = await a.page.evaluate(() => (window as any).__ringTest.storageByType());
  expect(t0.thumbsTotal).toBeGreaterThan(0);
  expect(t0.thumbsByKind.image).toBeGreaterThan(0);
  expect(t0.total).toBeGreaterThan(t0.thumbsTotal); // originals dwarf previews

  // FR-016: per-chat totals include thumbnail bytes distinctly.
  const sc0 = await a.page.evaluate(() => (window as any).__ringTest.storageByChat());
  const rowC0 = sc0.find((r: any) => r.chatId === chatC);
  expect(rowC0.bytes).toBeGreaterThan(0); // originals
  expect(rowC0.bytesThumbs).toBeGreaterThan(0); // previews

  // FR-018: free chat C's space but keep previews → original gone, all three tiers remain.
  const cMsg = await imageMsgId(a, chatC);
  await a.page.evaluate((id) => (window as any).__ringTest.freeKeepingPreviews(id), chatC);
  const cDims = await a.page.evaluate((id) => (window as any).__ringTest.mediaTierDims(id), cMsg);
  expect(cDims.full).toBeNull(); // original freed
  expect(cDims.bubble).not.toBeNull();
  expect(cDims.grid).not.toBeNull();
  expect(cDims.strip).not.toBeNull();
  const sc1 = await a.page.evaluate(() => (window as any).__ringTest.storageByChat());
  const rowC1 = sc1.find((r: any) => r.chatId === chatC);
  expect(rowC1?.bytes ?? 0).toBe(0); // originals reclaimed
  expect(rowC1?.bytesThumbs ?? 0).toBeGreaterThan(0); // previews retained

  // FR-018: the preview still renders in chat C's bubble after freeing the original.
  await a.page.goto(`/chat/${chatC}`);
  await expect(a.page.locator('.bubble .bubble-image').last()).toBeVisible({ timeout: 30_000 });

  // FR-017 + FR-019: deleting chat B's images removes their tiers (no orphan) and is scoped to chat B.
  const bMsg = await imageMsgId(a, chatB);
  await a.page.evaluate((id) => (window as any).__ringTest.deleteMediaByKind(['image'], id), chatB);
  const bDims = await a.page.evaluate((id) => (window as any).__ringTest.mediaTierDims(id), bMsg);
  expect(bDims.full).toBeNull();
  expect(bDims.bubble).toBeNull(); // tiers removed with the record — no orphan
  // Chat C is untouched by the chat-B cleanup (per-chat scope).
  const cDims2 = await a.page.evaluate((id) => (window as any).__ringTest.mediaTierDims(id), cMsg);
  expect(cDims2.bubble).not.toBeNull();
});

// spec 2007: media/docs DELETED to free space must vanish from the Media/Docs gallery
// tabs, not leave empty placeholder tiles/rows (they keep a "removed to free space"
// bubble in the chat itself, which is separate). Freed-with-previews items still show.
test('gallery: media + docs deleted to free space leave no placeholder', async ({ browser }) => {
  const a = await createAccount(await browser.newContext(), 'GALLERY1');
  const chat = 'gallery-chat';
  const seed = (kind: string, bytes: number) =>
    a.page.evaluate(([c, k, b]) => (window as any).__ringTest.seedMedia(c, k, b), [chat, kind, bytes] as const);
  const counts = () =>
    a.page.evaluate(async (c) => {
      const q = await import('/src/db/queries.ts');
      return { media: (await q.listChatMedia(c)).length, docs: (await q.listChatDocs(c)).length };
    }, chat);

  await seed('image', 20 * 1024 * 1024);
  await seed('video', 30 * 1024 * 1024);
  await seed('file', 15 * 1024 * 1024);
  await seed('image', 1024); // small image — survives a ">10MB" delete

  expect(await counts()).toEqual({ media: 3, docs: 1 });

  // Delete everything >10MB: those media + docs leave the gallery entirely.
  await a.page.evaluate((c) => (window as any).__ringTest.deleteMediaLargerThan(10 * 1024 * 1024, c), chat);
  expect(await counts()).toEqual({ media: 1, docs: 0 }); // only the small image remains
});
