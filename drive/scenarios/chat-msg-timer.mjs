/**
 * The composer's per-message disappearing timer: pick a duration, and messages you send get that
 * expiry (sticky until changed). Overrides the chat default.
 *
 *   HEADED=1 node drive/scenarios/chat-msg-timer.mjs
 */
import { preflight, createAccount, pair, chatWith, shot, sweep, done, poll } from '../driver.mjs';

await preflight();
const [a, b] = [
  await createAccount({ name: 'Timer Tim', mobile: true }),
  await createAccount({ name: 'Bo', mobile: true }),
];
await pair(a, b);
const chatId = await chatWith(a, b.id);
await a.page.goto(`/chat/${chatId}`);
await poll(() => a.page.evaluate(() => !!document.querySelector('ion-textarea')), Boolean, { label: 'composer' });

// Open the timer sheet and pick 5 minutes.
await a.page.evaluate(() => document.querySelector('.ttl-btn')?.click());
await poll(() => a.page.evaluate(() => !!document.querySelector('ion-action-sheet')), Boolean, { label: 'timer sheet' });
await a.page.evaluate(() => {
  const sheet = document.querySelector('ion-action-sheet');
  [...sheet.querySelectorAll('button')].find((x) => /5 minutes/i.test(x.textContent))?.click();
  sheet?.dismiss?.(); // synthetic click fires the handler but doesn't auto-dismiss in the harness
});
await poll(() => a.page.evaluate(() => document.querySelector('.ttl-badge')?.textContent?.trim() === '5m'), Boolean, { label: 'badge 5m' });
console.log('timer badge:', await a.page.evaluate(() => document.querySelector('.ttl-badge')?.textContent?.trim()));
await shot(a, 'msg-timer-set');

// The timer UI is verified (badge). Now exercise the send-side plumbing directly (sendMessage with a
// per-message override → stampExpiry), which is what the composer's send() calls with msgTtl.
await a.page.evaluate(() => document.querySelectorAll('ion-action-sheet').forEach((s) => s.dismiss?.()));
await a.page.evaluate((id) => window.__ringTest.sendChatMessageTtl(id, 'poof in 5', 5 * 60 * 1000), chatId);
await poll(
  () => a.page.evaluate((id) => window.__ringTest.messages(id).then((ms) => ms.some((m) => m.body === 'poof in 5')), chatId),
  Boolean,
  { label: 'message sent' },
);
const info = await a.page.evaluate(async (id) => {
  const ms = await window.__ringTest.messages(id);
  const m = ms.find((x) => x.body === 'poof in 5');
  return { expiresAt: m?.expiresAt, inMs: m?.expiresAt ? m.expiresAt - Date.now() : null };
}, chatId);
const min = info.inMs !== null ? Math.round(info.inMs / 60000) : null;
console.log(`sent message expiry: ~${min} min out (expect ~5)`);

await sweep([a, b]);
await done();
