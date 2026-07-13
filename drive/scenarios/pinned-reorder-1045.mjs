// Visual check (spec 1045): user-owned pinned order — drag-reorder a tile, drag a
// tile out to unpin, drag a row in to pin, and the long-press peek overlay.
import { createAccount, pair, chatWith, say, waitForMessage, poll, shot, sweep, done } from '../driver.mjs';

async function paintAvatar(p, name, color) {
  await p.page.evaluate(
    async ({ nm, col }) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = col;
      g.beginPath();
      g.arc(64, 64, 64, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 64px -apple-system, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(nm[0], 64, 70);
      await window.__ringTest.setProfile(nm, c.toDataURL('image/png'));
    },
    { nm: name, col: color },
  );
}

const gridOrder = (p) =>
  p.page.locator('.pin-tile[data-chat-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-chat-id')));
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
async function drag(p, from, to, { midshot } = {}) {
  await p.page.mouse.move(from.x, from.y);
  await p.page.mouse.down();
  await p.page.waitForTimeout(550); // past the 350ms lift
  await p.page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
  await p.page.mouse.move(to.x, to.y, { steps: 12 });
  await p.page.waitForTimeout(300);
  if (midshot) await shot(p, midshot);
  await p.page.mouse.up();
}

const COLORS = ['#e74c3c', '#8e44ad', '#2980b9', '#16a085', '#d35400'];
const a = await createAccount({ name: 'Me', label: 'A' });
const peers = [];
for (const [i, name] of ['Biz', 'Feri', 'Rayan', 'Neda'].entries()) {
  const p = await createAccount({ name, label: name });
  await paintAvatar(p, name, COLORS[i]);
  await pair(a, p);
  peers.push(p);
}
for (const p of peers) {
  await say(p, a.id, `Hi from ${p.label}!`); // 1:1 → pass the PEER id, not a chat id
  await waitForMessage(a, p.id, `Hi from ${p.label}!`);
}

// Pin the first three (Biz, Feri, Rayan) — Neda stays a row.
const chatIds = [];
for (const p of peers) chatIds.push(await chatWith(a, p.id));
for (const id of chatIds.slice(0, 3)) {
  await a.page.evaluate(({ id: c }) => window.__ringTest.pinChat(c, true), { id });
}

await a.page.getByText("I'VE SAVED IT").click();
await a.page.waitForTimeout(800);
await a.page.goto('/tabs/chats');
await poll(() => a.page.locator('.pin-tile').count(), (n) => n >= 3, { label: '3 tiles' });
await a.page.waitForTimeout(600);
console.log('[order] initial:', await gridOrder(a));
await shot(a, '1045-initial');

// New message must NOT reorder (Biz stays first even though Rayan just wrote).
await say(peers[2], a.id, 'newest activity!');
await waitForMessage(a, peers[2].id, 'newest activity!');
await a.page.waitForTimeout(600);
console.log('[order] after new message (must be unchanged):', await gridOrder(a));
await shot(a, '1045-after-message');

// Drag tile 3 (Rayan) onto slot 1 — screenshot mid-drag to show the lift + gap.
const tile = (id) => a.page.locator(`.pin-tile[data-chat-id="${id}"]`);
const b3 = await tile(chatIds[2]).boundingBox();
const b1 = await tile(chatIds[0]).boundingBox();
await drag(a, center(b3), center(b1), { midshot: '1045-mid-drag' });
await a.page.waitForTimeout(600);
console.log('[order] after reorder (Rayan first):', await gridOrder(a));
await shot(a, '1045-after-reorder');

// Drag first tile out into the list → unpins.
const bOut = await tile(chatIds[2]).boundingBox();
const gbox = await a.page.locator('.pin-grid').boundingBox();
await drag(a, center(bOut), { x: gbox.x + gbox.width / 2, y: gbox.y + gbox.height + 180 });
await poll(() => a.page.locator('.pin-tile').count(), (n) => n === 2, { label: 'unpinned to 2' });
await shot(a, '1045-after-unpin');

// Drag the Neda ROW up into the grid at slot 0 → pinned there.
const rows = a.page.locator('ion-item-sliding');
const nedaRow = a.page.locator(`ion-item-sliding:has-text("Neda")`).first();
const rbox = await nedaRow.boundingBox();
const firstTile = await a.page.locator('.pin-tile[data-chat-id]').first().boundingBox();
await drag(a, center(rbox), { x: firstTile.x + 8, y: firstTile.y + 8 });
await poll(() => a.page.locator('.pin-tile').count(), (n) => n === 3, { label: 'row pinned to 3' });
console.log('[order] after row pinned at slot 0:', await gridOrder(a));
await shot(a, '1045-after-row-pin');

// Long-press peek on the first tile (hold still ~1s), light + dark.
const pk = await a.page.locator('.pin-tile[data-chat-id]').first().boundingBox();
await a.page.mouse.move(center(pk).x, center(pk).y);
await a.page.mouse.down();
await a.page.waitForTimeout(1200);
await a.page.mouse.up();
await poll(() => a.page.locator('.peek-card').count(), (n) => n === 1, { label: 'peek open' });
await a.page.waitForTimeout(400);
await shot(a, '1045-peek-light');
await a.page.emulateMedia({ colorScheme: 'dark' });
await a.page.waitForTimeout(400);
await shot(a, '1045-peek-dark');
// Tap outside closes.
await a.page.mouse.click(8, 300);
await poll(() => a.page.locator('.peek-card').count(), (n) => n === 0, { label: 'peek closed' });
await a.page.emulateMedia({ colorScheme: 'light' });

// Peek on a list ROW too.
const rowBox = await rows.first().boundingBox();
await a.page.mouse.move(center(rowBox).x, center(rowBox).y);
await a.page.mouse.down();
await a.page.waitForTimeout(1200);
await a.page.mouse.up();
await poll(() => a.page.locator('.peek-card').count(), (n) => n === 1, { label: 'row peek open' });
await a.page.waitForTimeout(400);
await shot(a, '1045-row-peek');
await a.page.mouse.click(8, 300);

await sweep([a, ...peers]);
await done();
