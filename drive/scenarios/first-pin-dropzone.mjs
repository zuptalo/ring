// Verify (spec 1045 follow-up): with NO pins yet, lifting a row shows the
// first-pin drop zone, and dropping the row on it creates the first pin.
import { createAccount, pair, say, waitForMessage, poll, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Me', label: 'A', mobile: true });
const b = await createAccount({ name: 'Biz', label: 'B' });
await pair(a, b);
await say(b, a.id, 'hi'); await waitForMessage(a, b.id, 'hi');
await a.page.getByText("I'VE SAVED IT").click();
await a.page.waitForTimeout(500);
await a.page.goto('/tabs/chats');
await poll(() => a.page.locator('ion-item-sliding').count(), (n) => n >= 1, { label: 'row' });
console.log('[state] tiles before (expect 0):', await a.page.locator('.pin-tile').count());

const cdp = await a.page.context().newCDPSession(a.page);
const row = await a.page.locator('ion-item-sliding').first().boundingBox();
const from = { x: row.x + row.width / 2, y: row.y + row.height / 2 };
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
await a.page.waitForTimeout(550); // lift
await poll(() => a.page.locator('.pin-dropzone').count(), (n) => n === 1, { label: 'drop zone appears' });
const zone = await a.page.locator('.pin-dropzone').boundingBox();
const to = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
for (let i = 1; i <= 10; i++) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 }],
  });
  await a.page.waitForTimeout(30);
}
await a.page.waitForTimeout(250);
await shot(a, 'firstpin-hover');
console.log('[state] zone hover class:', await a.page.locator('.pin-dropzone.hover').count());
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await poll(() => a.page.locator('.pin-tile').count(), (n) => n === 1, { label: 'first pin created' });
console.log('[ok] first chat pinned via the drop zone');
await shot(a, 'firstpin-done');

await sweep([a, b]);
await done();
