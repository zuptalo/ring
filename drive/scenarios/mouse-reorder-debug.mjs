// Debug: e2e mouse drag-reorder became a no-op. Reproduce the exact e2e gesture
// (mouse, await proxy, nudge, glide, drop) with event logging.
import { createAccount, pair, say, waitForMessage, poll, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Me', label: 'A' });
const b = await createAccount({ name: 'Biz', label: 'B' });
const c = await createAccount({ name: 'Cyr', label: 'C' });
await pair(a, b);
await pair(a, c);
const chatB = await a.page.evaluate((p) => window.__ringTest.chatWith(p), b.id);
const chatC = await a.page.evaluate((p) => window.__ringTest.chatWith(p), c.id);
await a.page.evaluate((id) => window.__ringTest.pinChat(id, true), chatB);
await a.page.evaluate((id) => window.__ringTest.pinChat(id, true), chatC);
await a.page.getByText("I'VE SAVED IT").click();
await a.page.waitForTimeout(500);
await a.page.goto('/tabs/chats');
await poll(() => a.page.locator('.pin-tile').count(), (n) => n >= 2, { label: '2 tiles' });

await a.page.evaluate(() => {
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    document.addEventListener(
      t,
      (e) => console.log(`[evt] ${t} ${Math.round(e.clientX)},${Math.round(e.clientY)} target=${e.target?.className?.toString?.().slice(0, 30) ?? e.target?.tagName}`),
      true,
    );
  }
});

const gridOrder = () =>
  a.page.locator('.pin-tile[data-chat-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-chat-id')));
console.log("[order] before:", JSON.stringify(await gridOrder()));

const tC = await a.page.locator(`.pin-tile[data-chat-id="${chatC}"]`).boundingBox();
const tB = await a.page.locator(`.pin-tile[data-chat-id="${chatB}"]`).boundingBox();
const from = { x: tC.x + tC.width / 2, y: tC.y + tC.height / 2 };
const to = { x: tB.x + tB.width / 2, y: tB.y + tB.height / 2 };
await a.page.mouse.move(from.x, from.y);
await a.page.mouse.down();
await poll(() => a.page.locator('.drag-proxy').count(), (n) => n === 1, { label: 'proxy up' });
console.log('[state] proxy visible, nudging');
await a.page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
await a.page.mouse.move(to.x, to.y, { steps: 12 });
await a.page.waitForTimeout(150);
console.log('[state] before mouseup, ghost count:', await a.page.locator('.pin-ghost').count());
await a.page.mouse.up();
await a.page.waitForTimeout(800);
console.log("[order] after:", JSON.stringify(await gridOrder()), "(expect C first)");
await shot(a, 'mousedbg-after');

await sweep([a, b, c]);
await done();
