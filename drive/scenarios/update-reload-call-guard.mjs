/**
 * Verifies the fix for the broken app-update reload (fix/update-reload-breaks-ui).
 *
 * The headline symptom: accepting an update reloaded the page, which preserves the URL
 * but wipes the in-memory call state — so a reload that happened to be on /call-active
 * re-rendered the full-screen call UI with BLACK video tiles over the tabs and no live
 * call to end (a wedged screen). The fix adds an idle-guard to CallActivePage: mounting
 * /call-active with no active call bounces to /tabs/chats.
 *
 * A full page.goto('/call-active') is an exact stand-in for that post-reload cold load
 * (in-memory call state gone). A REAL call instead reaches /call-active via the SPA
 * router (useCall.navigateToCall → router.push), so its state survives — the guard must
 * NOT fire there.
 *
 *   HEADED=1 node drive/scenarios/update-reload-call-guard.mjs
 */
import { createAccount, pair, poll, shot, sweep, done, BASE_URL } from '../driver.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tail = (url) => new URL(url).pathname;

const a = await createAccount({ name: 'Ada', label: 'A' });
const b = await createAccount({ name: 'Bo', label: 'B' });
await pair(a, b);

// ── Test 1: stray cold-load onto /call-active with NO call → must bounce to chats ──
console.log('\n=== Test 1: reload lands on /call-active with no active call ===');
await a.page.goto(`${BASE_URL}/call-active`);
// Give the onMounted guard + router.replace a moment to run.
await poll(() => a.page.evaluate(() => location.pathname), (p) => p !== '/call-active', {
  label: 'redirect away from /call-active', timeout: 8000,
}).catch(() => {});
const landed = tail(a.page.url());
await shot(a, 'guard-1-stray-callactive');
const t1pass = landed === '/tabs/chats';
console.log(`[T1] landed on ${landed} — ${t1pass ? 'PASS (bounced to shell)' : 'FAIL (expected /tabs/chats)'}`);

// ── Test 2: a real live call still renders /call-active (guard must NOT fire) ──
console.log('\n=== Test 2: live call renders /call-active normally ===');
await a.page.evaluate((p) => window.__ringTest.startCall(p, 'video'), b.id);
await poll(() => b.page.evaluate(() => window.__ringTest.callState()), (s) => s === 'incoming', { label: 'B rings' });
await b.page.evaluate(() => window.__ringTest.accept());
await poll(() => a.page.evaluate(() => window.__ringTest.callState()), (s) => s === 'connected', { label: 'A connected' });
await wait(1500);
const callPath = tail(a.page.url());
const callSt = await a.page.evaluate(() => window.__ringTest.callState());
await shot(a, 'guard-2-live-call');
const t2pass = callPath === '/call-active' && callSt === 'connected';
console.log(`[T2] path=${callPath} state=${callSt} — ${t2pass ? 'PASS (live call shown)' : 'FAIL'}`);

await a.page.evaluate(() => window.__ringTest.hangup());
await wait(500);

console.log(`\n=== RESULT: ${t1pass && t2pass ? 'ALL PASS' : 'FAILURE'} ===`);

await sweep([a, b]);
await done();
