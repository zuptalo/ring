/** Spec 2035: a youtu.be link must produce a SHARP video-thumbnail hero
 *  (og:image sits past the old 512 KiB unfurl cap — SC-001, live relay). */
import { createAccount, pair, chatWith, say, waitForMessage, shot, poll, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Ava' });
const b = await createAccount({ name: 'Ben', mobile: true });
await pair(a, b);

const URL = 'https://youtu.be/S0sjxWJXPog';
await say(a, b.id, `check this out ${URL}`);
await waitForMessage(b, a.id, 'check this out');

// The preview is built sender-side and attaches deferred — wait until B's copy
// carries an IMAGE (not just the meta), then check its recorded natural width.
const bChat = await chatWith(b, a.id);
const width = await poll(
  async () => {
    const ms = await b.page.evaluate((id) => window.__ringTest.messages(id), bChat);
    const m = ms.find((x) => x.body.includes('youtu.be'));
    return m?.linkPreview?.hasImage ? (m.linkPreview.imageWidth ?? -1) : null;
  },
  (v) => v !== null,
  { timeout: 30_000, label: 'link preview image attached' },
);
console.log(`[2035] preview image width: ${width}px (hero needs >= 200)`);
if (width >= 200) console.log('[2035] PASS — real og:image thumbnail, hero-sized');
else console.log('[2035] FAIL — favicon-class image, would render iconic');

await shot(b, 'link-preview-2035', { route: `/chat/${bChat}` });
await sweep([a, b]);
await done();
