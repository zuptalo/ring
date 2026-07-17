// privacy.hiddenChatsBadge: 'always' (default) counts hidden chats in the unread badge,
// 'never' excludes them, 'revealed' counts them only during a reveal session.
import { createAccount, pair, say, waitForMessage, chatWith, sweep, done } from '../driver.mjs';
const bob = await createAccount({ name: 'Bob' });
const alice = await createAccount({ name: 'Alice' }); // hidden
await pair(bob, alice);
await say(alice, bob.id, 'hi'); await waitForMessage(bob, alice.id, /hi/);
const hiddenId = await chatWith(bob, alice.id);
await bob.page.evaluate(() => window.__ringTest.setGlobalSetting('privacy.hiddenChatsEnabled', true));
await bob.page.evaluate((p) => window.__ringTest.hiddenSetPin(p), '4321');
await bob.page.evaluate((id) => window.__ringTest.hiddenAdd(id), hiddenId);

const badge = () => bob.page.evaluate(() => window.__ringTest.unreadBadge());
const setMode = async (m) => { await bob.page.evaluate((x) => window.__ringTest.setGlobalSetting('privacy.hiddenChatsBadge', x), m); await bob.page.waitForTimeout(200); };

await setMode('always');
const always = await badge();
await setMode('never');
const never = await badge();
await setMode('revealed');
const revealedLocked = await badge();
await bob.page.evaluate((p) => window.__ringTest.hiddenReveal(p), '4321');
await bob.page.waitForTimeout(300);
const revealedOpen = await badge();
await bob.page.evaluate(() => window.__ringTest.hiddenRelock());

console.log('always=%d  never=%d  revealed(locked)=%d  revealed(open)=%d  (hidden chat unread=1)', always, never, revealedLocked, revealedOpen);
const pass = always === 1 && never === 0 && revealedLocked === 0 && revealedOpen === 1;
console.log(pass ? '[PASS] always counts hidden; never excludes; revealed only during reveal' : '[FAIL] see above');
await sweep([bob, alice]); await done();
