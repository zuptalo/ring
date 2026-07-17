import { createAccount, pair, say, waitForMessage, chatWith, sweep, done } from '../driver.mjs';
const bob = await createAccount({ name: 'Bob' });
const alice = await createAccount({ name: 'Alice' });   // hidden
const carol = await createAccount({ name: 'Carol' });   // normal
await pair(bob, alice); await pair(bob, carol);
await say(alice, bob.id, 'hi-a'); await say(carol, bob.id, 'hi-c');
await waitForMessage(bob, alice.id, /hi-a/); await waitForMessage(bob, carol.id, /hi-c/);
const hiddenId = await chatWith(bob, alice.id);
await bob.page.evaluate(() => window.__ringTest.setGlobalSetting('privacy.hiddenChatsEnabled', true));
await bob.page.evaluate((p) => window.__ringTest.hiddenSetPin(p), '4321');
await bob.page.evaluate((id) => window.__ringTest.hiddenAdd(id), hiddenId);
await bob.page.goto('/tabs/chats');

// Poll .nb banners for `ms`, returning the max snapshot of texts seen.
const watchBanners = async (ms) => {
  let seen = [];
  for (let t = 0; t < ms; t += 150) {
    const now = await bob.page.evaluate(() => Array.from(document.querySelectorAll('.nb')).map(e => e.textContent.replace(/\s+/g,' ').trim()));
    if (now.length > seen.length) seen = now;
    await new Promise(r => setTimeout(r, 150));
  }
  return seen;
};

await bob.page.waitForTimeout(4000);              // clear the post-load settle window
await say(carol, bob.id, 'normal ping');
const carolBanners = await watchBanners(3000);
console.log('[carol] banners=%j', carolBanners);

await bob.page.waitForTimeout(5000);              // let banners + any settle clear
await say(alice, bob.id, 'secret ping');
const aliceBanners = await watchBanners(3000);
const gotAlice = await bob.page.evaluate((c) => window.__ringTest.messages(c).then(ms => ms.some(m => /secret ping/.test(m.body||''))), hiddenId);
console.log('[alice] banners=%j receivedHidden=%s', aliceBanners, gotAlice);

const pass = carolBanners.some(t => /Carol/.test(t)) && aliceBanners.length === 0 && gotAlice;
console.log(pass ? '[PASS] normal chat banners; hidden chat = NO banner, message still received' : '[FAIL] see above');
await sweep([bob, alice, carol]); await done();
