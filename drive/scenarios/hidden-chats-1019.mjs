/**
 * Visual walkthrough of Hidden Chats (spec 1019) on the live dev stack.
 *
 *   node drive/scenarios/hidden-chats-1019.mjs        (headless)
 *   HEADED=1 node drive/scenarios/hidden-chats-1019.mjs   (watch it)
 *
 * Captures, on Alice's mobile Chats tab: the chat visible, then hidden (gone),
 * then revealed by typing the PIN into the search bar. Screenshots → .tmp/drive/.
 */
import {
  createAccount, pair, chatWith, say, waitForMessage, shot, sweep, done, poll,
} from '../driver.mjs';

const ev = (c, fn, ...args) => c.page.evaluate(fn, ...args);
const visibleIds = (c) => c.page.evaluate(() => window.__ringTest.visibleChatIds());

const alice = await createAccount({ name: 'Alice', mobile: true });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);

// A real conversation so the chat row is populated.
await say(bob, alice.id, 'meet me at the usual spot 🤫');
await waitForMessage(alice, bob.id, 'usual spot');
const chat = await chatWith(alice, bob.id);

// Enable the feature + set a PIN, then screenshot the chat VISIBLE.
await ev(alice, () => window.__ringTest.setGlobalSetting('privacy.hiddenChatsEnabled', true));
await ev(alice, (pin) => window.__ringTest.hiddenSetPin(pin), '2468');
await shot(alice, 'hidden-1-visible', { route: '/tabs/chats' });

// Hide it → the row disappears from the Chats tab.
await ev(alice, (id) => window.__ringTest.hiddenAdd(id), chat);
await poll(() => visibleIds(alice), (ids) => !ids.includes(chat), { label: 'chat hidden' });
await shot(alice, 'hidden-2-hidden', { route: '/tabs/chats' });

// Reveal via the search-bar PIN gesture → it returns.
await alice.page.locator('ion-searchbar input').first().fill('2468');
await poll(() => visibleIds(alice), (ids) => ids.includes(chat), { label: 'chat revealed' });
await shot(alice, 'hidden-3-revealed');

// The Settings → Privacy → Hidden chats screen.
await shot(alice, 'hidden-4-settings', { route: '/settings/privacy-hidden-chats' });

await sweep([alice, bob]);
await done();
