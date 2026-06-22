/**
 * Spec 2005 check: video-message recording → STOP → review → Send.
 *
 * Opens the round video-note recorder (long-press the camera button), lets it record,
 * taps Stop (which ENDS the take and enters review — never auto-sends), confirms the
 * Play-preview control appears, plays the clip back, then Sends and confirms the peer
 * receives it. Uses the driver's fake camera/mic (already enabled in driver.mjs).
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
await shot(alice, '2005-recording'); // red square Stop; timer advancing

// Flip the camera mid-recording: the take must CONTINUE (same recording), not restart —
// the Stop control stays present (still phase=recording), no countdown reappears, and the
// timer keeps advancing rather than resetting to 0:00.
const beforeFlip = (await alice.page.locator('.vn-timer').textContent())?.trim();
await alice.page.locator('[aria-label="Flip camera"]').click();
await alice.page.waitForTimeout(1500);
const stopStillThere = (await alice.page.locator('[aria-label="Stop recording"]').count()) > 0;
const countdownGone = (await alice.page.locator('.vn-count').count()) === 0;
const afterFlip = (await alice.page.locator('.vn-timer').textContent())?.trim();
console.log(
  `[check] flip keeps recording the same take: stop-present=${stopStillThere}, no-countdown=${countdownGone}, timer ${beforeFlip}→${afterFlip} (expect advanced, not 0:00)`,
);

// Stop → review. Recording ends; nothing is sent. The Play-preview control must appear.
await alice.page.locator('[aria-label="Stop recording"]').click();
await poll(
  () => alice.page.locator('[aria-label="Play preview"], [aria-label="Pause preview"]').count().then((n) => n > 0),
  Boolean,
  { label: 'review controls appear', timeout: 5000 },
);
await alice.page.waitForTimeout(400);
await shot(alice, '2005-review'); // Retake · Play/Pause · Send

// Confirm NOTHING was auto-sent during/after recording (we are still in review).
const bobChat = await chatWith(bob, alice.id);
const early = await bob.page.evaluate((c) => window.__ringTest.messages(c), bobChat);
const sentEarly = Array.isArray(early) && early.some((m) => m.kind === 'video');
console.log(`[check] no auto-send before tapping Send: ${!sentEarly ? 'OK' : 'FAIL — a video was already sent'}`);

// Play it back, then Send.
await alice.page.locator('[aria-label="Play preview"]').click().catch(() => {});
await alice.page.waitForTimeout(800);
await alice.page.locator('.vn-bar [aria-label="Send"]').click();
await poll(
  () => bob.page.evaluate((c) => window.__ringTest.messages(c), bobChat),
  (msgs) => Array.isArray(msgs) && msgs.some((m) => m.kind === 'video'),
  { label: 'Bob receives the video message after Send', timeout: 15000 },
);
console.log('[check] Bob received the video message only after Send ✓');

await sweep([alice, bob]);
await done();
