/**
 * Repro: "every other message doesn't fully come up when composing and sending" —
 * send several messages back-to-back through the real composer and, after each
 * settles (past the 280ms pop + 260ms glide + 600ms backstop), measure:
 *   - gap: scroll distance still left below (scrollHeight - scrollTop - clientHeight)
 *   - cut: how far the newest bubble's bottom sticks BELOW the scroll viewport
 *   - listTy / bubScale: any transform left stuck from the glide/pop
 *
 *   node drive/scenarios/pin-after-send.mjs
 */
import { createAccount, pair, chatWith, say, waitForMessage, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'PinA', mobile: true });
const b = await createAccount({ name: 'PinB' });
await pair(a, b);

for (let i = 1; i <= 8; i++) await say(b, a.id, `seed ${i} — filler so the chat scrolls`);
await waitForMessage(a, b.id, 'seed 8');
await a.page.goto(`/chat/${await chatWith(a, b.id)}`);
await a.page.waitForTimeout(1500);

const ta = a.page.locator('ion-textarea.composer textarea');
const send = a.page.locator('button[aria-label="Send"]');

// Phase 1: rapid burst — no settle between sends (animations overlap mid-send).
for (let i = 1; i <= 5; i++) {
  await ta.fill(`burst ${i} quick fire`);
  await send.click();
  await a.page.waitForTimeout(120); // next send lands mid-pop/mid-glide
}
await a.page.waitForTimeout(1200);
const burst = await a.page.evaluate(() => {
  const content = document.querySelector('.chat-content');
  const el = content?.shadowRoot?.querySelector('.inner-scroll') ?? content;
  const list = document.querySelector('.msg-list');
  const bubbles = document.querySelectorAll('.bubble[data-mid]');
  const nb = bubbles[bubbles.length - 1];
  const er = el.getBoundingClientRect();
  const br = nb?.getBoundingClientRect();
  const parse = (s) => (s && s.startsWith('matrix') ? new DOMMatrixReadOnly(s) : new DOMMatrixReadOnly());
  return {
    gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
    cut: br ? Math.round(br.bottom - er.bottom) : null,
    listTy: Math.round(parse(getComputedStyle(list).transform).m42 * 10) / 10,
  };
});
console.log('[after burst]', JSON.stringify(burst));

// Phase 2: paced sends.
for (let i = 1; i <= 6; i++) {
  await ta.click();
  await ta.fill(`composer send number ${i} with a little bit of length to it`);
  await send.click();
  await a.page.waitForTimeout(1000); // past pop+glide+backstop
  const m = await a.page.evaluate(() => {
    const content = document.querySelector('.chat-content');
    const el = content?.shadowRoot?.querySelector('.inner-scroll') ?? content;
    const list = document.querySelector('.msg-list');
    const bubbles = document.querySelectorAll('.bubble[data-mid]');
    const nb = bubbles[bubbles.length - 1];
    const er = el.getBoundingClientRect();
    const br = nb?.getBoundingClientRect();
    const parse = (s) => (s && s.startsWith('matrix') ? new DOMMatrixReadOnly(s) : new DOMMatrixReadOnly());
    return {
      gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
      cut: br ? Math.round(br.bottom - er.bottom) : null, // >0 = newest bubble sticks below the viewport
      listTy: Math.round(parse(getComputedStyle(list).transform).m42 * 10) / 10,
      bubScale: nb ? Math.round(parse(getComputedStyle(nb).transform).a * 100) / 100 : null,
    };
  });
  console.log(`[after send ${i}]`, JSON.stringify(m));
}
await shot(a, 'pin-after-send');
await sweep([a, b]);
await done();
