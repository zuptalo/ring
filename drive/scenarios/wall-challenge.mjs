// Wall game challenge (spec 0009 US3): a challenge post plays out ON the post.
// Screenshots: the open challenge on a phone, the author playing, the observer
// with the Follow button.
import { createAccount, pair, poll, shot, sweep, done } from '../driver.mjs';
const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
const carol = await createAccount({ name: 'Carol' });
await pair(alice, bob); await pair(alice, carol);
const pid = await alice.page.evaluate(() => window.__ringTest.post({ game: { gameType: 'tictactoe', theme: 'mythic' } }));
await poll(() => bob.page.evaluate(async (id) => { await window.__ringTest.syncPosts(); return window.__ringTest.wallGameInfo(id); }, pid), g => !!g, { label: 'challenge at bob' });
await shot(bob, 'wg-1-bob-open-challenge', { route: '/tabs/wall' });
await bob.page.evaluate((id) => window.__ringTest.acceptWallChallenge(id), pid);
await poll(() => alice.page.evaluate(async (id) => { await window.__ringTest.syncEngagement(id); return window.__ringTest.wallGameInfo(id); }, pid), g => g?.opponent === bob.id, { label: 'seat at alice' });
await alice.page.evaluate((id) => window.__ringTest.playWallGameMove(id, { cell: 4 }), pid);
await bob.page.evaluate(async (id) => { await window.__ringTest.syncEngagement(id); await window.__ringTest.playWallGameMove(id, { cell: 0 }); }, pid);
await poll(() => carol.page.evaluate(async (id) => { await window.__ringTest.syncPosts(); await window.__ringTest.syncEngagement(id); return window.__ringTest.wallGameInfo(id); }, pid), g => g?.moves === 2, { label: 'moves at carol' });
await shot(alice, 'wg-2-alice-playing', { route: '/tabs/wall' });
await shot(carol, 'wg-3-carol-observer', { route: '/tabs/wall' });
await sweep([alice, bob, carol]); await done();
