/**
 * Group-call shakedown: FOUR accounts join one video group call (full mesh), then we
 * walk happy + unhappy scenarios and log what actually happens. A 5th account (Eve) is
 * used only to probe the participant cap.
 *
 *   node drive/scenarios/group-call-4.mjs
 *   HEADED=1 SLOWMO=200 node drive/scenarios/group-call-4.mjs   # to watch
 *
 * Drives the live `make start` / `make deploy-dev` stack (vite :5173 → ringd :8080).
 * Real WebRTC between contexts via chromium fake media. Observations + a final ISSUES
 * tally print to stdout; screenshots land in .tmp/drive/.
 *
 * Scenarios:
 *   A happy   — 4 join video, mesh converges (each sees 3 remotes, frames flowing)
 *   B caps    — Eve (5th video) is refused with a "call full" cue (max 4)
 *   C toggle  — Dave turns camera off then on; peers see the video track drop/return
 *   D leave   — Carol hangs up; peers get "Carol left the call" + her tile goes
 *   E blip    — Bob's socket drops ~8s then recovers; he rejoins, is NOT re-rung
 *   F busy    — idle Carol calls Alice (in the call) 1:1 → busy, Alice undisturbed
 *   G end     — everyone hangs up
 */
import { createAccount, pair, group, shot, sweep, done, poll } from '../driver.mjs';

