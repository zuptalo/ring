// Probe (spec 2025): watch the 1:1 adaptive tier on the LIVE dev stack — capture
// resolution, the high→hd climb (≤6s, SC-001), steady state (no down-steps, SC-002),
// and the pin-clamp → unpin recovery (SC-003 proxy at the integration level).
import { createAccount, pair, poll, sweep, done } from '../driver.mjs';

const hook = (c, fn, arg) => c.page.evaluate(fn, arg);

const a = await createAccount({ name: 'QuaA', label: 'A' });
const b = await createAccount({ name: 'QuaB', label: 'B' });
await pair(a, b);

await a.page.evaluate((peer) => window.__ringTest.startCall(peer, 'video'), b.id);
await poll(() => hook(b, () => window.__ringTest.callState()), (s) => s === 'incoming', { label: 'ring' });
await hook(b, () => window.__ringTest.accept());
await poll(() => hook(a, () => window.__ringTest.callState()), (s) => s === 'connected', { label: 'connected' });
const t0 = Date.now();

const gum = await hook(a, () => window.__ringTest.localVideoSettings());
console.log(`[capture] ${gum?.width}x${gum?.height}@${gum?.frameRate ?? '?'}fps  (expect ≥1280x720 on desktop Chromium)`);

// Sample the tier every second for 20s: expect 'high' immediately, 'hd' within ~6s, and
// ZERO down-steps once there.
const TIERS = ['off', 'low', 'medium', 'high', 'hd'];
const seen = [];
let hdAtMs = null;
let downSteps = 0;
for (let i = 0; i < 20; i++) {
  const q = await hook(a, () => window.__ringTest.callQuality());
  seen.push(q.tier);
  if (q.tier === 'hd' && hdAtMs == null) hdAtMs = Date.now() - t0;
  if (seen.length > 1 && TIERS.indexOf(q.tier) < TIERS.indexOf(seen[seen.length - 2])) downSteps++;
  await a.page.waitForTimeout(1000);
}
console.log(`[tier] samples: ${seen.join(' ')}`);
console.log(`[tier] hd reached at +${hdAtMs}ms (SC-001 wants ≤6000)  down-steps=${downSteps} (SC-002 wants 0)`);

// Pin low (clamps immediately), then back to auto — the climb must resume within ~10s.
await hook(a, () => window.__ringTest.setVideoQuality('low'));
await poll(() => hook(a, () => window.__ringTest.callQuality()), (q) => q.tier === 'low', { label: 'pin clamps', timeout: 10_000 });
console.log('[pin] low pin clamped the tier ✓');
await hook(a, () => window.__ringTest.setVideoQuality('auto'));
const tUnpin = Date.now();
await poll(
  () => hook(a, () => window.__ringTest.callQuality()),
  (q) => q.tier === 'high' || q.tier === 'hd',
  { label: 'recovery climb', timeout: 15_000 },
);
console.log(`[pin] climbed back to high/hd ${Date.now() - tUnpin}ms after unpin (SC-003 proxy: ≤10s) ✓`);

await hook(a, () => window.__ringTest.hangup());
await sweep([a, b]);
await done();
