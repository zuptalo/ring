// Verify (spec 1045 follow-up): the pin drags work with REAL TOUCH events (CDP),
// not just mouse — drag-out-to-unpin died on iOS because (a) the grid unmounted
// the touch target at lift and (b) Ionic's button touch-action let the browser
// steal the vertical drag as a scroll. Logs pointercancel so a scroll-hijack is
// visible in the output.
import { createAccount, pair, say, waitForMessage, poll, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Me', label: 'A', mobile: true });
const b = await createAccount({ name: 'Biz', label: 'B' });
const c = await createAccount({ name: 'Cyr', label: 'C' });
await pair(a, b);
await pair(a, c);
await say(b, a.id, 'hi from b');
await waitForMessage(a, b.id, 'hi from b');
await say(c, a.id, 'hi from c');
await waitForMessage(a, c.id, 'hi from c');

const chatB = await a.page.evaluate((p) => window.__ringTest.chatWith(p), b.id);
const chatC = await a.page.evaluate((p) => window.__ringTest.chatWith(p), c.id);
for (const id of [chatB, chatC]) {
  await a.page.evaluate((cid) => window.__ringTest.pinChat(cid, true), id);
}
await a.page.getByText("I'VE SAVED IT").click();
await a.page.waitForTimeout(600);
await a.page.goto('/tabs/chats');
await poll(() => a.page.locator('.pin-tile').count(), (n) => n >= 2, { label: '2 tiles' });

await a.page.evaluate(() => {
  document.addEventListener('pointercancel', () => console.log('[evt] POINTERCANCEL — browser stole the gesture'), true);
});

const cdp = await a.page.context().newCDPSession(a.page);
async function touchDrag(from, to, steps = 10) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  await a.page.waitForTimeout(550); // past the 350ms lift, before the peek
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }],
    });
    await a.page.waitForTimeout(30);
  }
  await a.page.waitForTimeout(250);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const center = (b2) => ({ x: b2.x + b2.width / 2, y: b2.y + b2.height / 2 });
const gridOrder = () =>
  a.page.locator('.pin-tile[data-chat-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-chat-id')));

// 1) TOUCH drag tile C down into the list → unpins.
const tC = await a.page.locator(`.pin-tile[data-chat-id="${chatC}"]`).boundingBox();
const grid = await a.page.locator('.pin-grid').boundingBox();
await touchDrag(center(tC), { x: grid.x + grid.width / 2, y: grid.y + grid.height + 200 });
await poll(() => a.page.locator('.pin-tile').count(), (n) => n === 1, { label: 'touch unpin → 1 tile' });
console.log('[ok] touch drag-out unpinned');
await shot(a, 'touchdrag-after-unpin');

// 2) TOUCH drag the C row back into the grid at slot 0 → pinned first.
const row = await a.page.locator('ion-item-sliding').first().boundingBox();
const tB = await a.page.locator(`.pin-tile[data-chat-id="${chatB}"]`).boundingBox();
await touchDrag(center(row), { x: tB.x + 8, y: tB.y + 8 });
await poll(() => a.page.locator('.pin-tile').count(), (n) => n === 2, { label: 'touch pin → 2 tiles' });
console.log('[order] after row pinned at 0:', await gridOrder(), '(expect C first)');

// 3) TOUCH drag reorder: C onto B's slot → order flips back.
const tC2 = await a.page.locator(`.pin-tile[data-chat-id="${chatC}"]`).boundingBox();
const tB2 = await a.page.locator(`.pin-tile[data-chat-id="${chatB}"]`).boundingBox();
await touchDrag(center(tC2), center(tB2));
await a.page.waitForTimeout(600);
console.log('[order] after reorder:', await gridOrder(), '(expect B first)');
await shot(a, 'touchdrag-final');

await sweep([a, b, c]);
await done();
