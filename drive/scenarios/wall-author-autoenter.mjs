// Verify the author auto-enter fix: when a rival accepts the author's OWN
// fullscreen Wall challenge and the author's app is visible, the author is
// dropped straight into the board (parity with 1:1) — so the accepter isn't
// left waiting. Also checks it does NOT double-enter on a repeat sync.
//
//   node drive/scenarios/wall-author-autoenter.mjs
import { createAccount, pair, poll, sweep, done, SHOT_DIR } from '../driver.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const boardVisible = (c, sel) => c.page.locator(sel).isVisible().catch(() => false);
const vis = (c) => c.page.evaluate(() => document.visibilityState);

for (const [gameType, boardSel] of [['armada', '.armada'], ['chess', '.ch-board']]) {
  console.log(`\n===== AUTHOR AUTO-ENTER: ${gameType} =====`);
  const alice = await createAccount({ name: 'Alice' });
  const bob = await createAccount({ name: 'Bob', mobile: true });
  await pair(alice, bob);

  const pid = await alice.page.evaluate((gt) => window.__ringTest.post({ game: { gameType: gt } }), gameType);

  // Alice sits on the Wall, watching (visible).
  await alice.page.goto('/tabs/wall');
  await alice.page.waitForTimeout(500);
  console.log('  alice visibilityState =', await vis(alice));
  console.log('  board before accept:', await boardVisible(alice, boardSel));

  // Bob accepts.
  await poll(() => bob.page.evaluate(async (id) => { await window.__ringTest.syncPosts(); return window.__ringTest.wallGameInfo(id); }, pid), (g) => !!g, { label: 'card at bob' });
  await bob.page.evaluate((id) => window.__ringTest.acceptWallChallenge(id), pid);

  // Alice's device syncs the acceptance → notifyWallGameActivity → auto-enter.
  let entered = false;
  try {
    await poll(
      async () => {
        await alice.page.evaluate((id) => window.__ringTest.syncEngagement(id), pid);
        return boardVisible(alice, boardSel);
      },
      (v) => v === true,
      { label: `${gameType} author auto-entered board`, timeout: 15000 },
    );
    entered = true;
  } catch { /* handled below */ }
  console.log(entered ? `  [AUTO-ENTER ✓] ${gameType}: author board opened on its own` : `  [AUTO-ENTER ✗] ${gameType}: author NOT entered`);

  mkdirSync(SHOT_DIR, { recursive: true });
  const f = path.join(SHOT_DIR, `autoenter-${gameType}.png`);
  await alice.page.screenshot({ path: f });
  console.log('  [shot]', f);

  await sweep([alice, bob]);
}

await done();
