// Armada showcase (spec 1038): the challenge card in the chat, the fullscreen
// overlay's deploy/battle faces, a toast over the game, the floating return
// pill, and the medal ceremony. Screenshots land in .tmp/drive/ for the
// design-fidelity review against specs/1038-armada-fullscreen-naval/design/.
import { createAccount, pair, say, poll, shot, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
const cara = await createAccount({ name: 'Cara' });
await pair(alice, bob);
await pair(bob, cara);

const aChat = await alice.page.evaluate((id) => window.__ringTest.chatWith(id), bob.id);
const bChat = await bob.page.evaluate((id) => window.__ringTest.chatWith(id), alice.id);
const mid = await alice.page.evaluate((c) => window.__ringTest.sendGame(c, 'armada'), aChat);
await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => !!g, { label: 'card at bob' });

// 1 — the challenge card in Bob's chat (mobile): ARMADA glyph, subtitle, button.
await bob.page.goto(`http://localhost:5173/chat/${bChat}`);
await bob.page.waitForTimeout(1200);
await shot(bob, 'armada-1-card');

// 2 — Bob opens the overlay: the deployment face (tap/drag/rotate, roster).
await bob.page.locator('.gcc-btn').click();
await bob.page.waitForTimeout(900);
await shot(bob, 'armada-2-deploy');

// Bob auto-deploys and engages (STAGES — Alice hasn't committed yet).
await bob.page.getByRole('button', { name: /Auto-deploy/ }).click();
await bob.page.waitForTimeout(400);
await bob.page.getByRole('button', { name: /Engage/ }).click();
await bob.page.waitForTimeout(600);
await shot(bob, 'armada-3-awaiting');

// Alice deploys through her own overlay; the staged commit follows on its own.
await alice.page.goto(`http://localhost:5173/chat/${aChat}`);
await alice.page.waitForTimeout(900);
await alice.page.locator('.gcc-btn').click();
await alice.page.getByRole('button', { name: /Auto-deploy/ }).click();
await alice.page.waitForTimeout(400);
await alice.page.getByRole('button', { name: /Engage/ }).click();
await poll(() => alice.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => g?.moves === 2, { label: 'both fleets in' });

// 3 — the battle face: enemy waters with radar, your fleet below, rosters, log.
await alice.page.waitForTimeout(900);
await shot(alice, 'armada-4-battle-desktop');
await shot(bob, 'armada-5-battle-mobile');

// A few salvos (defenders answer automatically via the duty officer).
const fire = (p, chat, cell) =>
  p.page.evaluate((a) => window.__ringTest.playGameMove(a.c, a.m, { t: 'shot', cell: a.cell }), { c: chat, m: mid, cell });
await fire(alice, aChat, 9);
await poll(() => alice.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => g?.moves === 4, { label: 'answer 1' });
await fire(bob, bChat, 0);
await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => g?.moves === 6, { label: 'answer 2' });
await fire(alice, aChat, 19);
await poll(() => alice.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => g?.moves === 8, { label: 'answer 3' });
await bob.page.waitForTimeout(700);
await shot(bob, 'armada-6-hits');

// 4 — a toast from another chat over Bob's fullscreen game, then the pill.
await say(cara, bob.id, 'psst Bob, dinner tonight?');
await bob.page.waitForTimeout(1500);
await shot(bob, 'armada-7-toast-over-game');
await bob.page.locator('.nb-main').first().click().catch(() => {});
await bob.page.waitForTimeout(900);
await shot(bob, 'armada-8-pill');
// The pill tucks into just the circular glyph after ~2.5s so it stops covering the chat.
await bob.page.waitForTimeout(2500);
await shot(bob, 'armada-8b-pill-collapsed');

// 5 — back in via the pill; then Alice resigns so Bob gets the medal ceremony.
await bob.page.locator('.fgb').click().catch(() => {});
await bob.page.waitForTimeout(600);
await alice.page.evaluate((a) => window.__ringTest.resignGame(a.c, a.m), { c: aChat, m: mid });
await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => g?.status?.state === 'resigned', { label: 'resigned' });
await bob.page.waitForTimeout(900);
await shot(bob, 'armada-9-medal');

await sweep([alice, bob, cara]);
await done();
