// Spec 1027 — hide moves the chat and the hidden thread keeps receiving silently
// (part 1, US1 / bug B1); coexistence journey lands in part 2 (US3).
import { createAccount, pair, say, waitForMessage, chatWith, sweep, done } from '../driver.mjs';

const ana = await createAccount({ name: 'Ana' });
const ben = await createAccount({ name: 'Ben' });
await pair(ana, ben);

// Traffic both ways so the ratchet is established under the visible 1:1.
await say(ben, ana.id, 'before hide');
await waitForMessage(ana, ben.id, /before hide/);
const anaChat = await chatWith(ana, ben.id);

// Hide it on Ana's device.
await ana.page.evaluate(() => window.__ringTest.setGlobalSetting('privacy.hiddenChatsEnabled', true));
await ana.page.evaluate((p) => window.__ringTest.hiddenSetPin(p), '2468');
await ana.page.evaluate((id) => window.__ringTest.hiddenAdd(id), anaChat);
await ana.page.goto('/tabs/chats');
await ana.page.waitForFunction(() => window.__ringTest?.isUnlocked?.() === true, null, { timeout: 30000 });

// Ben keeps talking: the message must land in the HIDDEN thread — no visible
// resurrection, no second conversation row (bug B1).
await say(ben, ana.id, 'secret ping');
let got = false;
for (let t = 0; t < 15000 && !got; t += 300) {
  got = await ana.page.evaluate((c) =>
    window.__ringTest.messages(c).then((ms) => ms.some((m) => /secret ping/.test(m.body || ''))), anaChat);
  if (!got) await new Promise((r) => setTimeout(r, 300));
}
const visible = await ana.page.evaluate(() => window.__ringTest.visibleChatIds());
const withBen = await ana.page.evaluate((id) => window.__ringTest.chatsWith(id), ben.id);
const badge = await ana.page.evaluate(() => window.__ringTest.unreadBadge());

const pass = got && !visible.includes(anaChat) && withBen.length === 1 && badge > 0;
console.log('[hidden-coexist:1] received=%s visibleLeak=%s threadsWithBen=%d badge=%d',
  got, visible.includes(anaChat), withBen.length, badge);
console.log(pass
  ? '[PASS] hidden thread keeps receiving silently; no visible resurrection'
  : '[FAIL] see above');
await sweep([ana, ben]);
await done();
