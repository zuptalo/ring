// Battleship showcase (spec 0011): shuffle-and-ready placement through the
// real buttons, then the two-seas battle view with 💦💥🔥 results.
import { createAccount, pair, poll, shot, sweep, done } from '../driver.mjs';
const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
await pair(alice, bob);
const aChat = await alice.page.evaluate((id) => window.__ringTest.chatWith(id), bob.id);
const bChat = await bob.page.evaluate((id) => window.__ringTest.chatWith(id), alice.id);
const mid = await alice.page.evaluate((c) => window.__ringTest.sendGame(c, 'battleship', 'sea-monsters'), aChat);
await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), g => !!g, { label: 'bubble at bob' });

// Bob's placing view (mobile) with Shuffle/Ready.
await bob.page.goto(`http://localhost:5173/chat/${bChat}`);
await bob.page.waitForTimeout(1200);
await shot(bob, 'bs-1-placing');

// Both lock fleets through the REAL buttons.
await alice.page.goto(`http://localhost:5173/chat/${aChat}`);
await alice.page.waitForTimeout(1200);
await alice.page.getByRole('button', { name: /Ready/ }).click();
await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), g => g?.moves === 1, { label: 'a committed' });
await bob.page.getByRole('button', { name: /Ready/ }).click();
await poll(() => alice.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), g => g?.moves === 2, { label: 'b committed' });

// A few shots; defenders answer automatically (both chats are open).
const fire = (p, chat, cell) => p.page.evaluate((a) => window.__ringTest.playGameMove(a.c, a.m, { t: 'shot', cell: a.cell }), { c: chat, m: mid, cell });
await fire(alice, aChat, 9);
await poll(() => alice.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), g => g?.moves === 4, { label: 'answered 1' });
await fire(bob, bChat, 0);
await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), g => g?.moves === 6, { label: 'answered 2' });
await fire(alice, aChat, 27);
await poll(() => alice.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), g => g?.moves === 8, { label: 'answered 3' });
await bob.page.waitForTimeout(600);
await shot(bob, 'bs-2-battle-mobile');
await shot(alice, 'bs-3-battle-desktop');
await sweep([alice, bob]); await done();
