// Chess smoke test (new fullscreen game): drives a real 1:1 game through the
// board UI — selection + moves in both orientations, last-move highlight,
// a capture with the material tray, and the full draw offer/decline/accept
// negotiation and ceremony. Screenshots land in .tmp/drive/. Verifies the
// ChessBoard component + the generalized challenge card copy end-to-end.
import { createAccount, pair, poll, shot, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });          // White (starter)
const bob = await createAccount({ name: 'Bob', mobile: true }); // Black
await pair(alice, bob);

const aChat = await alice.page.evaluate((id) => window.__ringTest.chatWith(id), bob.id);
const bChat = await bob.page.evaluate((id) => window.__ringTest.chatWith(id), alice.id);
const mid = await alice.page.evaluate((c) => window.__ringTest.sendGame(c, 'chess'), aChat);
await poll(() => bob.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => !!g, { label: 'card at bob' });

// 1 — the challenge card in Bob's chat: CHESS glyph + chess-voice copy
// ("Chess match · Alice challenged you"), NOT naval.
await bob.page.goto(`http://localhost:5173/chat/${bChat}`);
await bob.page.waitForTimeout(1000);
await shot(bob, 'chess-1-card');

// Both open the fullscreen overlay.
const openBoard = async (c) => {
  await c.page.locator('.gcc-btn').click();
  await c.page.locator('.ch-board').waitFor({ state: 'visible', timeout: 8000 });
  await c.page.waitForTimeout(500);
};
await openBoard(bob);
await shot(bob, 'chess-2-initial-black'); // Black's view — board flipped

await alice.page.goto(`http://localhost:5173/chat/${aChat}`);
await alice.page.waitForTimeout(700);
await openBoard(alice);
await shot(alice, 'chess-3-initial-white'); // White's view — "Your move"

// A move is two taps: the from-square (selects, targets light up) then the
// to-square. aria-labels are the true square names, orientation-independent.
const sqSel = (name) => `.ch-sq[aria-label^="${name}"]`;
const uiMove = async (c, from, to) => {
  await c.page.locator(sqSel(from)).click();
  await c.page.waitForTimeout(200);
  await c.page.locator(sqSel(to)).click();
  await c.page.waitForTimeout(250);
};
const movesTo = (who, n, label) =>
  poll(() => who.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => g?.moves === n, { label });

// Show the selection + legal-move dots before committing.
await alice.page.locator(sqSel('e2')).click();
await alice.page.waitForTimeout(250);
await shot(alice, 'chess-4-selected'); // e2 selected, dots on e3/e4

await alice.page.locator(sqSel('e4')).click();
await movesTo(alice, 1, 'e4');
await shot(alice, 'chess-5-after-e4'); // last-move highlight, "Bob to move"

await uiMove(bob, 'e7', 'e5');
await movesTo(bob, 2, 'e5');
await uiMove(alice, 'g1', 'f3');
await movesTo(alice, 3, 'Nf3');
await uiMove(bob, 'b8', 'c6');
await movesTo(bob, 4, 'Nc6');
await uiMove(alice, 'f1', 'c4');
await movesTo(alice, 5, 'Bc4');
await uiMove(bob, 'f8', 'c5');
await movesTo(bob, 6, 'Bc5');

// Draw negotiation — offer, decline, then a real capture.
await alice.page.locator('.ch-btn', { hasText: 'Offer draw' }).click();
await movesTo(alice, 7, 'offer');
await shot(alice, 'chess-6-offered'); // "Draw offered — waiting", button disabled
await shot(bob, 'chess-7-draw-banner'); // Bob sees the offer banner
await bob.page.locator('.ch-drawbar .ch-mini', { hasText: 'Decline' }).click();
await movesTo(bob, 8, 'decline');

// Nxe5 — a capture. The taken pawn shows in Alice's tray with +1 material.
await uiMove(alice, 'f3', 'e5');
await movesTo(alice, 9, 'Nxe5');
await shot(alice, 'chess-8-capture'); // captured pawn glyph + "+1"

// Now it's Bob's move — Bob offers a draw this time, Alice accepts → ceremony.
await bob.page.locator('.ch-btn', { hasText: 'Offer draw' }).click();
await movesTo(bob, 10, 'offer2');
await alice.page.locator('.ch-drawbar .ch-mini', { hasText: 'Accept' }).click();
await poll(() => alice.page.evaluate((m) => window.__ringTest.gameInfo(m), mid), (g) => g?.status?.state === 'draw', { label: 'agreed draw' });
await alice.page.waitForTimeout(700);
await shot(alice, 'chess-9-draw-ceremony');
await shot(bob, 'chess-10-draw-ceremony-mobile');

await sweep([alice, bob]);
await done();
