/**
 * Verify the leave UX: when someone leaves a group call there is NO toast; instead their
 * original tile shows their avatar + a waving hand for ~5s, then fades and the grid reflows.
 */
import { createAccount, pair, group, shot, done, sweep, poll } from '../driver.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// A recognizable avatar for Carol so we can prove the leaving tile shows HER avatar (a 1x1 red png).
const RED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const A = await createAccount({ name: 'Alice', label: 'Alice' });
const B = await createAccount({ name: 'Bob', label: 'Bob' });
const C = await createAccount({ name: 'Carol', label: 'Carol' });
await C.page.evaluate((a) => window.__ringTest.setProfile('Carol', a), RED); // so A learns Carol's avatar on pair
const all = [A, B, C];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) await pair(all[i], all[j]);
const gid = await group(A, 'Squad', [B, C]);

console.log('\n=== all three join the video call ===');
for (const c of all) await c.page.evaluate(([g]) => window.__ringTest.startGroup(g, 'video'), [gid]);
for (const c of all) await poll(() => c.page.evaluate(() => window.__ringTest.remoteStreamCount()), (r) => r >= 2, { timeout: 25_000, label: `${c.label} sees 2` }).catch(() => {});
await wait(4000);

const tilesOf = (c) => c.page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.float-tile')];
  return tiles.map((t) => ({
    leaving: t.classList.contains('leaving'),
    wave: !!t.querySelector('.leave-wave'),
    avatarSrc: t.querySelector('.tile-avatar')?.getAttribute('src') ?? null,
    label: t.querySelector('.tile-label')?.textContent ?? null,
  }));
});

console.log('--- before leave: Alice tiles ---');
console.log('  ' + JSON.stringify(await tilesOf(A)));

console.log('\n=== Carol hangs up; watch Alice ===');
await C.page.evaluate(() => window.__ringTest.hangup());
await wait(1500); // inside the 5s wave window
const aMid = await tilesOf(A);
const leaveTile = aMid.find((t) => t.leaving);
const notices = await A.page.evaluate(() => window.__ringTest.notices().map((n) => n.name));
console.log('  Alice tiles mid-wave: ' + JSON.stringify(aMid));
console.log(`  ✓/✗ leaving tile present: ${!!leaveTile}`);
console.log(`  ✓/✗ leaving tile has wave: ${!!leaveTile?.wave}`);
console.log(`  ✓/✗ leaving tile shows Carol's avatar (red png): ${leaveTile?.avatarSrc === RED}`);
console.log(`  ✓/✗ leaving tile labelled "Carol": ${leaveTile?.label === 'Carol'}`);
console.log(`  ✓/✗ NO "left the call" toast: ${!notices.some((n) => /left the call/i.test(n))} (notices=${JSON.stringify(notices)})`);
await shot(A, 'leave-wave-mid'); // eyeball: avatar + waving hand, no toast

console.log('\n=== after the wave (~6s): grid should reflow to 2 tiles, no leaving placeholder ===');
await wait(5000);
const aAfter = await tilesOf(A);
console.log('  Alice tiles after: ' + JSON.stringify(aAfter));
console.log(`  ✓/✗ leaving placeholder gone: ${!aAfter.some((t) => t.leaving)}`);
console.log(`  ✓/✗ reflowed to 2 tiles (Alice + Bob): ${aAfter.length === 2}`);
await shot(A, 'leave-wave-after');

await sweep(all);
await done();
