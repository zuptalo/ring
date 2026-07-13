// Debug (spec 1045 follow-up): peek menu actions need TWO taps on touch, and
// Delete's confirm sheet hides behind the still-open peek. Reproduce with real
// touch events (CDP) on a mobile-emulated client and log what each tap does.
import { createAccount, pair, say, waitForMessage, poll, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Me', label: 'A', mobile: true });
const b = await createAccount({ name: 'Biz', label: 'B' });
await pair(a, b);
await say(b, a.id, 'hello!');
await waitForMessage(a, b.id, 'hello!');

// Pin B so we get a tile.
const chatId = await a.page.evaluate((peer) => window.__ringTest.chatWith(peer), b.id);
await a.page.evaluate((id) => window.__ringTest.pinChat(id, true), chatId);
await a.page.getByText("I'VE SAVED IT").click();
await a.page.waitForTimeout(600);
await a.page.goto('/tabs/chats');
await poll(() => a.page.locator('.pin-tile').count(), (n) => n >= 1, { label: 'tile' });

// Log every pointerdown/click at document capture: target + defaultPrevented.
await a.page.evaluate(() => {
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    document.addEventListener(
      type,
      (e) => {
        const t = e.target;
        const desc = t?.tagName + (t?.className ? `.${String(t.className).slice(0, 40)}` : '');
        console.log(`[evt] ${type} on ${desc} defaultPrevented=${e.defaultPrevented}`);
      },
      true,
    );
  }
});

const cdp = await a.page.context().newCDPSession(a.page);
const touch = async (x, y, holdMs) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await a.page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

// Long-press the tile with TOUCH → peek.
const tile = await a.page.locator('.pin-tile').first().boundingBox();
await touch(tile.x + tile.width / 2, tile.y + tile.height / 2, 1100);
await poll(() => a.page.locator('.peek-card').count(), (n) => n === 1, { label: 'peek open' });
await a.page.waitForTimeout(400);
await shot(a, 'peekdbg-open');

// ONE touch tap on "Unpin" — does it act?
const unpin = await a.page.locator('.peek-menu ion-item').first().boundingBox();
console.log('--- tap 1 on Unpin ---');
await touch(unpin.x + unpin.width / 2, unpin.y + unpin.height / 2, 70);
await a.page.waitForTimeout(800);
console.log('[state] peek open after tap1:', await a.page.locator('.peek-card').count());
console.log('[state] tiles after tap1:', await a.page.locator('.pin-tile').count());
if (await a.page.locator('.peek-card').count()) {
  console.log('--- tap 2 on Unpin ---');
  await touch(unpin.x + unpin.width / 2, unpin.y + unpin.height / 2, 70);
  await a.page.waitForTimeout(800);
  console.log('[state] peek open after tap2:', await a.page.locator('.peek-card').count());
  console.log('[state] tiles after tap2:', await a.page.locator('.pin-tile').count());
}
await shot(a, 'peekdbg-after-unpin');

// Re-pin, open peek again with touch, then tap Delete ONCE: where is the sheet?
await a.page.evaluate((id) => window.__ringTest.pinChat(id, true), chatId);
await poll(() => a.page.locator('.pin-tile').count(), (n) => n >= 1, { label: 'tile back' });
const tile2 = await a.page.locator('.pin-tile').first().boundingBox();
await touch(tile2.x + tile2.width / 2, tile2.y + tile2.height / 2, 1100);
await poll(() => a.page.locator('.peek-card').count(), (n) => n === 1, { label: 'peek open 2' });
await a.page.waitForTimeout(400);
const del = await a.page.locator('.peek-menu ion-item:has-text("Delete")').boundingBox();
console.log('--- tap on Delete (twice if needed) ---');
await touch(del.x + del.width / 2, del.y + del.height / 2, 70);
await a.page.waitForTimeout(500);
if ((await a.page.locator('ion-action-sheet').count()) === 0) {
  await touch(del.x + del.width / 2, del.y + del.height / 2, 70);
  await a.page.waitForTimeout(500);
}
await a.page.waitForTimeout(400);
console.log('[state] action-sheet count:', await a.page.locator('ion-action-sheet').count());
console.log('[state] peek open with sheet:', await a.page.locator('.peek-card').count());
await shot(a, 'peekdbg-delete-sheet');

await sweep([a, b]);
await done();
