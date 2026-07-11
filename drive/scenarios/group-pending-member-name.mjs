// Verify: a group co-member the viewer shares NO direct 1:1 with still renders with
// their real name + avatar in the group — not a raw id. Repro of "some users show as
// 88155153 with a blank avatar" (Azin).
//
//   node drive/scenarios/group-pending-member-name.mjs
//
// Root cause: sending into a group creates a HIDDEN pending 1:1 "session carrier" for
// every co-member you haven't DM'd (memberSessionChat). listContacts() drops pending
// peers, so the group view — which used to resolve senders through listContacts() —
// lost that member's contact and fell back to the id. Bob owns a group with Alice and
// Carol; Alice and Carol never pair, so on Alice's device Carol is a pending carrier.
import { createAccount, pair, group, say, waitForMessage, shot, sweep } from '../driver.mjs';

const alice = await createAccount({ mobile: true, name: 'Alice', label: 'alice' });
const bob = await createAccount({ name: 'Bob', label: 'bob' });
const carol = await createAccount({ name: 'Carol', label: 'carol' });

// Bob (owner) knows both; Alice and Carol are strangers to each other.
await pair(bob, alice);
await pair(bob, carol);

const gid = await group(bob, 'Trip', [alice, carol]);

// Alice sends first → creates the hidden pending session-carrier chats for Bob AND
// Carol on her device, which is what makes listContacts() hide Carol.
await say(alice, gid, 'hi team', { isGroup: true });
await say(carol, gid, 'hey from Carol', { isGroup: true });
await waitForMessage(alice, gid, 'hey from Carol', { isGroup: true });

// Prove the bug CONDITION is present on Alice's device: Carol's contact exists and is
// named (unfiltered read), yet listContacts() hides her (pending session carrier).
await alice.page.waitForTimeout(500);
const carolName = await alice.page.evaluate((id) => window.__ringTest.contactName(id), carol.id);
const filteredIds = await alice.page.evaluate(() => window.__ringTest.contactIds());
console.log(`[check] Alice's contactName(Carol) = ${JSON.stringify(carolName)} (expect "Carol")`);
console.log(`[check] listContacts() includes Carol? ${filteredIds.includes(carol.id)} (expect false — she's a hidden pending carrier)`);

// Open the group on Alice and screenshot: Carol's message must show "Carol", not her id.
await alice.page.goto(`/chat/${gid}`);
await alice.page.waitForTimeout(2500);
await shot(alice, 'group-pending-member-name');

console.log('Screenshot .tmp/drive/group-pending-member-name.png: Carol’s message must be headed "Carol" with an avatar, not a raw id.');
await sweep([alice, bob, carol]);
