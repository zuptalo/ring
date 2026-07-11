// Inspect the cold-start reveal: the normalized montage icons + the new discreet Skip
// button, and that tapping Skip actually dismisses it. Uses the ?launch-reveal force hook
// (no account needed — the reveal overlays everything from App.vue).
//
//   HEADED=1 node drive/scenarios/launch-reveal.mjs
import { newClient, shot, done } from '../driver.mjs';

const c = await newClient({ mobile: true, label: 'reveal' });
// The reveal is suppressed under automation (navigator.webdriver) and the ?launch-reveal
// query is dropped by the auth-gate redirect before the component reads it. A fresh
// context has empty localStorage (so isNewVersion is true) — spoof webdriver=false and it
// plays naturally, exactly as on a real first install.
await c.page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false });
});
await c.page.goto('/');

// ~0.6s in: "Messaging" bubble hold. Skip button is in the DOM from the start.
await c.page.waitForTimeout(600);
const hasSkip = await c.page.evaluate(() => !!document.querySelector('.rv-skip'));
console.log(`[check] Skip button present: ${hasSkip} (expect true)`);
await shot(c, 'reveal-1-bubble');

// ~4.0s: "Video calls" camera hold.
await c.page.waitForTimeout(3400);
await shot(c, 'reveal-2-camera');

// ~7.4s: "Wall & games" controller hold (with gamepad detail riding the normalized body).
await c.page.waitForTimeout(3400);
await shot(c, 'reveal-3-controller');

// Tap Skip → it should fade out and unmount.
await c.page.click('.rv-skip');
await c.page.waitForTimeout(700);
const gone = await c.page.evaluate(() => !document.querySelector('.launch-reveal'));
console.log(`[check] reveal dismissed after Skip: ${gone} (expect true)`);

await done();
