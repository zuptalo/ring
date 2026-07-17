/**
 * Spec 1030, US5 — harder multi-party churn on the live stack: a 3-way audio
 * call grows and shrinks under pressure and must converge everywhere.
 *
 *   1. Alice+Bob+Carol in a group audio call.
 *   2. Alice AND Bob add Dave simultaneously → ONE participant, one leg.
 *   3. Eve is added WHILE Carol hangs up (join races leave).
 *   4. Bob's socket blips ~3s and recovers → rejoins, and NOBODY re-announces
 *      him ("joined the call" fires at most once per member per call).
 *   5. Final roster {Alice,Bob,Dave,Eve} everywhere, no duplicates, no stuck tiles.
 *
 *   node drive/scenarios/call-add-churn.mjs
 *
 * Drives the live `make start` stack; screenshots land in .tmp/drive/.
 */
import { createAccount, pair, group, shot, sweep, done, poll } from '../driver.mjs';

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
      roster: meta?.roster ?? [],
      invited: meta?.invited ?? [],
      remotes: t.remoteStreamCount(),
      cues: t.joinCues(),
    };
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rosterIs = (i, ids) =>
  i.roster.length === ids.length && ids.every((id) => i.roster.includes(id)) && new Set(i.roster).size === i.roster.length;

console.log('\n=== SETUP: five accounts, all pairwise paired ===');
const alice = await createAccount({ name: 'Alice', label: 'Alice' });
const bob = await createAccount({ name: 'Bob', label: 'Bob' });
const carol = await createAccount({ name: 'Carol', label: 'Carol' });
const dave = await createAccount({ name: 'Dave', label: 'Dave' });
const eve = await createAccount({ name: 'Eve', label: 'Eve' });
const all = [alice, bob, carol, dave, eve];
for (let i = 0; i < all.length; i++)
  for (let j = i + 1; j < all.length; j++) await pair(all[i], all[j]);

console.log('\n=== A: Alice+Bob+Carol in a group AUDIO call ===');
const gid = await group(alice, 'Churn', [bob, carol]);
for (const c of [alice, bob, carol]) await act(c, 'startGroup', gid, 'audio', []);
for (const c of [alice, bob, carol]) await poll(() => info(c), (i) => i.remotes >= 2, { label: `${c.label} meshed`, timeout: 60_000 });

console.log('\n=== B: Alice AND Bob add Dave at the same instant (dedup to one leg) ===');
await Promise.all([act(alice, 'addPeople', [dave.id]), act(bob, 'addPeople', [dave.id])]);
await poll(() => info(dave), (i) => i.state === 'incoming', { label: 'Dave ringing' });
await act(dave, 'accept');
for (const c of [alice, bob, carol, dave]) {
  await poll(() => info(c), (i) => rosterIs(i, [alice.id, bob.id, carol.id, dave.id]), { label: `${c.label} roster {A,B,C,D}`, timeout: 60_000 });
}
const dupCheck = await info(alice);
note(dupCheck.roster.filter((x) => x === dave.id).length === 1, 'Dave appears exactly once', JSON.stringify(dupCheck.roster));
note((await info(dave)).remotes === 3, 'Dave has exactly one leg per peer', `remotes=${(await info(dave)).remotes}`);

console.log('\n=== C: Eve is added WHILE Carol hangs up (join races leave) ===');
await Promise.all([act(alice, 'addPeople', [eve.id]), act(carol, 'hangup')]);
await poll(() => info(eve), (i) => i.state === 'incoming', { label: 'Eve ringing' });
await act(eve, 'accept');
for (const c of [alice, bob, dave, eve]) {
  await poll(() => info(c), (i) => rosterIs(i, [alice.id, bob.id, dave.id, eve.id]), { label: `${c.label} roster {A,B,D,E}`, timeout: 60_000 });
}
await poll(() => info(carol), (i) => i.state === 'idle' || i.state === 'ended', { label: 'Carol fully out' });
note(true, 'Carol is fully out');

console.log('\n=== D: Bob blips (~3s socket drop) and recovers — no re-announce, no dup ===');
const cuesBefore = (await info(alice)).cues;
await act(bob, 'disconnect');
await wait(3000);
await act(bob, 'reconnect');
await poll(() => info(bob), (i) => i.remotes >= 3, { label: 'Bob re-meshed', timeout: 60_000 });
await wait(2000);
const cuesAfter = (await info(alice)).cues;
note(JSON.stringify(cuesAfter) === JSON.stringify(cuesBefore), 'a reconnect is NOT a new joiner (no extra cue)', `${cuesBefore} → ${cuesAfter}`);
const final = await info(alice);
note(rosterIs(final, [alice.id, bob.id, dave.id, eve.id]), 'final roster stable after the blip', JSON.stringify(final.roster));

// No route: a goto() reloads the SPA and drops the live call — capture as-is.
await shot(alice, 'add-churn-final');
for (const c of [alice, bob, dave, eve]) await act(c, 'hangup').catch(() => {});
console.log(issues.length ? `\nISSUES (${issues.length}):\n - ${issues.join('\n - ')}` : '\nAll churn checks passed.');
await sweep(all);
await done();
if (issues.length) process.exitCode = 1;
