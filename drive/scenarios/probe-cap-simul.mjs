/**
 * Does the participant cap hold when the room fills via a SIMULTANEOUS join (the case that
 * looked broken before)? Four join in the same tick; once healthy, Eve (5th video) joins.
 * Expect: Eve refused ("call full"), the four undisturbed. Two rounds. Also probes the
 * harder race: Eve joining IN THE SAME TICK as the 4th, so the room is racing past the cap.
 */
import { createAccount, pair, group, done, sweep, poll } from '../driver.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (c) => c.page.evaluate(() => ({ state: window.__ringTest.callState(), remotes: window.__ringTest.remoteStreamCount() }));
const noticeHas = async (c, re, timeout = 6000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const ns = await c.page.evaluate(() => window.__ringTest.notices().map((n) => n.name));
    if (ns.some((n) => re.test(n))) return true;
    await wait(200);
  }
  return false;
};

const [alice, bob, carol, dave, eve] = await Promise.all(
  ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'].map((name) => createAccount({ name, label: name })),
);
const all = [alice, bob, carol, dave, eve];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) await pair(all[i], all[j]);
const four = [alice, bob, carol, dave];
const gid = await group(alice, 'Squad', [bob, carol, dave]);
const issues = [];

// ---- Round 1: fill staggered-ish, then Eve after the room is settled ----
console.log('\n=== ROUND 1: four join (same tick), settle, THEN Eve (5th) ===');
await Promise.all(four.map((c) => c.page.evaluate(([g]) => window.__ringTest.startGroup(g, 'video'), [gid])));
for (const c of four) await poll(() => st(c).then((i) => i.remotes), (r) => r >= 3, { timeout: 25_000, label: `${c.label} 3 remotes` }).catch(() => {});
await wait(4000);
await eve.page.evaluate(([g]) => window.__ringTest.startGroup(g, 'video'), [gid]);
const eveFull = await noticeHas(eve, /full/i);
await wait(1500);
const eveS = await st(eve);
console.log(`  [Eve] state=${eveS.state} remotes=${eveS.remotes} sawFull=${eveFull}`);
if (!(eveS.remotes === 0 && eveFull)) issues.push(`R1 cap: Eve not cleanly refused (remotes=${eveS.remotes} sawFull=${eveFull})`);
for (const c of four) { const i = await st(c); if (i.remotes !== 3) issues.push(`R1 ${c.label} disturbed: remotes=${i.remotes}`); }
await Promise.all(all.map((c) => c.page.evaluate(() => window.__ringTest.hangup()).catch(() => {})));
await wait(2500);

// ---- Round 2: the RACE — all FIVE join in the SAME tick (4 slots, 5 racers) ----
console.log('\n=== ROUND 2: all FIVE join in the same tick (cap must admit exactly 4) ===');
await Promise.all(all.map((c) => c.page.evaluate(([g]) => window.__ringTest.startGroup(g, 'video'), [gid])));
await wait(9000);
let connected = 0;
let refusedSawFull = 0;
for (const c of all) {
  const i = await st(c);
  const sawFull = (await c.page.evaluate(() => window.__ringTest.notices().map((n) => n.name))).some((n) => /full/i.test(n));
  if (i.state === 'connected') connected++;
  if (i.state !== 'connected' && sawFull) refusedSawFull++;
  console.log(`  [${c.label}] state=${i.state} remotes=${i.remotes} sawFull=${sawFull}`);
}
console.log(`  connected=${connected} (must be ≤4), refused-with-full=${refusedSawFull}`);
if (connected > 4) issues.push(`R2 cap RACE: ${connected} connected — cap exceeded!`);
if (connected === 5) issues.push('R2 cap RACE: all five admitted — cap not enforced under same-tick join');
await Promise.all(all.map((c) => c.page.evaluate(() => window.__ringTest.hangup()).catch(() => {})));

console.log('\n=================== ISSUES ===================');
if (!issues.length) console.log('  none 🎉 — cap holds under simultaneous join');
else issues.forEach((x, n) => console.log(`  ${n + 1}. ${x}`));

await sweep(all);
await done();
