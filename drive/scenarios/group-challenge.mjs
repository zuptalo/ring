// Group game challenge (spec 0009 US1/US2): Alice challenges the Arena group,
// Bob takes the seat, Carol observes read-only. Screenshots: the animated
// announcement (creator + acceptor views), the observer board mid-game.
import { createAccount, pair, group, poll, shot, sweep, done } from '../driver.mjs';
const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
const carol = await createAccount({ name: 'Carol' });
await pair(alice, bob);
await pair(alice, carol);
const gid = await group(alice, 'Arena', [bob, carol]);
await poll(() => bob.page.evaluate((id) => window.__ringTest.groupChats().then(gs => gs.some(g => g.id === id)), gid), (v) => v, { label: 'group at Bob' });
await poll(() => carol.page.evaluate((id) => window.__ringTest.groupChats().then(gs => gs.some(g => g.id === id)), gid), (v) => v, { label: 'group at Carol' });

// Alice throws a Fire & Ice challenge.
const mid = await alice.page.evaluate((id) => window.__ringTest.sendGameChallenge(id, 'tictactoe', 'fire-ice'), gid);
await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => !!g, { label: 'challenge at Bob' });
await shot(alice, 'gc-1-alice-open-creator', { route: `/chat/${gid}` });
await shot(bob, 'gc-2-bob-open-accept', { route: `/chat/${gid}` });

// Bob takes the seat; Alice opens play; Carol observes.
await bob.page.evaluate((m) => window.__ringTest.acceptGameChallenge(m), mid);
await poll(() => alice.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => g?.opponent === bob.id, { label: 'seat at Alice' });
await alice.page.evaluate((a) => window.__ringTest.playGameMove(a.gid, a.mid, { cell: 4 }), { gid, mid });
await poll(() => carol.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => g?.moves === 1, { label: 'move at Carol' });
await bob.page.evaluate((a) => window.__ringTest.playGameMove(a.gid, a.mid, { cell: 0 }), { gid, mid });
await poll(() => carol.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => g?.moves === 2, { label: 'move2 at Carol' });
await shot(carol, 'gc-3-carol-observer-board', { route: `/chat/${gid}` });
await shot(bob, 'gc-4-bob-playing', { route: `/chat/${gid}` });

await sweep([alice, bob, carol]);
await done();
