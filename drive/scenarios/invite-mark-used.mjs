// Verify: an invite code that someone redeems is cleared from the "Invited"
// (waiting) list even if the invitee never finishes setting up their profile.
// Previously the placeholder was held until the invitee published a photo, so a
// registered-but-unfinished invitee left the code stuck as "Waiting to join"
// forever and you had to remove it by hand.
//
//   Alice creates an invite, Bob registers with it but sets NO profile (no photo),
//   Alice sweeps → the code must leave her waiting list.
//
// Run against the live `make start` stack:  node drive/scenarios/invite-mark-used.mjs
import { createAccount, newClient, poll, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const code = await alice.page.evaluate(() => window.__ringTest.createInvite('Mom'));
console.log('invite code:', code);

const before = await alice.page.evaluate(() => window.__ringTest.pendingInviteCodes());
if (!before.includes(code)) throw new Error('setup: code not in waiting list after createInvite');
console.log('waiting list before redeem:', before);

// Bob registers with Alice's code but deliberately never sets a profile → no
// directory avatar, i.e. the "unfinished invitee" the old code got stuck on.
const bob = await newClient({ label: 'Bob' });
await bob.page.goto('/');
await bob.page.waitForFunction(() => !!window.__ringTest, null, { timeout: 30_000 });
await bob.page.evaluate(async (c) => {
  const t = window.__ringTest;
  await t.register(c);
  await t.createAuto();
}, code);
await poll(() => bob.page.evaluate(() => window.__ringTest.isUnlocked()), (v) => v === true, { label: 'Bob unlocked' });
console.log('Bob registered with the code (no profile set)');

// Alice sweeps redemptions: the redeemed code must clear from the waiting list.
await poll(
  async () => {
    await alice.page.evaluate(() => window.__ringTest.syncInvites());
    return alice.page.evaluate(() => window.__ringTest.pendingInviteCodes());
  },
  (codes) => !codes.includes(code),
  { label: 'Alice clears the redeemed invite', timeout: 20_000 },
);

console.log('\n  ✅ redeemed invite cleared from the waiting list even though the invitee has no profile\n');
await done();
