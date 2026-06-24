/**
 * Reproduce the reported collapse: initiator A rings B, C, M; B & C join; M no-shows; a
 * participant RECALLS M; M joins late; then "the whole call drops and turns into a 1:1
 * between the caller and the last joined." We sample the 4-way health over time after M's
 * late join to catch a delayed collapse. Also exercises #3 (a NON-initiator, B, does the
 * recall — must work) and #2 (the server 'ringing' broadcast clears M's not-joining tile
 * for everyone).
 */
import { createAccount, pair, group, done, sweep, poll } from '../driver.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = async (c) => {
  const s = await c.page.evaluate(() => ({ state: window.__ringTest.callState(), remotes: window.__ringTest.remoteStreamCount(), roster: (window.__ringTest.callMeta()?.roster ?? []).length }));
  const d = await c.page.evaluate(() => window.__ringTest.groupCallDiag());
  return { ...s, frames: d.inboundVideoFrames };
};
const line = (label, i) => `  [${label}] state=${i.state} remotes=${i.remotes} roster=${i.roster} meshFrames=${i.frames}`;

const A = await createAccount({ name: 'A', label: 'A(init)' });
const B = await createAccount({ name: 'B', label: 'B' });
const C = await createAccount({ name: 'C', label: 'C' });
const M = await createAccount({ name: 'M', label: 'M(late)' });
const all = [A, B, C, M];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) await pair(all[i], all[j]);
const gid = await group(A, 'Squad', [B, C, M]);

console.log('\n=== A rings B, C, M (video). B & C answer; M does NOT ===');
await A.page.evaluate(([g, mem]) => window.__ringTest.startGroup(g, 'video', mem), [gid, [B.id, C.id, M.id]]);
for (const c of [B, C]) {
  await poll(() => c.page.evaluate(() => window.__ringTest.callState()), (s) => s === 'incoming', { timeout: 20_000, label: `${c.label} rings` });
  await c.page.evaluate(() => window.__ringTest.accept());
}
// A, B, C should converge to a 3-way (each sees 2 remotes). M is invited/ringing.
for (const c of [A, B, C]) await poll(() => c.page.evaluate(() => window.__ringTest.remoteStreamCount()), (r) => r >= 2, { timeout: 25_000, label: `${c.label} sees 2` }).catch(() => {});
await wait(3000);
console.log('--- 3-way established (M still out) ---');
for (const c of [A, B, C]) console.log(line(c.label, await snap(c)));
console.log(`  A sees M as not-joining/invited? notJoining=${JSON.stringify(await A.page.evaluate(() => window.__ringTest.notJoiningIds()))} invited=${JSON.stringify(await A.page.evaluate(() => window.__ringTest.invitedIds()))}`);

console.log('\n=== B (NOT the initiator) recalls M (#3: must work) ===');
await B.page.evaluate((m) => window.__ringTest.recall(m), M.id);
await poll(() => M.page.evaluate(() => window.__ringTest.callState()), (s) => s === 'incoming', { timeout: 20_000, label: 'M re-rings' });
console.log('  M got the recall ring ✓');
await M.page.evaluate(() => window.__ringTest.accept());

console.log('\n=== M joins late — watch for a delayed collapse to 1:1 ===');
for (const c of all) await poll(() => c.page.evaluate(() => window.__ringTest.remoteStreamCount()), (r) => r >= 3, { timeout: 25_000, label: `${c.label} sees 3` }).catch(() => {});
let elapsed = 0;
for (const t of [3, 8, 15, 22]) {
  await wait((t - elapsed) * 1000);
  elapsed = t;
  console.log(`\n--- +${t}s after M joined ---`);
  let healthy = true;
  for (const c of all) {
    const i = await snap(c);
    if (!(i.state === 'connected' && i.remotes === 3)) healthy = false;
    console.log(line(c.label, i));
  }
  console.log(`  ${healthy ? '✓ healthy 4-way' : '✗ DEGRADED (collapse?)'}`);
}

await sweep(all);
await done();
