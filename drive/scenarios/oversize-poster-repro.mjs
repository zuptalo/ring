/**
 * REPRO: a small-DIMENSION but large-BYTE image (the shape of an animated GIF/WebP) gets
 * stuck on the sending clock forever.
 *
 * Mechanism under test (queries.ts runMediaJob):
 *   let bubble = await makeImageThumb(uploadBlob, THUMB_TIERS.bubble);   // undefined when big <= 512
 *   if (!bubble && big > 0 && big <= THUMB_TIERS.bubble) bubble = uploadBlob;  // <-- whole file!
 *   message.posterData = await blobToDataUrl(bubble);                    // base64, ~1.37x
 * The poster rides INSIDE the sealed message (MediaRef.poster), and the server caps a
 * websocket frame at 1 MiB (ws/hub.go maxMessageSize). A multi-MB GIF at 480x480 therefore
 * ships a multi-MB poster → the frame is over the limit → never acked → 'pending' forever.
 *
 * This uses a 512x512 RANDOM-NOISE PNG because that hits the SAME branch (it is mime-agnostic)
 * and is reproducible without a binary fixture: noise doesn't compress, so 512x512 lands well
 * over the budget while staying within the 512px bubble tier.
 *
 *   node drive/scenarios/oversize-poster-repro.mjs
 */
import { createAccount, pair, chatWith, poll, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);
const aliceChat = await chatWith(alice, bob.id);

// 512x512 noise → within the bubble tier (512) but far over the 40KB poster budget.
const info = await alice.page.evaluate(async (chatId) => {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const cx = c.getContext('2d');
  const img = cx.createImageData(N, N);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = (Math.random() * 256) | 0;
    img.data[i + 1] = (Math.random() * 256) | 0;
    img.data[i + 2] = (Math.random() * 256) | 0;
    img.data[i + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const b64 = await new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.readAsDataURL(blob);
  });
  await window.__ringTest.sendImageData(chatId, b64, 'image/png', 'noise.png', 'original');
  return { bytes: blob.size };
}, aliceChat);

console.log('[repro] source image bytes:', info.bytes, `(${(info.bytes / 1024).toFixed(0)} KB)`);

// Watch the send state + how big the embedded poster ended up.
let last = null;
for (let i = 0; i < 20; i++) {
  const snap = await alice.page.evaluate(async (c) => {
    const ms = await window.__ringTest.messages(c);
    const m = ms.filter((x) => x.kind === 'image').pop();
    return m ? { status: m.status, hasPoster: m.hasPoster } : null;
  }, aliceChat);
  if (snap && JSON.stringify(snap) !== JSON.stringify(last)) {
    console.log(`[repro] t+${i * 2}s status=${snap.status} hasPoster=${snap.hasPoster}`);
    last = snap;
  }
  if (snap && ['sent', 'delivered', 'seen'].includes(snap.status)) break;
  await new Promise((r) => setTimeout(r, 2000));
}

const finalState = last?.status;
const gotThere = ['sent', 'delivered', 'seen'].includes(finalState ?? '');
console.log(gotThere ? `[repro] delivered OK (${finalState})` : `[repro] STUCK at '${finalState}' — reproduced`);

// Did the recipient ever see it?
const bobChat = await chatWith(bob, alice.id);
const bobHas = await bob.page.evaluate(
  async (c) => (await window.__ringTest.messages(c)).filter((m) => m.kind === 'image').length,
  bobChat,
);
console.log('[repro] recipient image count:', bobHas);

await sweep([alice, bob]);
await done();
