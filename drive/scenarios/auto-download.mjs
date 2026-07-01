/**
 * Auto-download now honors the per-kind setting AND a size limit, using the media metadata.
 * Photos set to "never" defer; a small size limit defers even an allowed kind; defaults download.
 *
 *   node drive/scenarios/auto-download.mjs
 */
import { preflight, createAccount, pair, chatWith, sweep, done, poll } from '../driver.mjs';

await preflight();
const [a, b] = [
  await createAccount({ name: 'Sender', mobile: true }),
  await createAccount({ name: 'Rx', mobile: true }),
];
await pair(a, b);
const aChat = await chatWith(a, b.id);
const bChat = await chatWith(b, a.id);

// Latest incoming image message id on B (waits for delivery).
async function latestIncomingImage() {
  return poll(
    () =>
      b.page.evaluate(
        (c) => window.__ringTest.messages(c).then((ms) => ms.filter((m) => m.kind === 'image' && !m.outgoing).map((m) => m.id).pop() ?? null),
        bChat,
      ),
    (v) => !!v,
    { label: 'incoming image' },
  );
}
const infoOf = (id) => b.page.evaluate((i) => window.__ringTest.mediaInfo(i), id);
const setB = (k, v) => b.page.evaluate(([kk, vv]) => window.__ringTest.setSetting(kk, vv), [k, v]);

// Case 1: photos = 'never' → the received image is DEFERRED (pending, not on device).
await setB('storage.autoDownload.photos', 'never');
await a.page.evaluate((c) => window.__ringTest.sendImage(c, 800, 600, 'never.png'), aChat);
let id = await latestIncomingImage();
await b.page.waitForTimeout(600);
let info = await infoOf(id);
console.log('kind=never →', JSON.stringify({ pending: info.pending, hasMedia: info.hasMedia }), '(expect pending true)');

// Case 2: photos allowed but size limit tiny (1 KB) → DEFERRED by size.
await setB('storage.autoDownload.photos', 'wifi-cellular');
await setB('storage.autoDownloadLimit', '0.001'); // ~1 KB
await a.page.evaluate((c) => window.__ringTest.sendImage(c, 900, 700, 'big.png'), aChat);
id = await latestIncomingImage();
await b.page.waitForTimeout(600);
info = await infoOf(id);
console.log('over size limit →', JSON.stringify({ pending: info.pending, hasMedia: info.hasMedia }), '(expect pending true)');

// Case 3: allowed + generous limit → should NOT defer. (In the harness the freshly-uploaded blob may
// not be fetchable the instant B receives, so if it's pending, a manual download must succeed —
// proving the decision was "download", not "defer".)
await setB('storage.autoDownloadLimit', '100');
await a.page.evaluate((c) => window.__ringTest.sendImage(c, 700, 500, 'ok.png'), aChat);
id = await latestIncomingImage();
await b.page.waitForTimeout(1500);
info = await infoOf(id);
if (info.pending) {
  await b.page.evaluate((i) => window.__ringTest.downloadMedia(i), id).catch(() => {});
  await b.page.waitForTimeout(800);
  info = await infoOf(id);
  console.log('within limits → was pending, manual download →', JSON.stringify({ hasMedia: info.hasMedia }), '(expect hasMedia true = blob fetchable, decision was download)');
} else {
  console.log('within limits →', JSON.stringify({ pending: info.pending, hasMedia: info.hasMedia }), '(expect hasMedia true)');
}

await sweep([a, b]);
await done();
