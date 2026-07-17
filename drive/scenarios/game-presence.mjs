// In-game presence smoke test: two players open the same chess game and each
// should see the other marked "in the game"; when one leaves the board, the
// other flips to "away" (via the explicit stopped signal, or the ~6s expiry).
import { createAccount, pair, poll, shot, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
await pair(alice, bob);

const aChat = await alice.page.evaluate((id) => window.__ringTest.chatWith(id), bob.id);
const bChat = await bob.page.evaluate((id) => window.__ringTest.chatWith(id), alice.id);
const mid = await alice.page.evaluate((c) => window.__ringTest.sendGame(c, 'chess'), aChat);
await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => !!g, { label: 'card at bob' });

const openBoard = async (c, chat) => {
  await c.page.goto(`http://localhost:5173/chat/${chat}`);
  await c.page.waitForTimeout(600);
  await c.page.locator('.gcc-btn').click();
  await c.page.locator('.ch-board').waitFor({ state: 'visible', timeout: 8000 });
};
// Read the opponent presence line on this player's board.
const presence = (c) => c.page.locator('.ch-presence-text').first().textContent().then((t) => (t || '').trim());
const waitPresence = (c, want, label) => poll(() => presence(c), (t) => t === want, { label, timeoutMs: 15000 });

// Bob opens first — Alice isn't here yet, so Bob should see Alice "away".
await openBoard(bob, bChat);
await waitPresence(bob, 'away', 'bob sees alice away (alice not in yet)');

// Alice opens — now BOTH are at the board.
await openBoard(alice, aChat);
await waitPresence(alice, 'in the game', 'alice sees bob in the game');
await waitPresence(bob, 'in the game', 'bob sees alice in the game (heartbeat)');
await shot(alice, 'presence-1-both-in');
await shot(bob, 'presence-2-both-in-mobile');

// Keepalive holds it: wait past one expiry window, still "in the game".
await alice.page.waitForTimeout(7000);
await waitPresence(alice, 'in the game', 'alice still sees bob in the game after keepalive');

// Bob leaves the board (overlay exit) → Alice should flip to "away".
await bob.page.locator('.go-exit').click();
await waitPresence(alice, 'away', 'alice sees bob away after he leaves');
await shot(alice, 'presence-3-bob-left');

await sweep([alice, bob]);
await done();
