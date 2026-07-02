// Spec 1027 US2/FR-009 — grace expiry while INSIDE an open hidden chat kicks
// out to the Chats list at once (bug B5). Uses the real grace machinery
// (useHiddenChats' visibilitychange handler) by overriding visibilityState,
// with grace set to 'immediately' so any away-time relocks.
import { createAccount, pair, say, waitForMessage, chatWith, sweep, done } from '../driver.mjs';

const mia = await createAccount({ name: 'Mia' });
const leo = await createAccount({ name: 'Leo' });
await pair(mia, leo);
await say(leo, mia.id, 'psst');
await waitForMessage(mia, leo.id, /psst/);
const chat = await chatWith(mia, leo.id);

await mia.page.evaluate(() => window.__ringTest.setGlobalSetting('privacy.hiddenChatsEnabled', true));
await mia.page.evaluate(() => window.__ringTest.setGlobalSetting('privacy.hiddenChatsGrace', 'immediately'));
await mia.page.evaluate((p) => window.__ringTest.hiddenSetPin(p), '1357');
await mia.page.evaluate((id) => window.__ringTest.hiddenAdd(id), chat);

// Land on Chats (mounts the grace watcher), reveal, open the hidden chat.
await mia.page.goto('/tabs/chats');
await mia.page.waitForFunction(() => window.__ringTest?.isUnlocked?.() === true, null, { timeout: 30000 });
await mia.page.evaluate((p) => window.__ringTest.hiddenReveal(p), '1357');
await mia.page.evaluate((id) => window.__ringTest.navigate(`/chat/${id}`), chat);
await mia.page.waitForFunction((id) => window.location.pathname === `/chat/${id}`, chat, { timeout: 10000 });

// Simulate app-switch away and back: visibilityState hidden → visible. With
// grace 'immediately' the return relocks, and the relock must kick us out.
await mia.page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await mia.page.waitForTimeout(300);
await mia.page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});

let kicked = false;
for (let t = 0; t < 10000 && !kicked; t += 200) {
  kicked = await mia.page.evaluate(() => window.location.pathname === '/tabs/chats');
  if (!kicked) await new Promise((r) => setTimeout(r, 200));
}
const relocked = !(await mia.page.evaluate((id) =>
  window.__ringTest.visibleChatIds().then((ids) => ids.includes(id)), chat));

console.log('[hidden-kickout] kickedOut=%s relocked=%s', kicked, relocked);
console.log(kicked && relocked
  ? '[PASS] grace expiry inside the hidden chat kicked out and relocked'
  : '[FAIL] see above');
await sweep([mia, leo]);
await done();
