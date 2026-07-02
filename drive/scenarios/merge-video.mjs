/**
 * Spec 1030, US1 — the VIDEO result of a merge (the part headless CI can't run).
 * Alice and Bob are in a 1:1 AUDIO call; Carol video-calls Alice; Alice taps
 * "Add to call" (merge). The combined call is 3 people (≤ 4) so it is
 * VIDEO-CAPABLE: each participant turns their OWN camera on with the normal
 * control (no auto-camera — verified), and video then flows among all three.
 *
 *   node drive/scenarios/merge-video.mjs
 *   HEADED=1 node drive/scenarios/merge-video.mjs
 *
 * Drives the live `make start` stack; real WebRTC via chromium fake media.
 * Screenshots land in .tmp/drive/.
 */
import { createAccount, pair, shot, sweep, done, poll } from '../driver.mjs';

const issues = [];
const note = (ok, label, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗ ISSUE'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) issues.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const act = (c, fn, ...args) => c.page.evaluate(([f, a]) => window.__ringTest[f](...a), [fn, args]);
const info = (c) =>
  c.page.evaluate(() => {
    const t = window.__ringTest;
    const meta = t.callMeta();
    return {
      state: t.callState(),
      kind: meta?.kind ?? null,
      isGroup: !!meta?.isGroup,
      roster: meta?.roster ?? [],
      remotes: t.remoteStreamCount(),
      localVideo: t.localVideoTracks(),
    };
  });
const meshFrames = (c) => c.page.evaluate(() => window.__ringTest.groupCallDiag());

console.log('\n=== SETUP: three accounts, all paired ===');
const alice = await createAccount({ name: 'Alice', label: 'Alice' });
const bob = await createAccount({ name: 'Bob', label: 'Bob' });
const carol = await createAccount({ name: 'Carol', label: 'Carol' });
for (const [x, y] of [[alice, bob], [alice, carol], [bob, carol]]) await pair(x, y);

console.log('\n=== A: Alice and Bob in a 1:1 AUDIO call ===');
await act(alice, 'startCall', bob.id, 'audio');
await poll(() => info(bob), (i) => i.state === 'incoming', { label: 'Bob ringing' });
await act(bob, 'accept');
await poll(() => info(alice), (i) => i.state === 'connected', { label: 'A↔B connected' });

console.log('\n=== B: Carol VIDEO-calls Alice; Alice merges her in ===');
await act(carol, 'startCall', alice.id, 'video');
await poll(() => alice.page.evaluate(() => window.__ringTest.hasSecondIncoming()), (v) => v === true, { label: 'call-waiting prompt on Alice' });
await act(alice, 'mergeIncoming');
for (const c of [alice, bob, carol]) {
  await poll(() => info(c), (i) => i.remotes >= 2, { label: `${c.label} meshed with 2`, timeout: 60_000 });
}
const merged = await info(alice);
note(merged.isGroup, 'merge produced a group call', JSON.stringify(merged));
note(merged.kind === 'audio', 'merged call starts AUDIO (nobody auto-upgraded)', `kind=${merged.kind}`);

console.log('\n=== C: no auto-camera — everyone joined with zero local video tracks ===');
for (const c of [alice, bob, carol]) {
  const i = await info(c);
  note(i.localVideo === 0, `${c.label} camera OFF after merge (no auto-camera)`, `localVideo=${i.localVideo}`);
}

console.log('\n=== D: each participant turns their OWN camera on (per-participant control) ===');
for (const c of [alice, bob, carol]) {
  await act(c, 'toggleVideo');
  await poll(() => info(c), (i) => i.localVideo === 1, { label: `${c.label} camera on` });
}

console.log('\n=== E: video actually FLOWS among all three (inbound mesh frames) ===');
for (const c of [alice, bob, carol]) {
  await poll(() => meshFrames(c), (d) => d.inboundVideoFrames > 0, { label: `${c.label} decoding video`, timeout: 60_000 });
  const d = await meshFrames(c);
  note(d.inboundVideoFrames > 0, `${c.label} inbound video frames`, `${d.inboundVideoFrames}`);
}
// No route: a goto() reloads the SPA and drops the live call — Alice is already
// on the call screen, so capture the page as-is.
await shot(alice, 'merge-video-grid');

for (const c of [alice, bob, carol]) await act(c, 'hangup').catch(() => {});
console.log(issues.length ? `\nISSUES (${issues.length}):\n - ${issues.join('\n - ')}` : '\nAll merge-video checks passed.');
await sweep([alice, bob, carol]);
await done();
if (issues.length) process.exitCode = 1;
