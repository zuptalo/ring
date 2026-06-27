import { createAccount, pair, say, waitForMessage, chatWith, shot, sweep, done } from '../driver.mjs';
const bob = await createAccount({ name: 'Bob' });
const alice = await createAccount({ name: 'Alice' });   // will be hidden
const carol = await createAccount({ name: 'Carol' });   // stays visible
await pair(bob, alice); await pair(bob, carol);
await say(alice, bob.id, 'secret'); await say(carol, bob.id, 'normal');
await waitForMessage(bob, alice.id, /secret/); await waitForMessage(bob, carol.id, /normal/);
const hiddenId = await chatWith(bob, alice.id);
await bob.page.evaluate(() => window.__ringTest.setGlobalSetting('privacy.hiddenChatsEnabled', true));
await bob.page.evaluate((p) => window.__ringTest.hiddenSetPin(p), '4321');
await bob.page.evaluate((id) => window.__ringTest.hiddenAdd(id), hiddenId);

await bob.page.goto('/tabs/chats');
await bob.page.waitForTimeout(800);
const locked = await bob.page.evaluate(() => document.querySelectorAll('.hidden-row, .hidden-ico').length);
console.log('[locked] hidden markers on screen =', locked, '(expected 0)');
await shot(bob, 'hidden-marker-locked', {});

// Reveal via the PIN in the search bar.
const input = bob.page.locator('ion-searchbar input').first();
await input.click(); await input.pressSequentially('4321', { delay: 70 });
await bob.page.waitForTimeout(900);
const revealed = await bob.page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('ion-item.hidden-row'));
  const names = rows.map(r => r.querySelector('h2')?.textContent?.trim());
  return { tinted: rows.length, eyeIcons: document.querySelectorAll('.hidden-ico').length, names };
});
console.log('[revealed]', JSON.stringify(revealed));
await shot(bob, 'hidden-marker-revealed', {});
console.log(locked === 0 && revealed.tinted === 1 && revealed.eyeIcons === 1 && revealed.names.includes('Alice')
  ? '[PASS] marker only while revealed; tints+marks the hidden row (Alice), not normal ones' : '[FAIL] see above');
await sweep([bob, alice, carol]); await done();
