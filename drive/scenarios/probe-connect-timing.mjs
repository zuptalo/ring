// Probe (spec 1039 follow-up): how long from placing/accepting a call until BOTH sides
// have media flowing — for a normal answered call AND a simultaneous mutual call — with
// the spec-2008 connect milestones to show where the time goes. Investigating a report
// of ~15s to first video on ring-dev.
import { createAccount, pair, poll, sweep, done } from '../driver.mjs';

const t = () => Date.now();
const hook = (c, expr) => c.page.evaluate(expr);

async function waitState(c, states, timeout = 40_000) {
  await poll(
    () => hook(c, () => window.__ringTest.callState()),
    (s) => states.includes(s),
    { timeout, label: `state ${states}` },
  );
}
async function waitMedia(c, timeout = 40_000) {
  await poll(
    () => hook(c, () => window.__ringTest.remoteTracks()),
    (n) => n > 0,
    { timeout, label: 'remote media' },
  );
}

const a = await createAccount({ name: 'TimA', label: 'A' });
const b = await createAccount({ name: 'TimB', label: 'B' });
await pair(a, b);
await hook(a, () => window.__ringTest.recordConnect(true));
await hook(b, () => window.__ringTest.recordConnect(true));

// --- normal answered video call ---
let t0 = t();
await a.page.evaluate((peer) => window.__ringTest.startCall(peer, 'video'), b.id);
await waitState(b, ['incoming']);
const tRing = t() - t0;
const tAccept = t();
await hook(b, () => window.__ringTest.accept());
await waitState(a, ['connected']);
await waitState(b, ['connected']);
const tConn = t() - tAccept;
await waitMedia(a);
await waitMedia(b);
const tMedia = t() - tAccept;
console.log(`[normal] ring=${tRing}ms  accept→connected=${tConn}ms  accept→both-media=${tMedia}ms`);
console.log('[normal] A marks:', JSON.stringify(await hook(a, () => window.__ringTest.connectMarks())));
console.log('[normal] B marks:', JSON.stringify(await hook(b, () => window.__ringTest.connectMarks())));
await hook(a, () => window.__ringTest.hangup());
await waitState(a, ['idle'], 15_000);
await waitState(b, ['idle'], 15_000);

// --- simultaneous mutual video call ---
await hook(a, () => window.__ringTest.recordConnect(true));
await hook(b, () => window.__ringTest.recordConnect(true));
t0 = t();
await Promise.all([
  a.page.evaluate((peer) => window.__ringTest.startCall(peer, 'video'), b.id),
  b.page.evaluate((peer) => window.__ringTest.startCall(peer, 'video'), a.id),
]);
await waitState(a, ['connected']);
await waitState(b, ['connected']);
const tConn2 = t() - t0;
await waitMedia(a);
await waitMedia(b);
const tMedia2 = t() - t0;
console.log(`[mutual] tap→connected=${tConn2}ms  tap→both-media=${tMedia2}ms`);
console.log('[mutual] A marks:', JSON.stringify(await hook(a, () => window.__ringTest.connectMarks())));
console.log('[mutual] B marks:', JSON.stringify(await hook(b, () => window.__ringTest.connectMarks())));
await hook(a, () => window.__ringTest.hangup());
await waitState(a, ['idle'], 15_000);

await sweep([a, b]);
await done();
