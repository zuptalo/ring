/**
 * In-media upload progress: photos/videos show a cloud waterline in the thumbnail
 * centre, voice fills its waveform left→right, music fills over the cover, files fill
 * in the icon slot — and NOTHING about the bubble reflows when the upload completes
 * (the old bottom bar row used to snap the bubble shorter, spoiling the arrival pop).
 *
 * Sends real media, then flips the messages into the uploading state directly (Vite
 * serves the app's OWN module instances to the page, so media-jobs/idb pokes hit the
 * live app) at fixed fractions for deterministic screenshots, and asserts bubble rects
 * are identical in-flight vs done.
 *
 *   node drive/scenarios/upload-cloud-progress.mjs
 */
import { createAccount, pair, chatWith, poll, sendImage, sendAudio, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'CloudA', mobile: true });
const b = await createAccount({ name: 'CloudB' });
await pair(a, b);
const chat = await chatWith(a, b.id);

// One of each media kind through the real send pipeline (tiny fixtures upload instantly,
// so the flow settles to status 'sent' before we stage the in-flight state ourselves).
await sendImage(a, chat, 'photo.png', 'hd');
await sendAudio(a, chat, 'song.mp3', 'Test Song', 'Test Artist');
await a.page.evaluate((id) => window.__ringTest.seedMedia(id, 'voice', 4096), chat);
await a.page.evaluate((id) => window.__ringTest.seedMedia(id, 'file', 4096), chat);
await poll(
  () => a.page.evaluate((id) => window.__ringTest.listMessages?.(id).then((m) => m.length).catch(() => null) ?? null, chat),
  () => true, // listMessages may not exist; the real wait is the DOM below
  { timeout: 1000, every: 300, label: 'settle' },
).catch(() => {});

await a.page.goto(`/chat/${chat}`);
await a.page.waitForTimeout(1500);

// Stage the in-flight state: distinct fractions per kind so the screenshot shows the
// waterline at different levels, and capture each bubble's rect while uploading.
const during = await a.page.evaluate(async () => {
  const jobs = await import('/src/services/media-jobs.ts');
  const idb = await import('/src/db/idb.ts');
  const msgs = (await idb.getAll('messages')).filter((m) => m.mediaId);
  const frac = { image: 0.35, audio: 0.6, voice: 0.5, file: 0.8 };
  for (const m of msgs) {
    jobs.setUploadProgress(m.id, frac[m.kind] ?? 0.5);
    m.status = 'compressing';
    m.updatedAt = Date.now();
    await idb.put('messages', m);
  }
  await new Promise((r) => setTimeout(r, 600)); // let liveQuery + render settle
  const rects = {};
  for (const m of msgs) {
    const el = document.querySelector(`.bubble[data-mid="${CSS.escape(m.id)}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      rects[m.kind] = { w: Math.round(r.width), h: Math.round(r.height) };
    }
  }
  return {
    rects,
    clouds: document.querySelectorAll('.upload-cloud, .chip-cloud, .audio-play .cloud-fill').length,
    waveFilled: document.querySelectorAll('.vp-bar.played').length,
    waveTotal: document.querySelectorAll('.vp-bar').length,
  };
});
console.log('[during upload]', JSON.stringify(during));
await shot(a, 'upload-cloud-during');

// Complete the uploads: clear progress, back to sent — bubbles must not move.
const after = await a.page.evaluate(async () => {
  const jobs = await import('/src/services/media-jobs.ts');
  const idb = await import('/src/db/idb.ts');
  const msgs = (await idb.getAll('messages')).filter((m) => m.mediaId);
  for (const m of msgs) {
    jobs.clearJobProgress(m.id);
    m.status = 'sent';
    m.updatedAt = Date.now();
    await idb.put('messages', m);
  }
  await new Promise((r) => setTimeout(r, 600));
  const rects = {};
  for (const m of msgs) {
    const el = document.querySelector(`.bubble[data-mid="${CSS.escape(m.id)}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      rects[m.kind] = { w: Math.round(r.width), h: Math.round(r.height) };
    }
  }
  return { rects, clouds: document.querySelectorAll('.upload-cloud, .chip-cloud, .audio-play .cloud-fill').length };
});
console.log('[after upload]', JSON.stringify(after));
await shot(a, 'upload-cloud-after');

const same = JSON.stringify(during.rects) === JSON.stringify(after.rects);
console.log(same ? 'PASS: bubble sizes identical in-flight vs done' : 'FAIL: bubble sizes changed!');

await sweep([a, b]);
await done();
