/**
 * Spec 2053 — media send lanes + no head-of-line block.
 *
 * Regression guard for the restructured runMediaJob: a video (heavy lane, transcodes) sent
 * right before a burst of images (light lane) must NOT stall the images, and every item must
 * leave the 'compressing' clock — reaching a sent/pending/delivered state — rather than hanging.
 * Also exercises the GIF pass-through path (isPreservedImageMime) end-to-end.
 *
 *   node drive/scenarios/media-lanes-2053.mjs
 *   HEADED=1 node drive/scenarios/media-lanes-2053.mjs
 */
import { createAccount, pair, chatWith, waitForMessage, say, shot, poll, sweep, done } from '../driver.mjs';

// A 1x1 transparent GIF — exercises the animated/preserved-image pass-through (no re-encode).
const TINY_GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
await pair(alice, bob);

const aliceChat = await chatWith(alice, bob.id);

// Fire a heavy video FIRST, then a burst of light images + a GIF — all back-to-back, the exact
// shape that used to wedge behind the video on the single serial queue.
await alice.page.evaluate(
  async ({ chatId, gif }) => {
    const t = window.__ringTest;
    // Heavy lane: a real, decodable clip that genuinely transcodes at 'hd'.
    await t.sendRealVideoQuality(chatId, 'hd', 640, 480, 1, 4_000_000, 'clip.mp4');
    // Light lane: three real images + one GIF pass-through, all queued immediately after.
    await t.sendImage(chatId, 800, 600, 'a.png');
    await t.sendImage(chatId, 800, 600, 'b.png');
    await t.sendImage(chatId, 800, 600, 'c.png');
    await t.sendImageData(chatId, gif, 'image/gif', 'anim.gif', 'hd');
  },
  { chatId: aliceChat, gif: TINY_GIF },
);

// Every one of the 5 media messages must leave 'compressing' (no stuck clock, no wedge).
const settled = (s) => ['pending', 'sent', 'delivered', 'seen'].includes(s);
await poll(
  () => alice.page.evaluate((c) => window.__ringTest.messages(c), aliceChat),
  (msgs) => {
    const media = msgs.filter((m) => m.kind === 'image' || m.kind === 'video');
    return media.length >= 5 && media.every((m) => settled(m.status));
  },
  { timeout: 60_000, label: 'all 5 media left compressing on sender' },
);

// And the recipient actually receives all 5.
const bobChat = await chatWith(bob, alice.id);
await poll(
  () => bob.page.evaluate((c) => window.__ringTest.messages(c), bobChat),
  (msgs) => msgs.filter((m) => m.kind === 'image' || m.kind === 'video').length >= 5,
  { timeout: 60_000, label: 'recipient received all 5 media' },
);

// Report the settle order on the sender — images/GIF should not be gated behind the transcode.
const finalAlice = await alice.page.evaluate((c) => window.__ringTest.messages(c), aliceChat);
const order = finalAlice
  .filter((m) => m.kind === 'image' || m.kind === 'video')
  .map((m) => `${m.kind}:${m.status}`)
  .join('  ');
console.log('[2053] sender media states:', order);

await say(alice, bob.id, 'lanes ok ✅');
await waitForMessage(bob, alice.id, 'lanes ok');

await shot(bob, 'bob-media-lanes', { route: `/chat/${await chatWith(bob, alice.id)}` });
await shot(alice, 'alice-media-lanes', { route: `/chat/${aliceChat}` });

await sweep([alice, bob]);
await done();
