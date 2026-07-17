// Visual check (spec 2029): 3-person group VIDEO call; C turns the camera off.
// A's view must show C's avatar tile (not a black tile), and C's uplink should
// drop to ~zero (the detached sender encodes nothing).
import { createAccount, pair, poll, shot, sweep, done } from '../driver.mjs';

const hook = (c, expr) => c.page.evaluate(expr);

const a = await createAccount({ name: 'GcamA', label: 'A' });
const b = await createAccount({ name: 'GcamB', label: 'B' });
const c = await createAccount({ name: 'GcamC', label: 'C' });
// Finish onboarding (confirm the recovery code) so the router lets us into the app.
for (const p of [a, b, c]) {
  await p.page.getByText("I'VE SAVED IT").click();
  await p.page.waitForTimeout(500);
}
await pair(a, b);
await pair(a, c);
await pair(b, c);

const room = `drive-camoff-${a.id.slice(0, 6)}`;
for (const p of [a, b, c]) {
  await p.page.evaluate((r) => window.__ringTest.startGroup(r, 'video'), room);
}
for (const p of [a, b, c]) {
  await poll(() => hook(p, () => window.__ringTest.remoteStreamCount()), (n) => n >= 2, {
    label: `${p.label} sees 2 streams`,
    timeout: 60_000,
  });
}
// The hook starts the call engine headlessly; enter the call UI IN-APP through the
// router's own history (a page.goto would reload the SPA and wipe the live call).
await a.page.evaluate(() => {
  history.pushState({}, '', '/call-active');
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
});
await a.page.waitForTimeout(3000); // let video land on every tile
await shot(a, 'group-before-camoff');

await hook(c, () => window.__ringTest.toggleCamera());
// A's tile for C flips to the avatar (the .tile-camoff overlay) via the sealed signal.
await poll(() => a.page.locator('.tile-camoff').count(), (n) => n >= 1, {
  label: 'A shows an avatar tile for C',
  timeout: 15_000,
});
await a.page.waitForTimeout(1000);
await shot(a, 'group-after-camoff');

// C's uplink after a few stats ticks: with one leg... C sends to A and B; camera off
// detaches BOTH legs' video, so kBpsUp collapses to audio-only (~5-6 KB/s for 2 legs).
await c.page.waitForTimeout(6000);
const stats = await hook(c, () => window.__ringTest.stats());
console.log(`[C uplink after camoff] ${JSON.stringify(stats)}`);

for (const p of [a, b, c]) await hook(p, () => window.__ringTest.hangup());
await sweep([a, b, c]);
await done();
