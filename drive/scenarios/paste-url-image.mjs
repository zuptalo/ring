// Verify pasting a remote image URL into the composer: the sender's client fetches the
// bytes and attaches them as a pending media message. A CORS-permissive URL succeeds;
// a CORS-blocked one falls back to pasting the link as text (never silently lost).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createAccount, pair, chatWith, sweep, done } from '../driver.mjs';

const gif = readFileSync('.tmp/anim.gif'); // a real animated GIF (NETSCAPE loop)

// Local CDN stand-in: /ok.* sends Access-Control-Allow-Origin:* (readable cross-origin);
// /blocked.* omits it (browser blocks the read — like a typical hotlink-only CDN).
const server = http.createServer((req, res) => {
  const headers = { 'Content-Type': 'image/gif' };
  if (req.url.startsWith('/ok')) headers['Access-Control-Allow-Origin'] = '*';
  res.writeHead(200, headers);
  res.end(gif);
});
await new Promise((r) => server.listen(8099, '127.0.0.1', r));
const okUrl = 'http://127.0.0.1:8099/ok.gif?width=300';
const blockedUrl = 'http://127.0.0.1:8099/blocked.gif?width=300';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);
const chat = await chatWith(alice, bob.id);
await alice.page.goto(`/chat/${chat}`);
await alice.page.waitForSelector('ion-textarea.composer textarea');

// Simulate a real text paste of a URL into the composer.
const pasteUrl = (url) =>
  alice.page.evaluate((u) => {
    const ta = document.querySelector('ion-textarea.composer textarea');
    const dt = new DataTransfer();
    dt.setData('text/plain', u);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, url);

// 1) CORS-permissive URL → fetched and attached as a pending image.
await pasteUrl(okUrl);
await alice.page.waitForFunction(() => document.querySelectorAll('.paste-thumb').length > 0, null, { timeout: 8000 }).catch(() => {});
const ok = await alice.page.evaluate(async () => {
  const img = document.querySelector('.paste-thumb img');
  if (!img) return { attached: false };
  const blob = await fetch(img.src).then((r) => r.blob());
  const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  let sig = ''; for (const b of head) sig += String.fromCharCode(b);
  return { attached: true, mime: blob.type, bytes: blob.size, animated: sig.includes('NETSCAPE') };
});
console.log('[cors-ok ] ', JSON.stringify(ok));

// Clear the attachment before the next case (remove button on the thumb).
await alice.page.evaluate(() => {
  const btn = document.querySelector('.paste-thumb ion-button, .paste-thumb button, .paste-thumb .remove');
  if (btn) btn.click();
});
await alice.page.waitForTimeout(300);

// 2) CORS-blocked URL → no attachment; the link drops into the draft instead.
await pasteUrl(blockedUrl);
await alice.page.waitForTimeout(1500);
const blocked = await alice.page.evaluate(() => ({
  attachments: document.querySelectorAll('.paste-thumb').length,
  draft: document.querySelector('ion-textarea.composer textarea')?.value ?? '',
}));
console.log('[blocked ] ', JSON.stringify(blocked));

const pass =
  ok.attached && ok.mime === 'image/gif' && ok.animated &&
  blocked.attachments === 0 && blocked.draft.includes('blocked.gif');
console.log(pass ? '[PASS] URL paste fetches + attaches; CORS-blocked falls back to text' : '[FAIL] see above');

server.close();
await sweep([alice, bob]);
await done();
