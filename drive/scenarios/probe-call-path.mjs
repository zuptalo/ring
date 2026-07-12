// Probe (spec 1043): which ICE path a 1:1 call actually selects.
// Two same-machine users should connect DIRECT (host↔host) now that the client
// gathers with iceTransportPolicy 'all'; flipping privacy.relayCalls on one side
// must force that user's leg back onto the TURN relay. RTCPeerConnection is
// wrapped before app load so the scenario can read getStats() — the app itself
// deliberately exposes no candidate detail (data minimization).
import { newClient, pair, poll, sweep, done } from '../driver.mjs';

const hook = (c, expr) => c.page.evaluate(expr);

// createAccount, but with the PC-capture init script installed pre-navigation.
async function accountWithPcCapture(name, label) {
  const c = await newClient({ label });
  await c.ctx.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = class extends Native {
      constructor(...args) {
        super(...args);
        window.__pcs.push(this);
      }
    };
  });
  await c.page.goto('/');
  await c.page.waitForFunction(() => !!window.__ringTest, null, { timeout: 30_000 });
  await c.page.evaluate(async (nm) => {
    const t = window.__ringTest;
    const code = await t.freshCode();
    await t.register(code);
    await t.createAuto();
    if (nm) await t.setProfile(nm, 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>');
  }, name);
  await poll(() => c.page.evaluate(() => window.__ringTest.isUnlocked()), (v) => v === true, { label: `${label} unlocked` });
  c.id = await c.page.evaluate(() => window.__ringTest.selfId());
  console.log(`[${label}] registered ${c.id}`);
  return c;
}

async function waitState(c, states, timeout = 40_000) {
  await poll(
    () => hook(c, () => window.__ringTest.callState()),
    (s) => states.includes(s),
    { timeout, label: `state ${states}` },
  );
}

// The selected candidate pair of the newest PC: {policy, local, remote} types.
const selectedPair = (c) =>
  c.page.evaluate(async () => {
    const pc = window.__pcs.at(-1);
    if (!pc) return null;
    const stats = await pc.getStats();
    let pair = null;
    stats.forEach((s) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
    });
    if (!pair) stats.forEach((s) => {
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) pair = s;
    });
    if (!pair) return { policy: pc.getConfiguration().iceTransportPolicy, local: null, remote: null };
    return {
      policy: pc.getConfiguration().iceTransportPolicy,
      local: stats.get(pair.localCandidateId)?.candidateType ?? null,
      remote: stats.get(pair.remoteCandidateId)?.candidateType ?? null,
    };
  });

async function call(a, b) {
  await a.page.evaluate((peer) => window.__ringTest.startCall(peer, 'audio'), b.id);
  await waitState(b, ['incoming']);
  await hook(b, () => window.__ringTest.accept());
  await waitState(a, ['connected']);
  await waitState(b, ['connected']);
  // Give ICE a beat to settle on its final pair before reading stats.
  await new Promise((r) => setTimeout(r, 2000));
}
async function hangup(a, b) {
  await hook(a, () => window.__ringTest.hangup());
  await waitState(a, ['idle'], 15_000);
  await waitState(b, ['idle'], 15_000);
}

const a = await accountWithPcCapture('PathA', 'A');
const b = await accountWithPcCapture('PathB', 'B');
await pair(a, b);

// --- default: direct expected (host/prflx on both sides) ---
await call(a, b);
const dA = await selectedPair(a);
const dB = await selectedPair(b);
console.log(`[default] A policy=${dA.policy} pair=${dA.local}↔${dA.remote}`);
console.log(`[default] B policy=${dB.policy} pair=${dB.local}↔${dB.remote}`);
await hangup(a, b);
const direct = (p) => p.policy === 'all' && ['host', 'prflx'].includes(p.local ?? '');
if (!direct(dA) || !direct(dB)) throw new Error('expected DIRECT (host/prflx) pair with policy "all" on both sides');

// --- privacy.relayCalls on A: relay expected on A's side ---
await hook(a, () => window.__ringTest.setSetting('privacy.relayCalls', true));
await call(a, b);
const rA = await selectedPair(a);
const rB = await selectedPair(b);
console.log(`[relayCalls] A policy=${rA.policy} pair=${rA.local}↔${rA.remote}`);
console.log(`[relayCalls] B policy=${rB.policy} pair=${rB.local}↔${rB.remote}`);
await hangup(a, b);
if (rA.policy !== 'relay' || rA.local !== 'relay') throw new Error('expected A relay-only (policy "relay", local relay candidate)');
if (rB.remote !== 'relay') throw new Error("expected B's selected remote candidate to be A's relay");

console.log('PROBE PASS: direct by default, relay when privacy.relayCalls is on');
await sweep([a, b]);
await done();
