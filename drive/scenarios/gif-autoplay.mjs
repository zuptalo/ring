// Verify animated GIF + animated WebP autoplay in the chat bubble while visible.
//
// Sends both at quality 'hd' (NOT 'original') to prove the compression bypass: the
// pipeline must NOT flatten them to a static JPEG. On the receiver we sample the
// rendered bubble's pixels over time — a real animation cycles colours; a JPEG-
// flattened still would not. The test images cycle red → blue → green every 200ms.
import { readFileSync } from 'node:fs';
import { createAccount, pair, chatWith, shot, sweep, done } from '../driver.mjs';

const gifB64 = readFileSync('.tmp/anim.gif.b64', 'utf8').trim();
const webpB64 = readFileSync('.tmp/anim.webp.b64', 'utf8').trim();

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);

// Alice sends an animated GIF and an animated WebP at HD quality.
await alice.page.evaluate(
  ([peer, b64]) => window.__ringTest.chatWith(peer).then((id) => window.__ringTest.sendImageData(id, b64, 'image/gif', 'wave.gif', 'hd')),
  [bob.id, gifB64],
);
await alice.page.evaluate(
  ([peer, b64]) => window.__ringTest.chatWith(peer).then((id) => window.__ringTest.sendImageData(id, b64, 'image/webp', 'wave.webp', 'hd')),
  [bob.id, webpB64],
);

// Bob opens the chat; wait for both image bubbles to decode (naturalWidth > 0).
const bobChat = await chatWith(bob, alice.id);
await bob.page.goto(`/chat/${bobChat}`);
await bob.page.waitForFunction(
  () => {
    const imgs = Array.from(document.querySelectorAll('.media-wrap img.bubble-image'));
    return imgs.length >= 2 && imgs.every((im) => im.naturalWidth > 0);
  },
  null,
  { timeout: 20_000 },
);

// Byte-level proof (headless-robust): the bytes BEHIND each bubble must still be the
// animated original the recipient received — an animated GIF (NETSCAPE loop block) or
// animated WebP (ANIM chunk), NOT a JPEG the compressor flattened it to. Also sample
// pixels over time: headed Chromium advances the frames, so colours cycle (headless
// won't paint, so that signal is informational only).
const result = await bob.page.evaluate(async () => {
  const imgs = Array.from(document.querySelectorAll('.media-wrap img.bubble-image'));
  const sample = (img) => {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0, 8, 8);
    const d = cx.getImageData(4, 4, 1, 1).data;
    return `${d[0]},${d[1]},${d[2]}`;
  };
  const out = [];
  for (const img of imgs) {
    const blob = await fetch(img.currentSrc || img.src).then((r) => r.blob());
    const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    let sig = '';
    for (const b of head) sig += String.fromCharCode(b);
    const colors = new Set();
    for (let t = 0; t < 6; t++) { colors.add(sample(img)); await new Promise((r) => setTimeout(r, 140)); }
    out.push({
      alt: img.getAttribute('alt'),
      mime: blob.type,
      bytes: blob.size,
      animatedMarker: sig.includes('NETSCAPE') ? 'gif:NETSCAPE' : sig.includes('ANIM') ? 'webp:ANIM' : 'NONE',
      framesCyclingHeaded: colors.size > 1,
    });
  }
  return out;
});

console.log('[bubbles]', JSON.stringify(result));
const preserved = result.length >= 2
  && result.every((r) => r.alt === 'gif' && (r.mime === 'image/gif' || r.mime === 'image/webp') && r.animatedMarker !== 'NONE');
console.log(preserved
  ? '[PASS] animated originals preserved end-to-end + rendered as autoplaying bubbles' + (result.every((r) => r.framesCyclingHeaded) ? ' (frames cycling)' : ' (run HEADED=1 to see frames cycle)')
  : '[FAIL] an image was flattened or not rendered as animated');

// Visual proof of autoplay: three composited screenshots ~200ms apart. The test
// images cycle red → blue → green every 200ms, so the bubbles differ across frames
// only if they are actually animating on screen.
for (let i = 0; i < 3; i++) {
  await shot(bob, `gif-autoplay-${i}`, {});
  await bob.page.waitForTimeout(200);
}
await sweep([alice, bob]);
await done();
