/**
 * Confirm the group-video publish finding with the smallest possible mesh (2 people),
 * comparing a group VIDEO call vs a group AUDIO call. 1:1 video already proved the env
 * captures video (localTracks=2). So:
 *   group video local=2  → video published (4-way local=1 was something else)
 *   group video local=1  → group video NOT published (real bug); audio call also =1
 */
import { createAccount, pair, group, done, sweep, poll } from '../driver.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = (c) =>
  c.page.evaluate(() => ({ state: window.__ringTest.callState(), local: window.__ringTest.localTracks(), remotes: window.__ringTest.remoteStreamCount() }));

async function run(kind) {
  const a = await createAccount({ name: `A_${kind}`, label: `A/${kind}` });
  const b = await createAccount({ name: `B_${kind}`, label: `B/${kind}` });
  await pair(a, b);
  const gid = await group(a, `G_${kind}`, [b]);
  await a.page.evaluate(([g, k]) => window.__ringTest.startGroup(g, k), [gid, kind]);
  await b.page.evaluate(([g, k]) => window.__ringTest.startGroup(g, k), [gid, kind]);
  await poll(() => a.page.evaluate(() => window.__ringTest.remoteStreamCount()), (r) => r >= 1, { label: `${kind}: A sees B`, timeout: 30000 }).catch(() => {});
  await wait(5000);
  const ia = await snap(a);
  const ib = await snap(b);
  console.log(`[group ${kind}] A: state=${ia.state} local=${ia.local} remotes=${ia.remotes} | B: state=${ib.state} local=${ib.local} remotes=${ib.remotes}`);
  await sweep([a, b]);
  return ia.local;
}

console.log('\n=== group VIDEO (2 people) ===');
const v = await run('video');
console.log('\n=== group AUDIO (2 people) ===');
const au = await run('audio');

console.log(`\nRESULT: group video localTracks=${v} (expect 2 if video published), group audio localTracks=${au} (expect 1).`);
console.log(v >= 2 ? '⇒ group video DOES publish video.' : '⇒ group video does NOT publish video — REAL BUG.');

await done();
