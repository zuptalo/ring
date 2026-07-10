// Full Wall-Armada START: the path with ZERO test coverage (e2e stops at accept).
// Verifies that once BOTH admirals deploy on the WALL, the duty officer emits the
// rival's staged commit and the game actually LEAVES deployment into battle.
//
//   node drive/scenarios/wall-armada-duel.mjs
import { createAccount, pair, poll, sweep, done } from '../driver.mjs';

const L0 = [
  { r: 0, c: 0, len: 5, dir: 'h' }, { r: 2, c: 0, len: 4, dir: 'h' },
  { r: 4, c: 0, len: 3, dir: 'h' }, { r: 6, c: 0, len: 3, dir: 'h' },
  { r: 8, c: 0, len: 2, dir: 'h' },
];
const L1 = [
  { r: 0, c: 9, len: 5, dir: 'v' }, { r: 0, c: 7, len: 4, dir: 'v' },
  { r: 0, c: 5, len: 3, dir: 'v' }, { r: 5, c: 7, len: 3, dir: 'v' },
  { r: 8, c: 3, len: 2, dir: 'h' },
];

const commit = (p, arg) => p.page.evaluate((a) => window.__ringTest.armadaCommit(a), arg);
const info = (p, pid) => p.page.evaluate((id) => window.__ringTest.wallGameInfo(id), pid);
const syncEng = (p, pid) => p.page.evaluate((id) => window.__ringTest.syncEngagement(id), pid);
const syncPosts = (p) => p.page.evaluate(() => window.__ringTest.syncPosts());

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
await pair(alice, bob);

const pid = await alice.page.evaluate(() => window.__ringTest.post({ game: { gameType: 'armada' } }));
console.log('[post] armada wall pid=', pid);

// Bob sees + accepts.
await poll(() => bob.page.evaluate(async (id) => { await window.__ringTest.syncPosts(); return window.__ringTest.wallGameInfo(id); }, pid), (g) => !!g, { label: 'challenge at bob' });
await bob.page.evaluate((id) => window.__ringTest.acceptWallChallenge(id), pid);
await poll(() => info(alice, pid).then(() => syncEng(alice, pid)).then(() => info(alice, pid)), (g) => g?.opponent === bob.id, { label: 'bob seated at alice' });
console.log('[accepted] alice sees:', JSON.stringify(await info(alice, pid)));

// Bob (seat 1) deploys FIRST → stages device-locally (wire slot not open yet).
await syncEng(bob, pid);
await commit(bob, { postId: pid, layout: L1, salt: 'c2FsdDE' });
console.log('[bob staged] bob sees:', JSON.stringify(await info(bob, pid)));

// Alice (seat 0) deploys → seq 1 goes out. Bob's duty officer must then emit his
// staged commit (seq 2) on the WALL once Alice's commit syncs to him.
await commit(alice, { postId: pid, layout: L0, salt: 'c2FsdDA' });
console.log('[alice committed] alice sees:', JSON.stringify(await info(alice, pid)));

// Poll Bob: after syncing Alice's commit, does the duty officer emit Bob's?
let started = false;
try {
  await poll(
    () => bob.page.evaluate(async (id) => { await window.__ringTest.syncEngagement(id); return window.__ringTest.wallGameInfo(id); }, pid),
    (g) => g?.moves >= 2,
    { label: 'both fleets committed (deployment done)', timeout: 20000 },
  );
  started = true;
  console.log('[STARTED ✓] bob sees moves>=2:', JSON.stringify(await info(bob, pid)));
} catch {
  console.log('[STALL ✗] bob stuck:', JSON.stringify(await info(bob, pid)));
  console.log('[STALL ✗] alice sees:', JSON.stringify(await info(alice, pid)));
}

// If it started, make sure Alice also observes moves>=2 (battle can begin).
if (started) {
  await poll(() => syncEng(alice, pid).then(() => info(alice, pid)), (g) => g?.moves >= 2, { label: 'alice sees battle', timeout: 15000 }).catch(() => {});
  console.log('[final] alice:', JSON.stringify(await info(alice, pid)));
}

await sweep([alice, bob]);
await done();
