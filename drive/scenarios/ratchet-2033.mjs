/**
 * Spec 2033 live repro: in a group where B and C are NOT paired, C's second
 * consecutive frame to B (a reaction after "carol here") historically failed
 * to decrypt on B. Runs against the live dev stack so messaging.ts console
 * instrumentation streams straight to stdout.
 *
 *   node drive/scenarios/ratchet-2033.mjs
 */
import { createAccount, pair, group, say, waitForMessage, messageId, react, poll, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Alice' });
const b = await createAccount({ name: 'Bob' });
const c = await createAccount({ name: 'Carol' });
await pair(a, b);
await pair(a, c);

const gid = await group(a, 'Ratchet crew', [b, c]);

await say(a, gid, 'hello crew', { isGroup: true });
await waitForMessage(b, gid, 'hello crew', { isGroup: true });
await waitForMessage(c, gid, 'hello crew', { isGroup: true });

// B speaks first: B initiates X3DH B→C (serialized, no both-initiate fork).
await say(b, gid, 'bob here', { isGroup: true });
await waitForMessage(a, gid, 'bob here', { isGroup: true });
await waitForMessage(c, gid, 'bob here', { isGroup: true });

// C's responder-side first send — historically fine everywhere.
await say(c, gid, 'carol here', { isGroup: true });
await waitForMessage(a, gid, 'carol here', { isGroup: true });
await waitForMessage(b, gid, 'carol here', { isGroup: true });

// C's SECOND consecutive frame: react to Alice's message. The bug: B never
// converges (decrypt failure logged on B's console).
const mid = await messageId(c, gid, 'hello crew');
await react(c, mid, '🔥');

const bSees = async () => {
  const bMid = await messageId(b, gid, 'hello crew');
  const ms = await b.page.evaluate((id) => window.__ringTest.messages(id), gid);
  const m = ms.find((x) => x.id === bMid);
  return (m?.reactions ?? []).some((r) => r.emoji === '🔥');
};
try {
  await poll(bSees, (v) => v === true, { timeout: 25_000, label: 'B sees the 🔥 reaction' });
  console.log('[2033] PASS — B converged; bug did not reproduce');
} catch {
  console.log('[2033] REPRODUCED — B never saw the reaction');
}

// A must have converged either way (control).
const aSees = async () => {
  const aMid = await messageId(a, gid, 'hello crew');
  const ms = await a.page.evaluate((id) => window.__ringTest.messages(id), gid);
  return (ms.find((x) => x.id === aMid)?.reactions ?? []).some((r) => r.emoji === '🔥');
};
await poll(aSees, (v) => v === true, { timeout: 25_000, label: 'A sees the 🔥 reaction' });
console.log('[2033] control: A converged');

await sweep([a, b, c]);
await done();
