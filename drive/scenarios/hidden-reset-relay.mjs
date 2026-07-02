// Spec 1027 US5 (FR-018, bug B3) — after a hidden-chats reset, a live inbound
// message must NOT re-materialize the wiped conversation; deliberately starting
// a new chat lifts the block and everything works again.
import { createAccount, pair, say, waitForMessage, chatWith, sweep, done } from '../driver.mjs';

const kim = await createAccount({ name: 'Kim' });
const raj = await createAccount({ name: 'Raj' });
await pair(kim, raj);
await say(raj, kim.id, 'pre-reset');
await waitForMessage(kim, raj.id, /pre-reset/);
const chat = await chatWith(kim, raj.id);

await kim.page.evaluate(() => window.__ringTest.setGlobalSetting('privacy.hiddenChatsEnabled', true));
await kim.page.evaluate((p) => window.__ringTest.hiddenSetPin(p), '9753');
await kim.page.evaluate((id) => window.__ringTest.hiddenAdd(id), chat);
const res = await kim.page.evaluate(() => window.__ringTest.hiddenReset());

// Raj keeps talking over the live relay — nothing may come back.
await say(raj, kim.id, 'anyone home?');
await new Promise((r) => setTimeout(r, 5000));
const after = await kim.page.evaluate((id) => window.__ringTest.chatsWith(id), raj.id);
const visible = await kim.page.evaluate(() => window.__ringTest.visibleChatIds());

// Kim re-engages: block lifts, conversation restarts cleanly.
const fresh = await kim.page.evaluate((id) => window.__ringTest.startChat(id), raj.id);
await kim.page.evaluate(({ c }) => window.__ringTest.sendChatMessage(c, 'fresh start'), { c: fresh });
await waitForMessage(raj, kim.id, /fresh start/);
await say(raj, kim.id, 'got it');
let back = false;
for (let t = 0; t < 15000 && !back; t += 300) {
  back = await kim.page.evaluate((c) =>
    window.__ringTest.messages(c).then((ms) => ms.some((m) => /got it/.test(m.body || ''))), fresh);
  if (!back) await new Promise((r) => setTimeout(r, 300));
}

const pass = res.wiped.includes(chat) && after.length === 0 && visible.length === 0 && back;
console.log('[hidden-reset-relay] wiped=%s rematerialized=%d visibleLeak=%d reengaged=%s',
  res.wiped.includes(chat), after.length, visible.length, back);
console.log(pass
  ? '[PASS] reset holds against the live relay; explicit re-engagement lifts it'
  : '[FAIL] see above');
await sweep([kim, raj]);
await done();
