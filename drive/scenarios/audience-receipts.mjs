/**
 * Spec 1065 US1: per-member delivered/seen times on a group message.
 *
 *   node drive/scenarios/audience-receipts.mjs
 *   HEADED=1 node drive/scenarios/audience-receipts.mjs
 *
 * Alice sends to a group of three. Bob reads it, then a beat later Carol does,
 * and Dave never comes online for it — so message info should show one member in
 * each tier, each carrying a real moment except Dave.
 *
 * Also exercises the post-send joiner case: Erin is added to the group AFTER the
 * message was sent, so she must NOT appear under "Not yet delivered" (that was
 * the bug — the tier used to read the live roster instead of the send-time one).
 */
import {
  createAccount, pair, group, say, waitForMessage, messageId, shot, sweep, done, poll,
} from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
const carol = await createAccount({ name: 'Carol' });
const dave = await createAccount({ name: 'Dave' });
const erin = await createAccount({ name: 'Erin' });

// The recovery-code screen is a modal gate: until it is dismissed, in-app
// navigation goes nowhere and every screenshot comes back showing the code.
for (const c of [alice, bob, carol, dave, erin]) {
  const btn = c.page.getByText("I'VE SAVED IT");
  if (await btn.count()) await btn.click();
}

for (const m of [bob, carol, dave, erin]) await pair(alice, m);

const trip = await group(alice, 'Trip', [bob, carol, dave]);

await say(alice, trip, 'landing at six, who is around?', { isGroup: true });
await waitForMessage(bob, trip, 'landing at six', { isGroup: true });
await waitForMessage(carol, trip, 'landing at six', { isGroup: true });

const mid = await messageId(alice, trip, 'landing at six');

// Bob reads it now; Carol a moment later, so the two seen times differ visibly
// and the "most recent first" ordering has something to order.
await bob.page.evaluate((id) => window.__ringTest.markSeen(id), trip);
await poll(
  () => alice.page.evaluate((id) => window.__ringTest.messageReceipts(id), mid),
  (rs) => rs.filter((r) => r.seenAt).length === 1,
  { label: "bob's seen receipt" },
);

await new Promise((r) => setTimeout(r, 2000));
await carol.page.evaluate((id) => window.__ringTest.markSeen(id), trip);
await poll(
  () => alice.page.evaluate((id) => window.__ringTest.messageReceipts(id), mid),
  (rs) => rs.filter((r) => r.seenAt).length === 2,
  { label: "carol's seen receipt" },
);

const receipts = await alice.page.evaluate((id) => window.__ringTest.messageReceipts(id), mid);
console.log('receipts on the sender:', JSON.stringify(receipts, null, 2));

// SPA navigation, not a hard goto: a full reload drops the unlocked session and
// lands on the auth gate, which is why route-based shots of a deep page come back
// blank. `navigate` pushes through the app router and keeps state.
// Fire and forget: returning the router's promise to Playwright makes the
// evaluate race the navigation that destroys its own execution context.
const go = async (c, path) => {
  await c.page.evaluate((p) => {
    void window.__ringTest.navigate(p);
  }, path);
  await c.page.waitForTimeout(900);
};
const openInfo = (c) => go(c, `/chat/${trip}/info/${mid}`);

await openInfo(alice);
await shot(alice, 'us1-info-tiers');

// Open each tier: this is the whole point of the story, the per-member times.
// Click the ROW, not the section header: the header is a plain ion-list-header
// and swallows the tap without opening anything.
const openTierRow = async (index, name) => {
  await alice.page.locator('ion-item.tier-row').nth(index).click();
  await alice.page.waitForTimeout(800);
  await shot(alice, name);
  // Target the VISIBLE sheet: `ion-modal` alone also matches teardown husks, and
  // dismissing one of those leaves the real sheet up to eat the next click.
  await alice.page.locator('ion-modal.show-modal').evaluate((m) => m.dismiss());
  await alice.page.waitForTimeout(700);
};
await openTierRow(0, 'us1-sheet-seen-by');
await openTierRow(1, 'us1-sheet-delivered');

// Erin joins AFTER the send. She is not on this message's roster, so the tiers
// must not grow — this is the regression the rewrite fixes.
await go(alice, `/chat/${trip}`);
await alice.page.evaluate(
  (args) => window.__ringTest.addMemberToGroup(args.chat, args.who),
  { chat: trip, who: erin.id },
);
await new Promise((r) => setTimeout(r, 1500));
await openInfo(alice);
await shot(alice, 'us1-info-after-late-joiner');

const after = await alice.page.evaluate((id) => window.__ringTest.messageReceipts(id), mid);
console.log(
  after.length === receipts.length
    ? `OK: roster still ${after.length} after a late joiner`
    : `REGRESSION: roster grew ${receipts.length} -> ${after.length}`,
);

await sweep([alice, bob, carol, dave, erin]);
await done();
