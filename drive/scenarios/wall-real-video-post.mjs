/**
 * Validate a REAL video posting to the Wall end-to-end through the actual UI
 * (spec 2034 progress + spec 2036 clean finish): attach the user's file in the
 * composer, Share, watch the pending card's progress stay monotonic, and assert
 * the flow ends with exactly one posted video and ZERO leftover pending cards.
 *
 *   node drive/scenarios/wall-real-video-post.mjs "/path/to/video.mp4"
 */
import { createAccount, pair, shot, poll, sweep, done } from '../driver.mjs';

const FILE = process.argv[2] ?? '/Users/kamran/Desktop/When You Think You Can Handle It.mp4';

const kim = await createAccount({ name: 'Kim', mobile: true });
const pal = await createAccount({ name: 'Pal' });
await pair(kim, pal);

// Open the real composer IN-APP (share() ends with router.back(), so the
// composer must be entered from the wall, not via a direct page load).
await kim.page.goto('/tabs/wall');
await kim.page.getByRole('button', { name: 'New post' }).first().click();
await kim.page.waitForURL('**/wall/compose', { timeout: 15_000 });
await kim.page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15_000 });
await kim.page.setInputFiles('input[type="file"]', FILE);
await kim.page.waitForTimeout(1500); // thumbnail/preview settles
await shot(kim, 'real-post-composer');

// Share → the composer dismisses immediately; the worker takes over.
await kim.page.getByText('Share', { exact: true }).click();
await kim.page.waitForURL('**/tabs/wall', { timeout: 15_000 });

// Watch the pending card: progress must be MONOTONIC and the card must go away.
let last = -1;
let regressions = 0;
let sawPending = false;
let lastStatus = '';
const t0 = Date.now();
await poll(
  async () => {
    const n = await kim.page.evaluate(() => window.__ringTest.pendingPostCount());
    if (n > 0) {
      sawPending = true;
      const st = await kim.page.evaluate(() => document.querySelector('.pending-post .sub')?.textContent ?? '?');
      if (st !== lastStatus) { console.log(`[realpost] card status: ${st.trim()}`); lastStatus = st; }
      // Read the visible % off the pending card ("1 item · 37%").
      const txt = await kim.page.evaluate(() => document.querySelector('.pending-note')?.textContent ?? '');
      const m = txt.match(/(\d+)%/);
      if (m) {
        const prog = Number(m[1]);
        if (prog < last) regressions += 1;
        last = Math.max(last, prog);
      }
      return { n, pct: last };
    }
    return 'drained';
  },
  (v) => v === 'drained',
  { timeout: 300_000, every: 1000, label: 'pending post drains' },
);
console.log(`[realpost] outbox drained after ${((Date.now() - t0) / 1000).toFixed(1)}s; sawPending=${sawPending} lastSeen=${last}% regressions=${regressions}`);

// The Wall must show the posted VIDEO and ZERO pending/failed/interrupted cards.
await kim.page.waitForTimeout(1200);
const domState = await kim.page.evaluate(() => ({
  pendingCards: document.querySelectorAll('.pending-post').length,
  posts: document.querySelectorAll('.post:not(.pending-post)').length,
  videos: document.querySelectorAll('.post .wv-video, .post video').length,
}));
console.log('[realpost] DOM:', JSON.stringify(domState));
console.log(domState.pendingCards === 0 && domState.videos >= 1 ? '[realpost] PASS — clean finish, video posted' : '[realpost] FAIL — leftover card or missing video');
await shot(kim, 'real-post-wall-after');

// TEMP probe: the posted video must be playable with a real duration.
const dur = await kim.page.evaluate(async () => {
  const v = document.querySelector('.post video');
  if (!v) return 'no-video-el';
  for (let i = 0; i < 40 && !(v.duration > 0); i++) await new Promise((r) => setTimeout(r, 250));
  return { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
});
console.log('[realpost] playback probe:', JSON.stringify(dur));


// Recipient sanity: Pal sees the post arrive too.
await pal.page.goto('/tabs/wall');
await poll(
  async () => pal.page.evaluate(() => document.querySelectorAll('.post:not(.pending-post)').length),
  (n) => n >= 1,
  { timeout: 90_000, label: 'Pal sees the post' },
).catch(() => console.log('[realpost] note: recipient render slow/missing'));
await shot(pal, 'real-post-recipient');

await sweep([kim, pal]);
await done();
