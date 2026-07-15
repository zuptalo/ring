/**
 * Spec 2041: the video-post pipeline must keep peak JS-heap growth bounded by
 * the demux WINDOW, not the FILE. Two probes through the real UI:
 *   1. the reporter's real 16 MB portrait clip (1080×1920 → transcodes at 'hd'),
 *   2. a synthesized BIG 4K H.264 clip recorded in-page (MediaRecorder), large
 *      enough that the old whole-file demux would hold several file-copies.
 * Both must finish cleanly (no leftover card, playable post) while the sampled
 * heap delta stays far below the old pipeline's multiples of file size.
 *
 *   node drive/scenarios/wall-video-memory.mjs
 */
import { createAccount, pair, poll, sweep, done } from '../driver.mjs';

const REAL_FILE = process.argv[2] ?? '/Users/kamran/Desktop/When You Think You Can Handle It.mp4';

const kim = await createAccount({ name: 'Kim' });
const pal = await createAccount({ name: 'Pal' });
await pair(kim, pal);

/** Sample usedJSHeapSize continuously in-page; returns peak-minus-baseline MB.
 *  CAVEAT: without --enable-precise-memory-info chromium quantizes and
 *  rate-limits this value (often reading +0), so the cap is a tripwire for
 *  gross regressions only — the structural demux tests and the on-device pass
 *  are the real memory evidence. */
const startHeapWatch = (page) =>
  page.evaluate(() => {
    const m = performance.memory;
    if (!m) return false;
    window.__heapWatch = { base: m.usedJSHeapSize, peak: m.usedJSHeapSize };
    window.__heapTimer = setInterval(() => {
      const u = performance.memory.usedJSHeapSize;
      if (u > window.__heapWatch.peak) window.__heapWatch.peak = u;
    }, 100);
    return true;
  });
const stopHeapWatch = (page) =>
  page.evaluate(() => {
    clearInterval(window.__heapTimer);
    const w = window.__heapWatch;
    return w ? Math.round((w.peak - w.base) / 1048576) : -1;
  });

/** Open the composer, let `setFiles` attach media, Share, and measure. */
async function postAndMeasure(label, setFiles, { maxDeltaMb, minVideos }) {
  await kim.page.goto('/tabs/wall');
  await kim.page.getByRole('button', { name: 'New post' }).first().click();
  await kim.page.waitForURL('**/wall/compose', { timeout: 15_000 });
  await kim.page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15_000 });
  const skip = (await setFiles()) === 'skip';
  if (skip) {
    console.log(`[mem] ${label}: SKIPPED`);
    await kim.page.goto('/tabs/wall');
    return;
  }
  await kim.page.waitForTimeout(1500);
  const watching = await startHeapWatch(kim.page);
  await kim.page.getByText('Share', { exact: true }).click();
  await kim.page.waitForURL('**/tabs/wall', { timeout: 15_000 });
  const t0 = Date.now();
  await poll(
    () => kim.page.evaluate(() => window.__ringTest.pendingPostCount()),
    (n) => n === 0,
    { timeout: 600_000, every: 1000, label: `${label} drains` },
  );
  const deltaMb = watching ? await stopHeapWatch(kim.page) : -1;
  const domState = await kim.page.evaluate(() => ({
    pendingCards: document.querySelectorAll('.pending-post').length,
    videos: document.querySelectorAll('.post .wv-video, .post video').length,
  }));
  const dur = await kim.page.evaluate(async () => {
    const v = document.querySelector('.post video');
    if (!v) return null;
    for (let i = 0; i < 40 && !(v.duration > 0); i++) await new Promise((r) => setTimeout(r, 250));
    return { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
  });
  const clean = domState.pendingCards === 0 && domState.videos >= minVideos && dur && dur.duration > 0;
  const memOk = deltaMb < 0 || deltaMb <= maxDeltaMb;
  console.log(
    `[mem] ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s, heap +${deltaMb} MB (cap ${maxDeltaMb}), ` +
      `playback ${JSON.stringify(dur)} → ${clean && memOk ? 'PASS' : 'FAIL'}`,
  );
  if (!clean || !memOk) throw new Error(`${label} failed (clean=${clean} memOk=${memOk} dom=${JSON.stringify(domState)})`);
}

// Probe 1: the reporter's real portrait clip (1920-edge → real transcode at 'hd').
await postAndMeasure('real-16MB', () => kim.page.setInputFiles('input[type="file"]', REAL_FILE), {
  maxDeltaMb: 400,
  minVideos: 1,
});

// Probe 2: synthesize a big 4K H.264 mp4 IN the composer page (animated noise
// defeats compression → high bitrate), attach it without leaving the page.
let bigSizeMb = 0;
await postAndMeasure(
  'big-4K',
  async () => {
    const size = await kim.page.evaluate(async () => {
      const mime = 'video/mp4;codecs=avc1';
      if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(mime)) return -1;
      const c = document.createElement('canvas');
      c.width = 3840;
      c.height = 2160;
      const ctx = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: 45_000_000 });
      const parts = [];
      rec.ondataavailable = (e) => parts.push(e.data);
      const stopped = new Promise((r) => (rec.onstop = r));
      rec.start(1000);
      const t0 = performance.now();
      while (performance.now() - t0 < 20_000) {
        for (let i = 0; i < 250; i++) {
          ctx.fillStyle = `hsl(${Math.random() * 360},80%,${30 + Math.random() * 40}%)`;
          ctx.fillRect(Math.random() * 3840, Math.random() * 2160, 120, 120);
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      rec.stop();
      await stopped;
      const file = new File(parts, 'big-4k.mp4', { type: 'video/mp4' });
      const input = document.querySelector('input[type="file"]');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return file.size;
    });
    if (size < 0) return 'skip';
    bigSizeMb = Math.round(size / 1048576);
    console.log(`[mem] synthesized 4K clip: ${bigSizeMb} MB`);
  },
  // Old pipeline held ≥3 file-copies (outbox bytes + demux buffer + chunk
  // copies) before frames even queued; streaming must stay well under ONE
  // file-size over baseline plus queues/muxer. Cap resolved after synthesis.
  { get maxDeltaMb() { return bigSizeMb + 150; }, minVideos: 2 },
);

await sweep([kim, pal]);
await done();
