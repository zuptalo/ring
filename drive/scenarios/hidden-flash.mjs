// Verify the hidden-chats STARTUP FLASH fix (spec 1019).
//
// Bug: on app open the chat-list query (listChats) could run while the keystore
// was still locked behind the unlock gate; ensureHiddenLoaded then returned an
// EMPTY set (indistinguishable from "nothing hidden"), so hidden chats briefly
// appeared before the post-unlock re-query filtered them out — a visible flash.
//
// Fix: listChats fails CLOSED until the hidden set is definitively known
// (isHiddenKnown()). This scenario installs a high-frequency sampler that records
// exactly what listChats returns across the locked→unlocked window on EVERY reload,
// and asserts the hidden chat id NEVER appears there — it only shows up after the
// PIN is typed into the search bar.
import { createAccount, pair, say, waitForMessage, chatWith, shot, sweep, done } from '../driver.mjs';

const bob = await createAccount({ name: 'Bob' });
const alice = await createAccount({ name: 'Alice' }); // becomes Bob's HIDDEN chat
const carol = await createAccount({ name: 'Carol' }); // stays a normal VISIBLE chat

await pair(bob, alice);
await pair(bob, carol);
await say(alice, bob.id, 'secret hello');
await say(carol, bob.id, 'normal hello');
await waitForMessage(bob, alice.id, /secret hello/);
await waitForMessage(bob, carol.id, /normal hello/);

// Bob's per-device chat ids (stable across reloads).
const hiddenId = await chatWith(bob, alice.id);
const visibleId = await chatWith(bob, carol.id);
console.log(`[ids] hidden(Alice)=${hiddenId}  visible(Carol)=${visibleId}`);

// Enable the feature, set the reveal PIN, and hide the Alice chat.
await bob.page.evaluate(() => window.__ringTest.setGlobalSetting('privacy.hiddenChatsEnabled', true));
await bob.page.evaluate((pin) => window.__ringTest.hiddenSetPin(pin), '4321');
await bob.page.evaluate((id) => window.__ringTest.hiddenAdd(id), hiddenId);

// Sanity (fully unlocked): the hidden chat is excluded, the normal one is present.
const beforeReload = await bob.page.evaluate(() => window.__ringTest.visibleChatIds());
console.log(`[sanity] visible before reload: ${JSON.stringify(beforeReload)} (hidden excluded: ${!beforeReload.includes(hiddenId)})`);

// Install a sampler that runs on EVERY navigation (persists across reloads): from
// the first instant window.__ringTest exists, poll listChats() as fast as it can,
// recording the unlocked flag + the visible ids, so we capture the startup window.
await bob.page.addInitScript(() => {
  window.__flash = [];
  // The ACTUAL on-screen chat names (rendered DOM rows), not just the data layer —
  // this is what the user sees flash. h2 inside the chat list rows holds the name.
  const domNames = () =>
    Array.from(document.querySelectorAll('ion-content ion-list ion-item ion-label h2')).map((e) => (e.textContent || '').trim());
  (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 4000) {
      const t = window.__ringTest;
      if (t && t.visibleChatIds) {
        try {
          const visible = await t.visibleChatIds();
          window.__flash.push({ ms: Date.now() - t0, unlocked: !!t.isUnlocked(), visible, dom: domNames() });
        } catch (e) {
          window.__flash.push({ ms: Date.now() - t0, err: String((e && e.message) || e), dom: domNames() });
        }
      } else {
        window.__flash.push({ ms: Date.now() - t0, noHook: true, dom: domNames() });
      }
      await new Promise((r) => setTimeout(r, 12));
    }
  })();
});

// Reload onto the Chats tab so the list actually renders during the startup window.
await bob.page.goto('/tabs/chats');

// Hard-reload 20 times (spec 1027 SC-006 soak) and analyze the captured
// startup window each time.
let dataLeaks = 0, domLeaks = 0, emptyFlashes = 0;
const ROUNDS = 20;
for (let i = 1; i <= ROUNDS; i++) {
  await bob.page.reload();
  await bob.page.waitForFunction(() => Array.isArray(window.__flash) && window.__flash.length > 0, null, { timeout: 15_000 });
  await bob.page.waitForTimeout(2500); // let the sampler span the unlock transition
  const samples = await bob.page.evaluate(() => window.__flash);
  const withVisible = samples.filter((s) => Array.isArray(s.visible));
  const leakedData = withVisible.filter((s) => s.visible.includes(hiddenId));
  // DOM-level: did the hidden contact's NAME ever render on screen during startup?
  const domHidAlice = samples.filter((s) => Array.isArray(s.dom) && s.dom.includes('Alice'));
  // The "Start a conversation" empty-state hint must NEVER render while this user
  // actually HAS chats (it would be a transient empty-list flash before they load).
  const emptyFlash = samples.filter((s) => Array.isArray(s.dom) && s.dom.includes('Start a conversation'));
  const firstDomNonEmpty = samples.find((s) => Array.isArray(s.dom) && s.dom.length);
  dataLeaks += leakedData.length;
  domLeaks += domHidAlice.length;
  emptyFlashes += emptyFlash.length;
  console.log(
    `[reload ${i}] samples=${withVisible.length} dataLeaks=${leakedData.length} ` +
    `domLeaks(Alice)=${domHidAlice.length} emptyHintFlash=${emptyFlash.length}` +
    (domHidAlice.length ? `  !! ALICE @${domHidAlice[0].ms}ms` : '') +
    (emptyFlash.length ? `  !! "Start a conversation" @${emptyFlash[0].ms}ms` : ''),
  );
  if (firstDomNonEmpty) console.log(`           first rendered rows @${firstDomNonEmpty.ms}ms = ${JSON.stringify(firstDomNonEmpty.dom)}`);
}
console.log(`\n[summary] across ${ROUNDS} reloads: dataLeaks=${dataLeaks}  domVisualLeaks=${domLeaks}  emptyHintFlashes=${emptyFlashes}`);
console.log(dataLeaks === 0 && domLeaks === 0 && emptyFlashes === 0
  ? '[PASS] no hidden-chat leak and no empty-state flash during startup'
  : '[FAIL] something flashed at startup');

// First paint after a fresh reload, on the Chats tab: Carol present, Alice absent.
await shot(bob, 'hidden-flash-1-firstpaint', { route: '/tabs/chats' });

// Now reveal through the REAL search bar (the only entry point): typing the PIN.
const input = bob.page.locator('ion-searchbar input').first();
await input.click();
await input.pressSequentially('4321', { delay: 80 });
await bob.page.waitForTimeout(900);
const afterPin = await bob.page.evaluate(() => window.__ringTest.visibleChatIds());
console.log(`[reveal] visible after typing PIN: ${JSON.stringify(afterPin)} (hidden now shown: ${afterPin.includes(hiddenId)})`);
await shot(bob, 'hidden-flash-2-after-pin', {});

await sweep([bob, alice, carol]);
await done();
