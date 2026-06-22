/**
 * Spec 2005 check: pause/resume during video-message recording.
 *
 * Opens the round video-note recorder (long-press the camera button), lets it record,
 * then taps the new Pause control and confirms the timer FREEZES, taps Resume and confirms
 * it CONTINUES, and Sends — confirming a video message reaches the peer. Uses the driver's
 * fake camera/mic (already enabled in driver.mjs).
 *
 *   HEADED=1 node drive/scenarios/video-note-pause.mjs
 *
 * Screenshots → .tmp/drive/*.png (Read them back to inspect).
 */
import { createAccount, pair, chatWith, shot, sweep, done, poll } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice', mobile: true });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);

// Open Alice's chat with Bob and long-press the camera button to launch the recorder.
const chat = await chatWith(alice, bob.id);
await alice.page.goto(`/chat/${chat}`);
await alice.page.waitForTimeout(600);

const cam = alice.page.locator('[aria-label="Camera"]');
await cam.dispatchEvent('pointerdown'); // camDown → after ~600ms videoNoteOpen = true
await poll(
  () => alice.page.locator('.vn-overlay').count().then((n) => n > 0),
  Boolean,
  { label: 'video recorder open', timeout: 5000 },
);
await cam.dispatchEvent('pointerup');

// 3-2-1 countdown, then recording begins. Wait it out plus a little recorded time.
await alice.page.waitForTimeout(4500);
await shot(alice, '2005-recording'); // red pulsing square (recording), timer advancing

const readElapsed = () => alice.page.locator('.vn-timer').textContent();

// Pause: the timer must FREEZE.
await alice.page.locator('[aria-label="Pause recording"]').click();
await alice.page.waitForTimeout(300);
const atPause = await readElapsed();
await shot(alice, '2005-paused'); // resume ▶ glyph
await alice.page.waitForTimeout(1500);
const afterPauseWait = await readElapsed();
console.log(`[check] elapsed at pause=${atPause} after 1.5s paused=${afterPauseWait} (expect EQUAL)`);

// Resume: the timer must CONTINUE.
await alice.page.locator('[aria-label="Resume recording"]').click();
await alice.page.waitForTimeout(1500);
const afterResume = await readElapsed();
console.log(`[check] elapsed after resume+1.5s=${afterResume} (expect GREATER than ${afterPauseWait})`);

// Send from the (now recording) state and confirm Bob receives a video message.
await alice.page.locator('.vn-bar [aria-label="Send"]').click();
const bobChat = await chatWith(bob, alice.id);
await poll(
  () => bob.page.evaluate((c) => window.__ringTest.messages(c), bobChat),
  (msgs) => Array.isArray(msgs) && msgs.some((m) => m.kind === 'video'),
  { label: 'Bob receives the video note', timeout: 15000 },
);
console.log('[check] Bob received a video message ✓');

await sweep([alice, bob]);
await done();
