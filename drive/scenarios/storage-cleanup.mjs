// Spec 1014 US4 visual verification: thumbnail-aware storage management + "free space, keep
// previews" (the preview still renders after the original is freed). Run with `make start` up:
//   node drive/scenarios/storage-cleanup.mjs   (or HEADED=1 …)
import { createAccount, pair, chatWith, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Ada' });
const b = await createAccount({ name: 'Bel' });
await pair(a, b);
const aChat = await chatWith(a, b.id);

await a.page.evaluate((id) => window.__ringTest.sendImage(id, 1600, 1200), aChat);
await a.page.evaluate(async (id) => {
  for (let k = 0; k < 100; k++) {
    const ms = await window.__ringTest.messages(id);
    const m = ms.find((x) => x.kind === 'image');
    if (m) {
      const t = await window.__ringTest.mediaTierDims(m.id);
      if (t.full && t.bubble) return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}, aChat);

// Storage management BEFORE freeing — previews shown distinctly from originals.
await a.page.goto('http://localhost:5173/settings/storage-manage');
await a.page.waitForTimeout(1200);
await shot(a, 'storage-01-before', {});
const before = await a.page.evaluate(() => window.__ringTest.storageByType());
console.log('[storage] before:', JSON.stringify({ total: before.total, thumbsTotal: before.thumbsTotal }));

// Free originals but keep previews.
await a.page.evaluate(() => window.__ringTest.freeKeepingPreviews());
await a.page.waitForTimeout(600);
const after = await a.page.evaluate(() => window.__ringTest.storageByType());
console.log('[storage] after freeKeepingPreviews:', JSON.stringify({ total: after.total, thumbsTotal: after.thumbsTotal }));

// The chat bubble STILL renders its preview after the original was freed (FR-018).
await a.page.goto(`http://localhost:5173/chat/${aChat}`);
await a.page.waitForTimeout(1200);
const bubbleVisible = await a.page.locator('.bubble .bubble-image').last().isVisible();
console.log('[storage] bubble preview still renders after free:', bubbleVisible);
await shot(a, 'storage-02-bubble-after-free', {});

await sweep([a, b]);
await done();
