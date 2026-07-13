// Debug: first-pin drop zone with MOUSE (the e2e path) — zone appears but the
// drop doesn't pin. Log pointer events + final URL.
import { createAccount, pair, say, waitForMessage, poll, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Me', label: 'A' });
const b = await createAccount({ name: 'Biz', label: 'B' });
await pair(a, b);
await say(b, a.id, 'hi'); await waitForMessage(a, b.id, 'hi');
await a.page.getByText("I'VE SAVED IT").click();
await a.page.waitForTimeout(500);
await a.page.goto('/tabs/chats');
await poll(() => a.page.locator('ion-item-sliding').count(), (n) => n >= 1, { label: 'row' });
await a.page.evaluate(() => {
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click']) {
    document.addEventListener(t, (e) => console.log(`[evt] ${t} ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
  }
});
const row = await a.page.locator('ion-item-sliding').first().boundingBox();
await a.page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
await a.page.mouse.down();
await poll(() => a.page.locator('.drag-proxy').count(), (n) => n === 1, { label: 'proxy' });
await poll(() => a.page.locator('.pin-dropzone').count(), (n) => n === 1, { label: 'zone' });
const zone = await a.page.locator('.pin-dropzone').boundingBox();
console.log('[state] zone box:', JSON.stringify(zone));
await a.page.mouse.move(row.x + row.width / 2 + 12, row.y + row.height / 2 + 12, { steps: 3 });
await a.page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 10 });
await a.page.waitForTimeout(200);
console.log('[state] hover class mid-drag:', await a.page.locator('.pin-dropzone.hover').count());
await a.page.mouse.up();
await a.page.waitForTimeout(800);
console.log('[state] tiles after drop:', await a.page.locator('.pin-tile').count());
console.log('[state] url:', a.page.url());
await shot(a, 'firstpin-mouse');
await sweep([a, b]);
await done();
