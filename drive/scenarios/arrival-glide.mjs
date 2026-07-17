/**
 * Arrival glide (WhatsApp-style): a new bottom message — incoming while the chat is
 * open, or your own send — should translate .msg-list down by the new row's height
 * and ease it back to 0 (~260ms), instead of popping in with a jump.
 *
 * Verifies by sampling getComputedStyle(.msg-list).transform per frame around the
 * send on BOTH sides: expect a nonzero translateY that decays to 0.
 *
 *   node drive/scenarios/arrival-glide.mjs
 */
import { createAccount, pair, chatWith, say, waitForMessage, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'GlideA' });
const b = await createAccount({ name: 'GlideB', mobile: true });
await pair(a, b);

// Seed enough history that B's chat overflows (exercises the pinned/scrollTop path).
for (let i = 1; i <= 12; i++) await say(a, b.id, `seed message number ${i} — some extra words for bubble height`);
await waitForMessage(b, a.id, 'seed message number 12');

// Open the chat on both sides and let the initial pin settle.
await a.page.goto(`/chat/${await chatWith(a, b.id)}`);
await b.page.goto(`/chat/${await chatWith(b, a.id)}`);
await a.page.waitForTimeout(1500);
await b.page.waitForTimeout(1500);

// Per-frame transform sampler on .msg-list for ~1.8s.
const startSampler = (c) =>
  c.page.evaluate(() => {
    window.__glideSamples = [];
    const t0 = performance.now();
    const tick = () => {
      const el = document.querySelector('.msg-list');
      if (el) {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        window.__glideSamples.push({ t: Math.round(performance.now() - t0), ty: Math.round(m.m42 * 10) / 10 });
      }
      if (performance.now() - t0 < 1800) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const nonzero = (c) => c.page.evaluate(() => window.__glideSamples.filter((s) => s.ty !== 0));

// 1) Incoming on B: A sends while B has the chat open.
await startSampler(b);
await say(a, b.id, 'incoming glide test — watch me slide in smoothly');
await waitForMessage(b, a.id, 'incoming glide test');
await b.page.waitForTimeout(1900);
console.log('[B incoming] nonzero ty samples:', JSON.stringify(await nonzero(b)));

// 2) Outgoing on A: A's own send should glide on A's screen too.
await startSampler(a);
await say(a, b.id, 'outgoing glide test — my own bubble slides in');
await a.page.waitForTimeout(1900);
console.log('[A outgoing] nonzero ty samples:', JSON.stringify(await nonzero(a)));

await shot(b, 'glide-b-final');
await sweep([a, b]);
await done();
