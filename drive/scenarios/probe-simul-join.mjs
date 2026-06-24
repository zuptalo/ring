/**
 * Reproduce the simultaneous-join edge in isolation, repeatedly, to separate REAL races
 * from headless artifacts. Four paired accounts all call startGroup in the SAME tick
 * (Promise.all), three rounds. We measure, per node: state, remotes, localTracks (2 =
 * audio+video published), and mesh video frames. A healthy round = all four connected,
 * remotes=3, localTracks=2, frames climbing.
 */
import { createAccount, pair, group, done, sweep, poll } from '../driver.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = async (c) => {
  const s = await c.page.evaluate(() => ({ state: window.__ringTest.callState(), remotes: window.__ringTest.remoteStreamCount(), local: window.__ringTest.localTracks() }));
  const d = await c.page.evaluate(() => window.__ringTest.groupCallDiag());
  return { ...s, frames: d.inboundVideoFrames };
};

const alice = await createAccount({ name: 'Alice', label: 'Alice' });
const bob = await createAccount({ name: 'Bob', label: 'Bob' });
const carol = await createAccount({ name: 'Carol', label: 'Carol' });
const dave = await createAccount({ name: 'Dave', label: 'Dave' });
const four = [alice, bob, carol, dave];
for (let i = 0; i < four.length; i++) for (let j = i + 1; j < four.length; j++) await pair(four[i], four[j]);
const gid = await group(alice, 'Squad', [bob, carol, dave]);

for (let round = 1; round <= 3; round++) {
  console.log(`\n=== ROUND ${round}: all four join in the SAME tick ===`);
  await Promise.all(four.map((c) => c.page.evaluate(([g]) => window.__ringTest.startGroup(g, 'video'), [gid])));
  // Give it time to converge + flow.
  for (const c of four) await poll(() => c.page.evaluate(() => window.__ringTest.remoteStreamCount()), (r) => r >= 3, { timeout: 25_000, label: `${c.label} 3 remotes` }).catch(() => {});
  await wait(7000);
  let healthy = true;
  for (const c of four) {
    const i = await snap(c);
    const ok = i.state === 'connected' && i.remotes === 3 && i.local === 2 && i.frames > 0;
    if (!ok) healthy = false;
    console.log(`  [${c.label}] state=${i.state} remotes=${i.remotes} localTracks=${i.local} meshFrames=${i.frames} ${ok ? '✓' : '✗'}`);
  }
  console.log(`  round ${round}: ${healthy ? 'HEALTHY' : 'DEGRADED'}`);
  // Everyone hangs up to reset for the next round.
  await Promise.all(four.map((c) => c.page.evaluate(() => window.__ringTest.hangup()).catch(() => {})));
  await wait(2500);
}

await sweep(four);
await done();
