// Debug (spec 1045 follow-up): after a drag-reorder, the moved tile's NAME stays
// hidden until the next drag. Reorder by touch, then dump each tile's classes and
// the computed visibility of its .pin-name.
import { createAccount, pair, say, waitForMessage, poll, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Me', label: 'A', mobile: true });
const b = await createAccount({ name: 'Biz', label: 'B' });
const c = await createAccount({ name: 'Cyr', label: 'C' });
await pair(a, b);
await pair(a, c);
await say(b, a.id, 'hi'); await waitForMessage(a, b.id, 'hi');
await say(c, a.id, 'yo'); await waitForMessage(a, c.id, 'yo');
const chatB = await a.page.evaluate((p) => window.__ringTest.chatWith(p), b.id);
const chatC = await a.page.evaluate((p) => window.__ringTest.chatWith(p), c.id);
await a.page.evaluate((id) => window.__ringTest.pinChat(id, true), chatB);
await a.page.evaluate((id) => window.__ringTest.pinChat(id, true), chatC);
await a.page.getByText("I'VE SAVED IT").click();
await a.page.waitForTimeout(500);
await a.page.goto('/tabs/chats');
await poll(() => a.page.locator('.pin-tile').count(), (n) => n >= 2, { label: '2 tiles' });

const cdp = await a.page.context().newCDPSession(a.page);
async function touchDrag(from, to, steps = 10) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  await a.page.waitForTimeout(550);
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
const center = (bx) => ({ x: bx.x + bx.width / 2, y: bx.y + bx.height / 2 });

const dump = () =>
  a.page.evaluate(() =>
    [...document.querySelectorAll('.pin-tile')].map((t) => ({
      id: t.getAttribute('data-chat-id'),
      cls: t.className,
      nameVis: getComputedStyle(t.querySelector('.pin-name')).visibility,
      nameText: t.querySelector('.pin-name')?.textContent?.trim(),
      avatarVis: getComputedStyle(t.querySelector('.pin-avatar')).visibility,
      firstChildVis: t.querySelector('.pin-avatar > *') ? getComputedStyle(t.querySelector('.pin-avatar > *')).visibility : 'n/a',
    })),
  );

console.log('[before]', JSON.stringify(await dump(), null, 1));
const tC = await a.page.locator(`.pin-tile[data-chat-id="${chatC}"]`).boundingBox();
const tB = await a.page.locator(`.pin-tile[data-chat-id="${chatB}"]`).boundingBox();
await touchDrag(center(tC), center(tB));
await a.page.waitForTimeout(800);
console.log('[after-reorder]', JSON.stringify(await dump(), null, 1));
await shot(a, 'namedbg-after-reorder');

await sweep([a, b, c]);
await done();
