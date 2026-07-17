// (1) Media metadata (quality · resolution · size) now lives in the message FOOTER,
//     not overlaid on the thumbnail — screenshot to see how it looks.
// (2) A GIF/WebP send skips the quality prompt (always sent as original).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createAccount, pair, chatWith, shot, sweep, done } from '../driver.mjs';

const pngB64 = readFileSync('.tmp/photo.png.b64', 'utf8').trim();
const gifB64 = readFileSync('.tmp/anim.gif.b64', 'utf8').trim();
const gif = readFileSync('.tmp/anim.gif');

// Local CORS-ok CDN stand-in (for the paste→send skip-prompt check).
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/gif', 'Access-Control-Allow-Origin': '*' });
  res.end(gif);
});
await new Promise((r) => server.listen(8098, '127.0.0.1', r));

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);
const aliceChat = await chatWith(alice, bob.id);
await alice.page.goto(`/chat/${aliceChat}`);
await alice.page.waitForSelector('ion-textarea.composer textarea');

// ---- Part 1: footer metadata ----
// A real photo requested at HD (genuinely re-encodes → footer shows "HD …") and an
// animated GIF requested at HD (bypassed → footer shows "Original …").
await alice.page.evaluate(
  ([id, b64]) => window.__ringTest.sendImageData(id, b64, 'image/png', 'sunset.png', 'hd'),
  [aliceChat, pngB64],
);
await alice.page.evaluate(
  ([id, b64]) => window.__ringTest.sendImageData(id, b64, 'image/gif', 'wave.gif', 'hd'),
  [aliceChat, gifB64],
);

const bobChat = await chatWith(bob, alice.id);
await bob.page.goto(`/chat/${bobChat}`);
await bob.page.waitForFunction(
  () => document.querySelectorAll('.media-meta-foot').length >= 2,
  null,
  { timeout: 20_000 },
);
const footers = await bob.page.evaluate(() =>
  Array.from(document.querySelectorAll('.media-meta-foot')).map((e) => ({
    text: e.textContent.trim(),
    align: getComputedStyle(e).textAlign,
    overlaid: getComputedStyle(e).position === 'absolute',
  })),
);
console.log('[footers]', JSON.stringify(footers));
await shot(bob, 'media-footer-meta', {});

// ---- Part 2: GIF send skips the quality prompt ----
const beforeOut = await alice.page.evaluate(() => document.querySelectorAll('.bubble.out, .out .bubble').length);
await alice.page.evaluate((u) => {
  const ta = document.querySelector('ion-textarea.composer textarea');
  const dt = new DataTransfer();
  dt.setData('text/plain', u);
  ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, 'http://127.0.0.1:8098/x.gif');
await alice.page.waitForFunction(() => document.querySelectorAll('.paste-thumb').length > 0, null, { timeout: 8000 });
await alice.page.locator('ion-textarea.composer textarea').press('Enter');
await alice.page.waitForTimeout(1200);
const alertShown = await alice.page.evaluate(() => !!document.querySelector('ion-alert'));
const sent = await alice.page.evaluate(() => document.querySelectorAll('.media-wrap img.bubble-image').length > 0);
console.log(`[skip-prompt] qualityDialogShown=${alertShown} gifSent=${sent}`);

// Every media footer must be a real footer line (not overlaid) carrying quality ·
// resolution · size. The exact quality label is data-dependent (HD only when the
// re-encode actually shrinks the source), so we don't pin it.
const metaInFooter = footers.length >= 2 && footers.every((f) => !f.overlaid && /·/.test(f.text) && /\d+×\d+/.test(f.text));
console.log(metaInFooter && !alertShown && sent
  ? '[PASS] metadata shown in the footer (not overlaid); GIF send skips the quality prompt'
  : '[FAIL] see above');

server.close();
await sweep([alice, bob]);
await done();
