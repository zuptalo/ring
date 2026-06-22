/**
 * spec 2007 verification — HD/SD video sends must transcode for real, and the badge
 * must never claim a quality the bytes aren't.
 *
 *  Part A (deterministic, codec-independent): a non-transcodable send picked as HD/SD
 *    must end up labeled 'original' (honest fallback), never 'hd'/'sd'. This is the
 *    core trust fix and the exact bug in the report.
 *  Part B (needs H.264 encode in this browser): a real, decodable clip sent at SD/HD
 *    must deliver genuinely smaller bytes at a reduced resolution; Original is untouched.
 *    If the browser can't encode H.264 we say so and skip B (CI e2e + on-device cover it).
 */
import { createAccount, pair, chatWith, shot, sweep, done, poll } from '../driver.mjs';

const settle = (c, messageId) =>
  poll(
    () => c.page.evaluate((id) => window.__ringTest.mediaInfo(id), messageId),
    (info) => info && info.status && info.status !== 'compressing' && info.mediaSize != null,
    { timeout: 90_000, every: 400, label: `media ${messageId} settles` },
  );

const a = await createAccount({ name: 'Alice' });
const b = await createAccount({ name: 'Bob' });
await pair(a, b);
const chatId = await chatWith(a, b.id);

// ---- Part A: honesty on a non-transcodable stub (deterministic) ----
console.log('\n=== Part A: honest labeling (stub video that cannot transcode) ===');
for (const quality of ['original', 'hd', 'sd']) {
  const id = await a.page.evaluate(
    ([c, q]) => window.__ringTest.sendMediaQuality(c, 'video', `stub-${q}.mp4`, q),
    [chatId, quality],
  );
  // sendMediaQuality returns the message id (sendMediaMessage now returns it).
  const info = await settle(a, id);
  const verdict = info.mediaQuality === 'original' ? 'OK (honest)' : `BUG: labeled ${info.mediaQuality}`;
  console.log(`  requested ${quality.padEnd(8)} → achieved '${info.mediaQuality}'  size=${info.mediaSize}  ${verdict}`);
}

// ---- Part B: real transcode shrinks the file (codec-dependent) ----
console.log('\n=== Part B: real clip — does HD/SD actually shrink? ===');
const canEncode = await a.page.evaluate(async () => {
  const f = window.VideoEncoder?.isConfigSupported;
  if (!f) return false;
  for (const codec of ['avc1.4d0028', 'avc1.42e028', 'avc1.640028']) {
    try {
      if ((await f({ codec, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30 })).supported) return true;
    } catch { /* try next */ }
  }
  return false;
});

if (!canEncode) {
  console.log('  this browser cannot encode H.264 via WebCodecs — skipping Part B.');
  console.log('  (the real-shrink path is covered by the e2e suite + the on-device iPhone check.)');
} else {
  // A 4K source so Full HD (the top tier) genuinely downscales it.
  const results = {};
  for (const quality of ['original', 'fhd', 'hd', 'sd']) {
    const { messageId, sourceSize } = await a.page.evaluate(
      ([c, q]) => window.__ringTest.sendRealVideoQuality(c, q, 3840, 2160, 2, 45_000_000),
      [chatId, quality],
    );
    const info = await settle(a, messageId);
    results[quality] = { ...info, sourceSize };
    console.log(
      `  ${quality.padEnd(8)} src=${sourceSize}  sent=${info.mediaSize}  ${info.mediaWidth}x${info.mediaHeight}  label='${info.mediaQuality}'`,
    );
  }
  const ok =
    results.sd.mediaSize < results.hd.mediaSize &&
    results.hd.mediaSize < results.fhd.mediaSize &&
    results.fhd.mediaSize < results.original.mediaSize &&
    results.sd.mediaWidth <= 640 &&
    results.hd.mediaWidth <= 1280 &&
    results.fhd.mediaWidth <= 1920 &&
    results.sd.mediaQuality === 'sd' &&
    results.hd.mediaQuality === 'hd' &&
    results.fhd.mediaQuality === 'fhd' &&
    results.original.mediaQuality === 'original';
  console.log(`  VERDICT: ${ok ? 'OK — SD < HD < FullHD < Original, labels honest' : 'MISMATCH — see sizes above'}`);

  // Suitability: a 720p source must NOT offer Full HD / 4K (pure function, but assert live).
  const offered720 = await a.page.evaluate(async () => {
    const { availableQualities } = await import('/src/services/media-encode.ts');
    return availableQualities(1280);
  });
  console.log(`  suitability(720p) offered: [${offered720.join(', ')}]  ${
    JSON.stringify(offered720) === JSON.stringify(['sd', 'hd', 'original']) ? 'OK (no FullHD/4K)' : 'MISMATCH'
  }`);
}

await shot(b, 'video-quality-bob', { route: `/chat/${await chatWith(b, a.id)}` });
await sweep([a, b]);
await done();