const KIND = 'video';
const issues = [];
const note = (ok, label, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗ ISSUE'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) issues.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

// ---- call introspection over the __ringTest hook ----
// NOTE on measurement: for GROUP calls the reliable hook signals are callState, callMeta
// (roster/direction), remoteStreamCount, groupStreamOwners, localTracks, and notices().
// inboundVideoFrames()/videoTransceiverCount() are 1:1-only (they read `pc`, which is null
// in a mesh call) and remoteVideoTracks() reads track.muted (unreliable headless). So we do
// NOT assert on remote *video* flow here — only on membership/connection/notice behaviour.
const info = (c) =>
  c.page.evaluate(() => {
    const t = window.__ringTest;
    const meta = t.callMeta();
    return {
      state: t.callState(),
      dir: meta?.direction ?? null,
      roster: meta?.roster ?? [],
      invited: meta?.invited ?? [],
      remotes: t.remoteStreamCount(),
      local: t.localTracks(),
      owners: t.groupStreamOwners(),
      kbpsUp: t.stats()?.kbpsUp ?? 0,
      kbpsDown: t.stats()?.kbpsDown ?? 0,
      notices: t.notices(),
    };
  });
const act = (c, fn, arg) => c.page.evaluate(([f, a]) => window.__ringTest[f](a), [fn, arg]);
const lastNotices = (i, n = 3) => i.notices.slice(-n).map((x) => `${x.kind}:"${x.name}"`).join(' | ') || '(none)';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n=== SETUP: 5 accounts, pair the four callers pairwise, build the group ===');
const alice = await createAccount({ name: 'Alice', label: 'Alice' });
const bob = await createAccount({ name: 'Bob', label: 'Bob' });
const carol = await createAccount({ name: 'Carol', label: 'Carol' });
const dave = await createAccount({ name: 'Dave', label: 'Dave' });
const eve = await createAccount({ name: 'Eve', label: 'Eve' });

const four = [alice, bob, carol, dave];
// Pair EVERY pair among all five (including Eve) so no mesh leg falls back to the
// ephemeral call-scoped X3DH path — that keeps this run free of the unpaired-co-member
// confounder, so anything that breaks is the behaviour under test, not session setup.
const all = [alice, bob, carol, dave, eve];
for (let i = 0; i < all.length; i++)
  for (let j = i + 1; j < all.length; j++) await pair(all[i], all[j]);

const gid = await group(alice, 'Squad', [bob, carol, dave]);
console.log(`group room = ${gid}`);

// =================================================================== A: happy join
console.log('\n=== A: all four join the video call (mesh should converge) ===');
for (const c of four) await act(c, 'startGroup', gid).catch((e) => console.log(`${c.label} startGroup threw: ${e}`));

// Wait until everyone reports 3 remote streams (or time out).
let converged = true;
for (const c of four) {
  try {
    await poll(() => info(c).then((i) => i.remotes), (r) => r >= 3, { timeout: 30_000, label: `${c.label} sees 3 remotes` });
  } catch {
    converged = false;
  }
}
await wait(5000); // let media flow + adaptive controller take a few samples
for (const c of four) {
  const i = await info(c);
  const diag = await c.page.evaluate(() => window.__ringTest.groupCallDiag()); // mesh frames + per-leg tiers
  console.log(`[${c.label}] state=${i.state} remotes=${i.remotes} local=${i.local} up=${i.kbpsUp}kbps down=${i.kbpsDown}kbps roster=${i.roster.length} owners=${Object.keys(i.owners).length} meshFrames=${diag.inboundVideoFrames} tiers=${JSON.stringify(diag.tiers)}`);
  note(i.state === 'connected', `${c.label} connected`, i.state);
  note(i.remotes === 3, `${c.label} has exactly 3 remote streams`, `got ${i.remotes}`);
  note(i.roster.length === 4, `${c.label} roster lists all 4`, `got ${i.roster.length}`);
  note(i.kbpsUp > 0 && i.kbpsDown > 0, `${c.label} has media flowing both ways`, `up=${i.kbpsUp} down=${i.kbpsDown}`);
  note(Object.keys(i.owners).length === i.remotes, `${c.label} stream→owner map matches remotes`, `owners=${Object.keys(i.owners).length} remotes=${i.remotes}`);
}
note(converged, 'mesh converged for all four within 30s');
// NOTE: do NOT screenshot with {route:'/call-active'} here — shot()'s page.goto reloads the
// SPA, which tears down the in-memory call (drops that participant from the room). Screenshot
// the current page in place instead, so the call survives the rest of the scenario.
await shot(alice, 'gc4-A-alice-grid');
await shot(dave, 'gc4-A-dave-grid');

// =================================================================== B: participant cap
console.log('\n=== B: Eve tries to be the 5th video participant (cap is 4) ===');
const eveBefore = await info(eve);
await act(eve, 'startGroup', gid).catch((e) => console.log(`Eve startGroup threw: ${e}`));
await wait(6000);
const eveAfter = await info(eve);
console.log(`[Eve] state=${eveAfter.state} remotes=${eveAfter.remotes} notices=${lastNotices(eveAfter)}`);
note(eveAfter.state === 'idle', 'Eve is refused (returns to idle, not connected)', eveAfter.state);
note(
  eveAfter.notices.some((n) => /full/i.test(n.name) || /full/i.test(n.body)),
  'Eve sees a "call full" notice',
  lastNotices(eveAfter),
);
// The original four should be undisturbed.
for (const c of four) {
  const i = await info(c);
  note(i.remotes === 3, `${c.label} still has exactly 3 remotes after Eve's refusal`, `got ${i.remotes}`);
}

// =================================================================== C: camera toggle
// (Remote video-track counting is unreliable headless, so we only assert the call STAYS
//  healthy across a camera off/on — no peer should drop a stream just because Dave's
//  camera toggled. The visual effect is checked by screenshot.)
console.log('\n=== C: Dave turns his camera off, then back on (call must stay intact) ===');
await act(dave, 'toggleVideo');
await wait(4000);
await shot(alice, 'gc4-C-alice-dave-camera-off'); // in place — no reload (see Phase A note)
for (const c of four) {
  const i = await info(c);
  note(i.state === 'connected' && i.remotes === 3, `${c.label} call intact while Dave camera off`, `state=${i.state} remotes=${i.remotes}`);
}
await act(dave, 'toggleVideo');
await wait(4000);
for (const c of four) {
  const i = await info(c);
  note(i.state === 'connected' && i.remotes === 3, `${c.label} call intact after Dave camera back on`, `state=${i.state} remotes=${i.remotes}`);
}

// =================================================================== D: deliberate leave
console.log('\n=== D: Carol hangs up — peers should be told and her tile removed ===');
await act(carol, 'hangup');
await wait(5000);
for (const c of [alice, bob, dave]) {
  const i = await info(c);
  console.log(`[${c.label}] remotes=${i.remotes} roster=${i.roster.length} notices=${lastNotices(i)}`);
  note(i.remotes === 2, `${c.label} now sees 2 remotes after Carol left`, `got ${i.remotes}`);
  note(
    i.notices.some((n) => /carol/i.test(n.name) && /left/i.test(n.name)),
    `${c.label} got a "Carol left the call" notice (named)`,
    lastNotices(i),
  );
  note(!i.roster.includes(carol.id), `${c.label}'s roster no longer lists Carol`);
}
const carolIdle = await info(carol);
note(carolIdle.state === 'idle', 'Carol herself returns to idle after hangup', carolIdle.state);

// =================================================================== E: network blip + recover
console.log('\n=== E: Bob drops his socket ~8s (within the 18s grace), then recovers ===');
const bobPre = await info(bob);
await act(bob, 'disconnect');
await wait(8000);
const bobMid = await info(bob);
console.log(`[Bob] mid-blip state=${bobMid.state} dir=${bobMid.dir}`);
await act(bob, 'reconnect');
await wait(8000);
const bobPost = await info(bob);
console.log(`[Bob] post-recover state=${bobPost.state} dir=${bobPost.dir} remotes=${bobPost.remotes}`);
note(bobPost.state === 'connected' || bobPost.state === 'connecting', 'Bob is back in the call after the blip', bobPost.state);
note(bobPost.dir !== 'incoming', 'Bob was NOT re-rung as a fresh incoming call', `dir=${bobPost.dir}`);
note(bobPost.remotes === 2, 'Bob re-sees the 2 remaining peers', `got ${bobPost.remotes}`);
for (const c of [alice, dave]) {
  const i = await info(c);
  note(i.remotes === 2 && i.roster.includes(bob.id), `${c.label} kept Bob through the blip`, `remotes=${i.remotes}`);
}

// =================================================================== F: busy signal
console.log('\n=== F: idle Carol calls Alice (busy in the group call) 1:1 ===');
await carol.page.evaluate((p) => window.__ringTest.startCall(p, 'audio'), alice.id).catch((e) => console.log(`Carol startCall threw: ${e}`));
await wait(6000);
const carolBusy = await info(carol);
const aliceDuring = await info(alice);
console.log(`[Carol] state=${carolBusy.state} notices=${lastNotices(carolBusy)}`);
console.log(`[Alice] state=${aliceDuring.state} remotes=${aliceDuring.remotes} (should be unchanged)`);
note(carolBusy.state === 'idle', 'Carol\'s 1:1 attempt resolves (not stuck ringing)', carolBusy.state);
note(
  carolBusy.notices.some((n) => /busy|unavailable|in a call/i.test(n.name + n.body)),
  'Carol is told Alice is busy/unavailable',
  lastNotices(carolBusy),
);
note(aliceDuring.state === 'connected', 'Alice\'s group call is undisturbed by the busy 1:1', aliceDuring.state);

// =================================================================== G: everyone ends
console.log('\n=== G: remaining participants hang up ===');
for (const c of [alice, bob, dave]) await act(c, 'hangup').catch(() => {});
await wait(3000);
for (const c of [alice, bob, dave]) {
  const i = await info(c);
  note(i.state === 'idle', `${c.label} ended cleanly (idle)`, i.state);
}

// =================================================================== summary
console.log('\n=================== ISSUES FOUND ===================');
if (issues.length === 0) console.log('  none 🎉');
else issues.forEach((x, n) => console.log(`  ${n + 1}. ${x}`));
console.log('====================================================\n');

await sweep([alice, bob, carol, dave, eve]);
await done();
