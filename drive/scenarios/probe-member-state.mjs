/**
 * Verify the server-authoritative member ring-state (#2): when an invitee times out, EVERY
 * participant's tile flips to "not joining" together (server 'noanswer' broadcast), not each
 * on its own local timer; and when a NON-initiator recalls, everyone clears together
 * ('ringing' broadcast). ~60s run (the real ring window).
 */
import { createAccount, pair, group, done, sweep, poll } from '../driver.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nj = (c) => c.page.evaluate((m) => window.__ringTest.notJoiningIds().includes(m), null);
const njOf = (c, m) => c.page.evaluate((id) => window.__ringTest.notJoiningIds().includes(id), m);

const A = await createAccount({ name: 'A', label: 'A(init)' });
const B = await createAccount({ name: 'B', label: 'B' });
const C = await createAccount({ name: 'C', label: 'C' });
const M = await createAccount({ name: 'M', label: 'M' });
const all = [A, B, C, M];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) await pair(all[i], all[j]);
const gid = await group(A, 'Squad', [B, C, M]);

console.log('\n=== A rings B,C,M; B&C join; M no-shows ===');
await A.page.evaluate(([g, mem]) => window.__ringTest.startGroup(g, 'video', mem), [gid, [B.id, C.id, M.id]]);
for (const c of [B, C]) {
  await poll(() => c.page.evaluate(() => window.__ringTest.callState()), (s) => s === 'incoming', { timeout: 20_000, label: `${c.label} rings` });
  await c.page.evaluate(() => window.__ringTest.accept());
}
await wait(3000);

console.log('=== waiting for the server no-answer broadcast (≈50s)… measuring per-client flip time ===');
const t0 = Date.now();
const flipAt = {};
await poll(
  async () => {
    for (const c of [A, B, C]) if (flipAt[c.label] == null && (await njOf(c, M.id))) flipAt[c.label] = Math.round((Date.now() - t0) / 1000);
    return [A, B, C].every((c) => flipAt[c.label] != null);
  },
  (v) => v === true,
  { timeout: 75_000, every: 500, label: 'all three flip M→not-joining' },
);
console.log(`  flip times (s from M-timeout start): ${JSON.stringify(flipAt)}`);
const spread = Math.max(...Object.values(flipAt)) - Math.min(...Object.values(flipAt));
console.log(`  ${spread <= 3 ? '✓' : '✗'} all participants flipped within ${spread}s of each other (server-authoritative → should be ~simultaneous)`);

console.log('\n=== C (non-initiator) recalls M → everyone clears together ===');
await C.page.evaluate((m) => window.__ringTest.recall(m), M.id);
let cleared = true;
await wait(2000);
for (const c of [A, B, C]) {
  const still = await njOf(c, M.id);
  if (still) cleared = false;
  console.log(`  [${c.label}] M still not-joining? ${still}`);
}
console.log(`  ${cleared ? '✓ everyone cleared M (ringing again) together' : '✗ some still show M as not-joining'}`);

await sweep(all);
await done();
