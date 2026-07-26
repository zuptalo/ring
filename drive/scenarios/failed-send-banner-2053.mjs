/**
 * Spec 2053 — the "couldn't be sent" banner taps through to the failing media.
 *
 * Seeds a failed outgoing media message, then confirms the sticky danger banner appears, is
 * TAPPABLE (an action card is normally static — this one carries onOpen), and tapping it
 * navigates to the failing message's chat with the ?jump anchor. The hidden-chat carve-out is
 * covered by the pickFailedJumpTarget unit test.
 *
 *   node drive/scenarios/failed-send-banner-2053.mjs
 *   HEADED=1 node drive/scenarios/failed-send-banner-2053.mjs
 */
import { createAccount, pair, chatWith, shot, poll, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice', mobile: true });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);
const aliceChat = await chatWith(alice, bob.id);

// Start on the Chats list so a jump into the chat is observable.
await alice.page.evaluate(() => window.__ringTest.goHome?.());

// Seed a failed media send in this (non-hidden) chat → the sticky banner should surface.
const failedId = await alice.page.evaluate(
  (c) => window.__ringTest.seedFailedMedia(c, 'cant-convert'),
  aliceChat,
);

await poll(
  () => alice.page.locator('.nb-danger').count(),
  (n) => n >= 1,
  { timeout: 10_000, label: 'failed-send banner visible' },
);

// The card must be tappable (role=button) — the onOpen exception to action-card staticness.
const tappable = await alice.page.locator('.nb-danger .nb-main[role="button"]').count();
if (tappable < 1) throw new Error('FAIL: failed-send banner is not tappable (no role=button header)');
console.log('[2053] banner is tappable ✓');

await shot(alice, 'failed-send-banner');

// Tap the header → should push /chat/<aliceChat>?jump=<failedId>.
await alice.page.locator('.nb-danger .nb-main[role="button"]').first().click();
await poll(
  () => alice.page.url(),
  (url) => url.includes(`/chat/${aliceChat}`) && url.includes(`jump=${failedId}`),
  { timeout: 10_000, label: 'tapping banner jumped to the failing chat/message' },
);
console.log('[2053] tapped → navigated to', await alice.page.url());

await shot(alice, 'failed-send-jumped', { route: `/chat/${aliceChat}` });

await sweep([alice, bob]);
await done();
