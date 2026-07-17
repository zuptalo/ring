/**
 * Decisive probe: does a VIDEO call actually capture + publish video in this (headless,
 * fake-media) environment? 1:1 so we can use the reliable 1:1-only signals
 * (inboundVideoFrames / videoTransceivers). If 1:1 shows local=2 + frames>0, fake-media
 * video works and a group call showing local=1 is a real group bug; if 1:1 ALSO shows
 * local=1, it's an environment quirk, not a product bug.
 */
import { createAccount, pair, done, sweep, poll } from '../driver.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const localKinds = (c) =>
  c.page.evaluate(() => {
    const t = window.__ringTest;
    // Reach into the live local stream via the same refs the hook exposes indirectly.
    return {
      state: t.callState(),
      local: t.localTracks(),
      remotes: t.remoteStreamCount(),
      vtx: t.videoTransceivers?.() ?? null,
    };
  });
const framesOf = (c) => c.page.evaluate(() => window.__ringTest.inboundVideoFrames());

const a = await createAccount({ name: 'A', label: 'A' });
const b = await createAccount({ name: 'B', label: 'B' });
await pair(a, b);

console.log('\n=== 1:1 VIDEO call ===');
await a.page.evaluate((p) => window.__ringTest.startCall(p, 'video'), b.id);
await poll(() => b.page.evaluate(() => window.__ringTest.callState()), (s) => s === 'incoming', { label: 'B rings' });
await b.page.evaluate(() => window.__ringTest.accept());
await poll(() => a.page.evaluate(() => window.__ringTest.callState()), (s) => s === 'connected', { label: 'A connected' });
await wait(5000);

for (const [c, label] of [[a, 'A'], [b, 'B']]) {
  const i = await localKinds(c);
  const f = await framesOf(c);
  console.log(`[${label}] state=${i.state} localTracks=${i.local} remotes=${i.remotes} videoTransceivers=${i.vtx} inboundVideoFrames=${f}`);
}
console.log('\nInterpretation: localTracks=2 + inboundVideoFrames>0 ⇒ fake-media video works (so group local=1 is a real group bug).');

await sweep([a, b]);
await done();
