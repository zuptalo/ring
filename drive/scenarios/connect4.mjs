// Connect Four showcase (spec 0010): the two-game picker era begins. A 1:1
// Fruits game mid-drop, the classic discs, and a group observer view.
import { createAccount, pair, group, poll, shot, sweep, done } from '../driver.mjs';
const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
const carol = await createAccount({ name: 'Carol' });
await pair(alice, bob); await pair(alice, carol);
const chatA = await alice.page.evaluate((id) => window.__ringTest.chatWith(id), bob.id);
const chatB = await bob.page.evaluate((id) => window.__ringTest.chatWith(id), alice.id);
const mid = await alice.page.evaluate((a) => window.__ringTest.sendGame(a.c, 'connect4', a.t), { c: chatA, t: 'fruits' });
await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), g => !!g, { label: 'bubble at bob' });
const A = (col) => alice.page.evaluate((a) => window.__ringTest.playGameMove(a.c, a.m, { col: a.col }), { c: chatA, m: mid, col });
const B = (col) => bob.page.evaluate((a) => window.__ringTest.playGameMove(a.c, a.m, { col: a.col }), { c: chatB, m: mid, col });
await A(3); await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), g => g?.moves === 1, { label: 'm1' });
await B(3); await poll(() => alice.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), g => g?.moves === 2, { label: 'm2' });
await A(2); await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), g => g?.moves === 3, { label: 'm3' });
await B(4); await poll(() => alice.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), g => g?.moves === 4, { label: 'm4' });
await shot(bob, 'c4-1-fruits-midgame', { route: `/chat/${chatB}` });

// Group: classic theme, Carol observing.
const gid = await group(alice, 'C4 Arena', [bob, carol]);
await poll(() => carol.page.evaluate((id) => window.__ringTest.groupChats().then(gs => gs.some(g => g.id === id)), gid), v => v, { label: 'group' });
const cmid = await alice.page.evaluate((id) => window.__ringTest.sendGameChallenge(id, 'connect4', 'classic'), gid);
await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), cmid), g => !!g, { label: 'challenge' });
await bob.page.evaluate((m) => window.__ringTest.acceptGameChallenge(m), cmid);
await poll(() => alice.page.evaluate((m) => window.__ringTest.gameInfo(m), cmid), g => g?.opponent === bob.id, { label: 'seat' });
const GA = (col) => alice.page.evaluate((a) => window.__ringTest.playGameMove(a.g, a.m, { col: a.col }), { g: gid, m: cmid, col });
const GB = (col) => bob.page.evaluate((a) => window.__ringTest.playGameMove(a.g, a.m, { col: a.col }), { g: gid, m: cmid, col });
await GA(3); await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), cmid), g => g?.moves === 1, { label: 'g1' });
await GB(2); await poll(() => carol.page.evaluate((m) => window.__ringTest.gameInfo(m), cmid), g => g?.moves === 2, { label: 'g2' });
await GA(4); await poll(() => carol.page.evaluate((m) => window.__ringTest.gameInfo(m), cmid), g => g?.moves === 3, { label: 'g3' });
await shot(carol, 'c4-2-classic-observer', { route: `/chat/${gid}` });
await sweep([alice, bob, carol]); await done();
