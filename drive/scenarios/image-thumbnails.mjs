// Spec 1014 US1 drive verification: share a real, large image and capture the three
// thumbnail tiers in their surfaces — the chat bubble (bubble tier), the all-media grid
// (grid tier), and the full-screen viewer's bottom strip (strip tier). Run with the live
// `make start` stack up:  node drive/scenarios/image-thumbnails.mjs  (or HEADED=1 …).
import { createAccount, pair, chatWith, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Ada' });
const b = await createAccount({ name: 'Bel' });
await pair(a, b);

const aChat = await chatWith(a, b.id);
const bChat = await chatWith(b, a.id);

// Send three real gradient images of different shapes through the genuine E2EE pipeline.
for (const [w, h] of [[1280, 960], [1024, 1024], [900, 1600]]) {
  await a.page.evaluate(([id, ww, hh]) => window.__ringTest.sendImage(id, ww, hh), [aChat, w, h]);
}

// Wait until the receiver has all three images on-device (auto-download).
await b.page.evaluate(async (id) => {
  for (let i = 0; i < 150; i++) {
    const ms = await window.__ringTest.messages(id);
    if (ms.filter((m) => m.kind === 'image').length >= 3) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}, bChat);

// 1) Chat bubbles — rendered from the bubble tier.
await b.page.goto(`http://localhost:5173/chat/${bChat}`);
await b.page.waitForTimeout(1200);
await shot(b, 'thumbs-01-bubbles', {});

// 2) All-media grid — rendered from the grid tier.
await b.page.goto(`http://localhost:5173/chat/${bChat}/media`);
await b.page.waitForTimeout(1200);
await shot(b, 'thumbs-02-grid', {});

// 3) Full-screen viewer — main image (full) + bottom strip (strip tier).
await b.page.locator('.media-grid .media-cell').first().click();
await b.page.waitForTimeout(1000);
await shot(b, 'thumbs-03-viewer-strip', {});

// Report the persisted tier dimensions for the first image (proof of right-sizing).
const dims = await b.page.evaluate(async (id) => {
  const ms = await window.__ringTest.messages(id);
  const img = ms.find((m) => m.kind === 'image');
  return img ? window.__ringTest.mediaTierDims(img.id) : null;
}, bChat);
console.log('[thumbs] receiver tier dims:', JSON.stringify(dims));

await sweep([a, b]);
await done();
