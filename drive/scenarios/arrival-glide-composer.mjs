/**
 * Arrival glide via the REAL composer (the path the user exercises on the phone):
 * type into ion-textarea and tap the send button, then sample .msg-list's computed
 * transform per frame. The testhook `say()` bypasses ChatDetailPage's send(), which
 * also calls scrollToNewest() explicitly — this covers the real path.
 *
 *   node drive/scenarios/arrival-glide-composer.mjs
 */
import { createAccount, pair, chatWith, say, waitForMessage, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'GlideCA', mobile: true });
const b = await createAccount({ name: 'GlideCB' });
await pair(a, b);

// Seed history so the chat overflows on A's phone viewport.
for (let i = 1; i <= 12; i++) await say(b, a.id, `seed message number ${i} — some extra words for bubble height`);
await waitForMessage(a, b.id, 'seed message number 12');

await a.page.goto(`/chat/${await chatWith(a, b.id)}`);
await a.page.waitForTimeout(1500);

// Sampler: per frame for 2.5s, record .msg-list translateY (glide) AND the newest
// bubble's scale + transform-origin (pop).
await a.page.evaluate(() => {
  window.__glideSamples = [];
  const t0 = performance.now();
  const parse = (s) => (s && s.startsWith('matrix') ? new DOMMatrixReadOnly(s) : new DOMMatrixReadOnly());
  const tick = () => {
    const el = document.querySelector('.msg-list');
    const bubbles = document.querySelectorAll('.bubble[data-mid]');
    const nb = bubbles[bubbles.length - 1];
    if (el) {
      const m = parse(getComputedStyle(el).transform);
      const bm = nb ? parse(getComputedStyle(nb).transform) : null;
      window.__glideSamples.push({
        t: Math.round(performance.now() - t0),
        ty: Math.round(m.m42 * 10) / 10,
        scale: bm ? Math.round(bm.a * 100) / 100 : null,
        origin: nb ? getComputedStyle(nb).transformOrigin : null,
      });
    }
    if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// Real composer interaction: type, then tap the round send button.
const ta = a.page.locator('ion-textarea.composer textarea');
await ta.click();
await ta.fill('typed through the real composer — glide me');
await a.page.locator('button[aria-label="Send"]').click();
await a.page.waitForTimeout(2600);

const samples = await a.page.evaluate(() => window.__glideSamples);
const active = samples.filter((s) => s.ty !== 0 || (s.scale !== null && s.scale !== 1));
console.log('[composer send] samples:', samples.length, 'animating:', JSON.stringify(active));
const peak = Math.max(...samples.map((s) => s.scale ?? 0));
console.log('[composer send] peak scale:', peak, 'origin during pop:', active.find((s) => s.origin)?.origin);

await shot(a, 'glide-composer-final');
await sweep([a, b]);
await done();
