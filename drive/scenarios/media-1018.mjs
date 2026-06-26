/**
 * Spec 1018 verification: media sharing + viewer changes still work end-to-end.
 *   - US2: a sent photo/video shows a thumbnail in the chat bubble and the media grid.
 *   - US3: the rewritten MediaViewer (pinch-centering / rubber-band / momentum) still opens
 *     from the grid, displays the item, and double-tap zoom works without console errors.
 * (US1 orientation needs real capture metadata that headless fake-media can't produce — that's a
 *  real-device check; here we only confirm a video message round-trips and renders.)
 *
 *   HEADED=1 node drive/scenarios/media-1018.mjs
 */
import { createAccount, pair, waitForMessage, chatWith, shot, poll, sweep, done, BASE_URL } from '../driver.mjs';

const a = await createAccount({ name: 'Mia', label: 'A' });
const b = await createAccount({ name: 'Ben', mobile: true, label: 'B' });
await pair(a, b);

// Collect page errors on B to assert the viewer/thumbnail code paths are clean.
const errors = [];
b.page.on('pageerror', (e) => errors.push(String(e)));

// A → B: REAL decodable gradient images (the driver's sendImage sends a 4-byte stub, which renders
// as a broken tile — use the test hook's real-image generator to exercise the actual thumbnail path).
const chatA = await chatWith(a, b.id);
await a.page.evaluate((id) => window.__ringTest.sendImage(id, 1600, 1200, 'wide.png'), chatA);
await a.page.evaluate((id) => window.__ringTest.sendImage(id, 1200, 1600, 'tall.png'), chatA);

const chatB = await chatWith(b, a.id);
await waitForMessage(b, a.id, /.*/); // at least one media message arrives
await b.page.waitForTimeout(2500); // let thumbnails generate/derive

// US2: chat bubbles with thumbnails.
await shot(b, 'media-1018-bubbles', { route: `${BASE_URL}/chat/${chatB}` });

// US2: the all-media grid.
await b.page.goto(`${BASE_URL}/chat/${chatB}/media`);
await b.page.waitForTimeout(1500);
const cells = await b.page.locator('.media-cell').count();
await shot(b, 'media-1018-grid');
console.log(`[B] media grid cells = ${cells}`);

// US3: open the viewer from the grid and confirm it renders.
let viewerOpened = false;
if (cells > 0) {
  await b.page.locator('.media-cell').first().click();
  viewerOpened = await poll(
    () => b.page.locator('.viewer-track').count(),
    (n) => n > 0,
    { label: 'viewer track', timeout: 6000 },
  ).then(() => true).catch(() => false);
  await b.page.waitForTimeout(800);
  await shot(b, 'media-1018-viewer');

  // Double-tap the image → zoom in; double-tap again → back to fit (SC-006, gesture-only).
  const stage = b.page.locator('.viewer-track');
  const box = await stage.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (const _pass of [1, 2]) {
      await b.page.touchscreen.tap(cx, cy);
      await b.page.waitForTimeout(60);
      await b.page.touchscreen.tap(cx, cy); // second tap within the double-tap window
      await b.page.waitForTimeout(400);
    }
  }
  await shot(b, 'media-1018-viewer-after-doubletap');
}

console.log(`[result] viewerOpened=${viewerOpened} pageErrors=${errors.length}`);
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));

await sweep([a, b]);
await done();
