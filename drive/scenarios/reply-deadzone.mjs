// Behavioral check of the incoming-bubble reply dead zone: a swipe-right that
// STARTS on the left part of an incoming bubble must NOT open a reply (that
// gesture is the OS back-swipe); a swipe-right starting on the right part MUST.
// Drives real synthetic TouchEvents on the bubble and reads the composer's
// reply bar (.reply-bar appears iff replyingTo is set).
//
//   node drive/scenarios/reply-deadzone.mjs
import { createAccount, pair, chatWith, say, waitForMessage, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
await pair(alice, bob);
await say(alice, bob.id, 'swipe target message that is fairly wide');
await waitForMessage(bob, alice.id, 'swipe target');

const bobChat = await chatWith(bob, alice.id);
await bob.page.goto(`/chat/${bobChat}`);
await bob.page.waitForSelector('.bubble[data-mid]', { timeout: 15000 });
await bob.page.waitForTimeout(400);

// Dispatch a horizontal swipe-right on the first incoming bubble, starting at
// `frac` across its width. Returns whether the reply bar (a reply being composed)
// appeared as a result.
async function swipeAt(frac) {
  return bob.page.evaluate(async (f) => {
    const clearReply = () => {
      // Cancel any in-progress reply so each probe starts clean.
      const cancel = document.querySelector('.reply-bar ion-button');
      if (cancel) cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    clearReply();
    const bubble = document.querySelector('.bubble[data-mid]');
    if (!bubble) return { error: 'no bubble' };
    const r = bubble.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const startX = r.left + r.width * f;
    const mk = (type, x) => {
      const t = new Touch({ identifier: 1, target: bubble, clientX: x, clientY: y });
      return new TouchEvent(type, { cancelable: true, bubbles: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t] });
    };
    bubble.dispatchEvent(mk('touchstart', startX));
    for (let dx = 20; dx <= 100; dx += 20) bubble.dispatchEvent(mk('touchmove', startX + dx));
    bubble.dispatchEvent(mk('touchend', startX + 100));
    await new Promise((res) => setTimeout(res, 150));
    const replied = !!document.querySelector('.reply-bar');
    clearReply();
    return { replied, startX: Math.round(startX), left: Math.round(r.left), width: Math.round(r.width) };
  }, frac);
}

const leftSwipe = await swipeAt(0.15); // left part → should be INERT (back-swipe lane)
const rightSwipe = await swipeAt(0.85); // right part → should open a reply
console.log('[left  15%]', JSON.stringify(leftSwipe));
console.log('[right 85%]', JSON.stringify(rightSwipe));
const pass = leftSwipe.replied === false && rightSwipe.replied === true;
console.log(pass ? '[PASS ✓] left inert, right replies' : '[FAIL ✗] dead zone not behaving');

await sweep([alice, bob]);
await done();
