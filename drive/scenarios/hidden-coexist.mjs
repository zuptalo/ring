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

const pass1 = got && !visible.includes(anaChat) && withBen.length === 1 && badge > 0;
console.log('[hidden-coexist:1] received=%s visibleLeak=%s threadsWithBen=%d badge=%d',
  got, visible.includes(anaChat), withBen.length, badge);

// ---- Part 2 (US3): fresh visible thread coexists; Hide/Unhide gated; ≥100-message isolation soak.
const visibleChat = await ana.page.evaluate((id) => window.__ringTest.startChat(id), ben.id);
const threads = await ana.page.evaluate((id) => window.__ringTest.chatsWith(id), ben.id);
const hideVerdict = await ana.page.evaluate((id) => window.__ringTest.hiddenCanHide(id), visibleChat);
const unhideVerdict = await ana.page.evaluate((id) => window.__ringTest.hiddenCanUnhide(id), anaChat);

// Volume soak (SC-004): 100 messages alternate across the two threads from both
// sides; not one may land in the wrong thread.
const benChat = await chatWith(ben, ana.id); // Ben's plain 1:1 (his side of the hidden thread)
for (let i = 0; i < 25; i++) {
  await ana.page.evaluate(({ c, i }) => window.__ringTest.sendChatMessage(c, `open-a-${i}`), { c: visibleChat, i });
  await ana.page.evaluate(({ c, i }) => window.__ringTest.sendChatMessage(c, `secret-a-${i}`), { c: anaChat, i });
  await ben.page.evaluate(({ c, i }) => window.__ringTest.sendChatMessage(c, `open-b-${i}`), { c: visibleChat, i });
  await ben.page.evaluate(({ c, i }) => window.__ringTest.sendChatMessage(c, `secret-b-${i}`), { c: benChat, i });
}
// Wait for full delivery on Ana's side (50 inbound: 25 open-b + 25 secret-b).
let openBodies = [], secretBodies = [];
for (let t = 0; t < 60000; t += 500) {
  openBodies = (await ana.page.evaluate((c) => window.__ringTest.messages(c), visibleChat)).map((m) => m.body);
  secretBodies = (await ana.page.evaluate((c) => window.__ringTest.messages(c), anaChat)).map((m) => m.body);
  if (openBodies.filter((b) => /^open-b-/.test(b)).length >= 25 &&
      secretBodies.filter((b) => /^secret-b-/.test(b)).length >= 25) break;
  await new Promise((r) => setTimeout(r, 500));
}
const leaks =
  openBodies.filter((b) => /^secret-/.test(b)).length +
  secretBodies.filter((b) => /^open-/.test(b)).length;
const delivered =
  openBodies.filter((b) => /^open-b-/.test(b)).length +
  secretBodies.filter((b) => /^secret-b-/.test(b)).length;

const pass2 =
  visibleChat !== anaChat &&
  threads.length === 2 &&
  hideVerdict.ok === false &&
  unhideVerdict.ok === false &&
  delivered === 50 &&
  leaks === 0;
console.log('[hidden-coexist:2] threads=%d hideBlocked=%s unhideBlocked=%s delivered=%d/50 leaks=%d',
  threads.length, !hideVerdict.ok, !unhideVerdict.ok, delivered, leaks);
console.log(pass1 && pass2
  ? '[PASS] hidden thread silent + coexistence with zero cross-thread leaks over 100 messages'
  : '[FAIL] see above');
await sweep([ana, ben]);
await done();
