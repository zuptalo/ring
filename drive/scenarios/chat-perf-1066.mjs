/**
 * Spec 1066 — chat scroll + emoji rendering performance, verified against the live stack.
 *
 *   node drive/scenarios/chat-perf-1066.mjs
 *   HEADED=1 node drive/scenarios/chat-perf-1066.mjs
 *
 * Two independent checks:
 *
 *  A) SCROLL ANCHOR (US1). Build a chat long enough that loadOlder's newest-tail trim
 *     fires (MAX_ROWS 200, BATCH_SIZE 50 → from the 4th look-ahead on), then flick up
 *     and watch the distance-from-bottom after every step. Scrolling up may only ever
 *     INCREASE that distance. The bug this guards against collapsed it to ~0: the trim
 *     changed the watched tail id, the new tail row happened to be outgoing, and the
 *     auto-follow fired. seedMessages alternates self/peer, so roughly every other trim
 *     lands on an outgoing row — it reproduces within a few pages.
 *
 *  B) EMOJI WEIGHT (US2). Record every /v1/emoji/ fetch the chat makes while rendering
 *     reaction pills. Pills must draw from the vector asset; a single 512.webp here means
 *     a ~600 KB animated sheet is being decoded per frame into a ~23 px slot.
 */
import {
  createAccount, pair, chatWith, say, waitForMessage, messageId, react,
  seedHistory, bubbleCount, shot, sweep, done, BASE_URL,
} from '../driver.mjs';

const fail = [];
const check = (ok, label) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`); if (!ok) fail.push(label); };

const u1 = await createAccount({ name: 'Perf One' });
const u2 = await createAccount({ name: 'Perf Two' });
await pair(u1, u2);
const dm = await chatWith(u1, u2.id);

// A couple of real messages so there is something genuine to react to.
await say(u1, u2.id, 'perf baseline 👍');
await waitForMessage(u2, u1.id, 'perf baseline');
await say(u2, u1.id, 'reacting to this one');
await waitForMessage(u1, u2.id, 'reacting to this one');
const target = await messageId(u1, dm, 'reacting to this one');
for (const e of ['👍', '❤️', '😂', '😮', '🙏']) await react(u1, target, e);

// Deep history. Every seeded message is OUTGOING, which makes the trigger deterministic:
// the auto-follow branch this guards fires on `newest.outgoing`, and loadOlder always trims
// a whole BATCH_SIZE (50) off a MAX_ROWS (200) run, so with the default alternating senders
// the row landing at the trim boundary has FIXED parity — it was always an incoming row, and
// the bug never fired no matter how far you scrolled. In a real chat the boundary lands on
// one of your own messages about half the time, which is exactly why the user saw it
// intermittently. All-outgoing removes the coin flip.
await seedHistory(u1, dm, 2000, { fromIds: [u1.id] });

// ---- record every emoji asset the page fetches from here on ----
const emojiHits = [];
u1.page.on('response', async (res) => {
  const url = res.url();
  if (!url.includes('/v1/emoji/')) return;
  let bytes = 0;
  try { bytes = (await res.body()).length; } catch { /* aborted/cached */ }
  emojiHits.push({ url: url.replace(/^https?:\/\/[^/]+/, ''), bytes });
});

await u1.page.goto(`${BASE_URL}/chat/${dm}`);
await u1.page.waitForTimeout(1500);

// The seeded bodies are indexed ("Seeded message N of M"), so the message sitting at the top
// of the viewport is a direct, layout-independent read of WHERE the reader is. Scrolling up
// must walk it DOWN. `dist` alone was not enough: scrollToNewest() reloads the newest batch,
// which rewrites scrollHeight at the same moment it moves scrollTop.
const metrics = () =>
  u1.page.evaluate(async () => {
    const c = document.querySelector('ion-content');
    const el = c ? await c.getScrollElement() : null;
    if (!el) return null;
    let topIdx = null;
    for (const b of document.querySelectorAll('.bubble[data-mid]')) {
      const r = b.getBoundingClientRect();
      if (r.bottom > 90 && r.top < window.innerHeight) {
        const m = (b.textContent || '').match(/Seeded message (\d+) of/);
        if (m) { topIdx = Number(m[1]); break; }
      }
    }
    return { top: el.scrollTop, dist: el.scrollHeight - el.scrollTop - el.clientHeight, topIdx };
  });

const vp = u1.page.viewportSize() ?? { width: 640, height: 720 };
await u1.page.mouse.move(Math.floor(vp.width / 2), Math.floor(vp.height / 2));

let prev = await metrics();
console.log(`\nA) scroll anchor — start topIdx=${prev.topIdx} dist=${Math.round(prev.dist)}`);
let worstAdvance = 0;
let jumped = false;
let minIdx = prev.topIdx ?? Infinity;
for (let i = 1; i <= 30; i++) {
  await u1.page.mouse.wheel(0, -2000);
  await u1.page.waitForTimeout(320);
  const now = await metrics();
  if (!now) break;
  if (now.topIdx != null) {
    if (prev.topIdx != null) {
      // Scrolling UP walks the visible index DOWN. Any forward movement is the view being
      // yanked toward the newest end.
      const advance = now.topIdx - prev.topIdx;
      if (advance > worstAdvance) worstAdvance = advance;
      if (advance > 50) {
        jumped = true;
        console.log(`  step ${i}: JUMPED — top message ${prev.topIdx} → ${now.topIdx}`);
      }
    }
    minIdx = Math.min(minIdx, now.topIdx);
  }
  prev = now;
}
console.log(`  deepest top message reached: ${minIdx}`);
const rendered = await bubbleCount(u1);
console.log(`  ended topIdx=${prev.topIdx} dist=${Math.round(prev.dist)} worstAdvance=${worstAdvance} renderedBubbles=${rendered}`);
await shot(u1, 'perf-1066-scrolled-up', {});

check(!jumped, 'US1: scrolling up never snaps back to the newest message');
check(worstAdvance <= 20, `US1: the visible message index only ever walks backwards (worst forward jump ${worstAdvance})`);
check(minIdx < 1700, `US1: the reader actually got deep into history (reached message ${minIdx})`);
check(rendered > 0 && rendered <= 260, `US1: rendered DOM stays bounded (${rendered} bubbles)`);

// ---- B) emoji weight ----
const webp = emojiHits.filter((h) => h.url.endsWith('512.webp'));
const svg = emojiHits.filter((h) => h.url.endsWith('emoji.svg'));
const total = emojiHits.reduce((n, h) => n + h.bytes, 0);
console.log(`\nB) emoji — ${emojiHits.length} fetches, ${svg.length} svg, ${webp.length} webp, ${total} B total`);
for (const h of emojiHits.slice(0, 8)) console.log(`     ${h.url}  ${h.bytes} B`);
check(webp.length === 0, `US2: no animated 512.webp fetched for pill-size emoji (${webp.length} seen)`);
check(svg.length > 0, `US2: reaction pills draw from the vector asset (${svg.length} svg fetches)`);
check(total < 64_000, `US2: total emoji bytes under 64 KB (${total} B)`);

console.log(fail.length ? `\n${fail.length} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
await sweep([u1, u2]);
await done();
process.exit(fail.length ? 1 : 0);
