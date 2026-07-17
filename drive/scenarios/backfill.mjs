// Spec 1014 T011/T030 — the on-open backfill derives thumbnail tiers for legacy media (stored
// before tiers existed). Seed a real tier-less image, open the chat, confirm tiers appear.
//   node drive/scenarios/backfill.mjs   (make start must be up)
import { createAccount, pair, chatWith, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Ada' });
const b = await createAccount({ name: 'Bel' });
await pair(a, b);
const aChat = await chatWith(a, b.id);

const msgId = await a.page.evaluate((id) => window.__ringTest.seedLegacyImage(id, 1280, 960), aChat);
console.log('[backfill] before:', JSON.stringify(await a.page.evaluate((m) => window.__ringTest.mediaTierDims(m), msgId)));

// Open the chat → scheduleThumbBackfill runs at idle and derives the tiers.
await a.page.goto(`http://localhost:5173/chat/${aChat}`);
await a.page.waitForFunction(() => !!window.__ringTest, { timeout: 15000 });
const after = await a.page.evaluate(async (m) => {
  for (let i = 0; i < 100; i++) {
    const t = await window.__ringTest.mediaTierDims(m);
    if (t.bubble && t.grid && t.strip) return t;
    await new Promise((r) => setTimeout(r, 200));
  }
  return await window.__ringTest.mediaTierDims(m);
}, msgId);
console.log('[backfill] after:', JSON.stringify(after));

await sweep([a, b]);
await done();
