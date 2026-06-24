/**
 * Clean test of caps (US3), leave-notice (US naming), and busy (US2) — fixing the two
 * flaws in the earlier run: (1) STAGGERED joins (like real accepts) instead of a
 * simultaneous thundering herd, and (2) LIVE notice polling so a banner is caught during
 * its short on-screen window instead of after it auto-dismisses.
 */
import { createAccount, pair, group, done, sweep, poll } from '../driver.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const KIND = 'video';
const issues = [];
const note = (ok, label, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗ ISSUE'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) issues.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const snap = (c) => c.page.evaluate(() => ({ state: window.__ringTest.callState(), remotes: window.__ringTest.remoteStreamCount(), dir: window.__ringTest.callMeta()?.direction ?? null }));
// Poll notices() repeatedly so we catch a banner during its 1.8–3.5s visible window.
async function waitNotice(c, re, timeout = 6000) {
  const end = Date.now() + timeout;
  let seen = [];
  while (Date.now() < end) {
    const ns = await c.page.evaluate(() => window.__ringTest.notices().map((n) => `${n.kind}:${n.name}`));
    seen = ns;
    if (ns.some((s) => re.test(s))) return { hit: true, seen: ns };
    await wait(200);
  }
  return { hit: false, seen };
}

console.log('\n=== SETUP: 5 paired accounts + group of 4 ===');
const alice = await createAccount({ name: 'Alice', label: 'Alice' });
const bob = await createAccount({ name: 'Bob', label: 'Bob' });
const carol = await createAccount({ name: 'Carol', label: 'Carol' });
const dave = await createAccount({ name: 'Dave', label: 'Dave' });
const eve = await createAccount({ name: 'Eve', label: 'Eve' });
const all = [alice, bob, carol, dave, eve];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) await pair(all[i], all[j]);
const four = [alice, bob, carol, dave];
const gid = await group(alice, 'Squad', [bob, carol, dave]);

console.log('\n=== A: STAGGERED join (2.5s gaps) — does the mesh stay stable? ===');
for (const c of four) {
  await c.page.evaluate(([g, k]) => window.__ringTest.startGroup(g, k), [gid, KIND]);
  console.log(`  ${c.label} joined`);
  await wait(2500);
}
await wait(5000);
let stable = true;
for (const c of four) {
  const i = await snap(c);
  const local = await c.page.evaluate(() => window.__ringTest.localTracks());
  const diag = await c.page.evaluate(() => window.__ringTest.groupCallDiag());
  console.log(`[${c.label}] state=${i.state} remotes=${i.remotes} localTracks=${local} meshFrames=${diag.inboundVideoFrames} tiers=${JSON.stringify(diag.tiers)}`);
  if (!(i.state === 'connected' && i.remotes === 3)) stable = false;
}
note(stable, 'staggered 4-way mesh is stable (all connected, 3 remotes each)');

console.log('\n=== B: CAP — Eve is the 5th video joiner (max 4) ===');
await eve.page.evaluate(([g, k]) => window.__ringTest.startGroup(g, k), [gid, KIND]);
const eveFull = await waitNotice(eve, /full/i, 6000);
const eveSnap = await snap(eve);
console.log(`[Eve] state=${eveSnap.state} remotes=${eveSnap.remotes} sawFullNotice=${eveFull.hit} notices=${eveFull.seen.join(' | ') || '(none)'}`);
note(eveSnap.state === 'idle', 'Eve is refused (idle, not connected)', eveSnap.state);
note(eveFull.hit, 'Eve sees a "call full" notice');
let unaffected = true;
for (const c of four) { const i = await snap(c); if (i.remotes !== 3 || i.state !== 'connected') unaffected = false; }
note(unaffected, "the original four are undisturbed by Eve's refusal");

console.log('\n=== C: LEAVE — Carol hangs up; peers should be told by name ===');
await carol.page.evaluate(() => window.__ringTest.hangup());
for (const c of [alice, bob, dave]) {
  const left = await waitNotice(c, /carol.*left|left the call/i, 6000);
  const i = await snap(c);
  console.log(`[${c.label}] remotes=${i.remotes} sawLeftNotice=${left.hit} notices=${left.seen.join(' | ') || '(none)'}`);
  note(left.hit, `${c.label} got a "Carol left the call" notice`);
  note(i.remotes === 2, `${c.label} now sees 2 remotes`, `got ${i.remotes}`);
}

console.log('\n=== D: BUSY — idle Carol calls Alice (in the call) 1:1 ===');
await carol.page.evaluate((p) => window.__ringTest.startCall(p, 'audio'), alice.id);
const carolBusy = await waitNotice(carol, /busy|unavailable|in a call/i, 6000);
const aliceDuring = await snap(alice);
console.log(`[Carol] sawBusy=${carolBusy.hit} notices=${carolBusy.seen.join(' | ') || '(none)'} | [Alice] state=${aliceDuring.state}`);
note(aliceDuring.state === 'connected', 'Alice stays in her group call (auto-busy, not rung)', aliceDuring.state);
note(carolBusy.hit, 'Carol is told Alice is busy/unavailable');

console.log('\n=================== ISSUES ===================');
if (!issues.length) console.log('  none 🎉');
else issues.forEach((x, n) => console.log(`  ${n + 1}. ${x}`));
console.log('==============================================\n');

await sweep(all);
await done();
