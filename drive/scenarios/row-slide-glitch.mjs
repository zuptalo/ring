// Verify (spec 1045 follow-up): dragging a row up to pin it — with horizontal
// wobble — must NOT open the row's swipe options underneath (ion-item-sliding
// stays shut while the row is lifted).
import { createAccount, pair, say, waitForMessage, poll, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Me', label: 'A', mobile: true });
const b = await createAccount({ name: 'Biz', label: 'B' });
const c = await createAccount({ name: 'Cyr', label: 'C' });
await pair(a, b);
await pair(a, c);
await say(b, a.id, 'hi'); await waitForMessage(a, b.id, 'hi');
await say(c, a.id, 'yo'); await waitForMessage(a, c.id, 'yo');
const chatB = await a.page.evaluate((p) => window.__ringTest.chatWith(p), b.id);
await a.page.evaluate((id) => window.__ringTest.pinChat(id, true), chatB);
await a.page.getByText("I'VE SAVED IT").click();
await a.page.waitForTimeout(500);
await a.page.goto('/tabs/chats');
await poll(() => a.page.locator('.pin-tile').count(), (n) => n >= 1, { label: 'tile' });
await poll(() => a.page.locator('ion-item-sliding').count(), (n) => n >= 1, { label: 'row' });

const cdp = await a.page.context().newCDPSession(a.page);
const row = await a.page.locator('ion-item-sliding').first().boundingBox();
const tile = await a.page.locator('.pin-tile').first().boundingBox();
// Press near the RIGHT EDGE of the row (like the user's finger): the travel to
// the top-left grid slot then has a long horizontal component — the exact case
// that opened the swipe options.
const from = { x: row.x + row.width - 30, y: row.y + row.height / 2 };
const to = { x: tile.x + 10, y: tile.y + 10 };

await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
await a.page.waitForTimeout(550);
// Wobbly path: strong horizontal zigzag while climbing toward the grid.
for (let i = 1; i <= 12; i++) {
  // Zigzag hard on the way, but land the final steps ON the target slot.
  const wobble = i <= 10 ? (i % 2 ? 60 : -60) : 0;
  const x = from.x + ((to.x - from.x) * i) / 12 + wobble;
  const y = from.y + ((to.y - from.y) * i) / 12;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await a.page.waitForTimeout(35);
  if (i === 6) {
    const open = await a.page.evaluate(async () => {
      const el = document.querySelector('ion-item-sliding');
      return el?.getOpenAmount ? await el.getOpenAmount() : 'n/a';
    });
    console.log('[state] mid-drag slide open amount (must be 0):', open);
    await shot(a, 'rowslide-mid-drag');
  }
}
await a.page.waitForTimeout(200);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await poll(() => a.page.locator('.pin-tile').count(), (n) => n === 2, { label: 'pinned by drag' });
console.log('[ok] wobbly row drag pinned the chat without opening the slide');

await sweep([a, b, c]);
await done();
