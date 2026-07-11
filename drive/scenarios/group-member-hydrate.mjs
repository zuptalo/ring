// Repro + verify: a group member added via the accept-first invite flow, whom
// nobody in the group personally knows, must still resolve to a real name/photo
// from the directory instead of rendering as a raw id-slice ("88155153").
//
//   Alice creates a group with Bob (paired). Alice then INVITES Carol — a real
//   registered account with a published profile — whom neither Alice nor Bob has
//   as a contact. Carol accepts. Before the directory-hydrate fix, Carol rode in
//   as her raw id on both devices (accept branch adds her to participantIds with
//   no contact; the roster card carries only her raw id-slice name). After the
//   fix, handleGroupCard + the accept branch pull her profile from the directory.
//
// Run against the live `make start` stack:  node drive/scenarios/group-member-hydrate.mjs
import { createAccount, pair, poll, shot, done } from '../driver.mjs';

const members = (c, gid) =>
  c.page.evaluate((g) => window.__ringTest.groupChats().then((gs) => gs.find((x) => x.id === g)?.members ?? []), gid);
const nameOf = (c, id) => c.page.evaluate((i) => window.__ringTest.contactName(i), id);

const A = await createAccount({ name: 'Alice' });
const B = await createAccount({ name: 'Bob' });
const C = await createAccount({ name: 'Carol' });

// Only Alice↔Bob are paired. Nobody pairs with Carol → she is unknown to the group.
await pair(A, B);

// Alice creates the group with Bob, then invites Carol (accept-first: Alice has no
// contact for Carol, so addMemberToGroup would route to inviteToGroup anyway).
const gid = await A.page.evaluate(([n, m]) => window.__ringTest.createGroup(n, m), ['Trip', [B.id]]);
await poll(() => members(B, gid), (m) => m.includes(B.id) || true, { label: 'Bob has the group' });
await A.page.evaluate(([g, id]) => window.__ringTest.inviteToGroup(g, id), [gid, C.id]);

// Carol sees the invite and accepts.
await poll(() => C.page.evaluate((g) => window.__ringTest.groupInviteIds().then((ids) => ids.includes(g)), gid), Boolean, {
  label: 'Carol sees the group invite',
});
await C.page.evaluate((g) => window.__ringTest.acceptGroupInvite(g), gid);

// Carol becomes a member on both devices.
await poll(() => members(A, gid), (m) => m.includes(C.id), { label: 'Alice sees Carol as member' });
await poll(() => members(B, gid), (m) => m.includes(C.id), { label: 'Bob sees Carol as member' });

// The fix: Carol resolves to her real name (from the directory), NOT her raw id.
const raw = C.id.slice(0, 8);
await poll(() => nameOf(A, C.id), (n) => n === 'Carol', { label: 'Alice resolves Carol → name', timeout: 15_000 });
await poll(() => nameOf(B, C.id), (n) => n === 'Carol', { label: 'Bob resolves Carol → name', timeout: 15_000 });

const [onA, onB] = [await nameOf(A, C.id), await nameOf(B, C.id)];
console.log(`\n  Carol.id.slice(0,8) = "${raw}"`);
console.log(`  name on Alice = "${onA}"   name on Bob = "${onB}"`);
if (onA === raw || onB === raw) throw new Error('REGRESSION: Carol still shows as a raw id');
console.log('  ✅ member resolved to a real name on both devices (not a raw id)\n');

await shot(A, 'group-member-hydrate-alice', { route: `/group/${gid}` });
await done();
