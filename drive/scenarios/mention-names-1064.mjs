/**
 * Spec 1064 — an @mention of a DOTTED handle must resolve: render as the person's name, be
 * tappable, and (the part that actually matters) register in the message's `mentions` array so
 * the mention notification fires at all.
 *
 * Before the fix the handle charset stopped at the dot, so `@parham.hoseini` matched only
 * `parham`, resolved to nobody, rendered as raw text — and stored an EMPTY mentions array, which
 * is what marks the frame as a mention. The mentioned person was never notified.
 *
 * Also checks that a LOCAL RENAME wins, since that is the name you know someone by.
 *
 *   node drive/scenarios/mention-names-1064.mjs
 */
import { createAccount, pair, group, poll, shot, sweep, done } from '../driver.mjs';

// Handles are claimed for good on the dev directory, so keep them unique per run — while
// preserving the SHAPES under test: one with a DOT, one with underscore+digits.
const n = String(Date.now()).slice(-6);
const dotted = `parham.hoseini${n}`;
const plain = `ashk_1989_${n}`;

const alice = await createAccount({ name: 'Alice' }); // desktop: Enter sends
const parham = await createAccount({ name: 'Parham', username: dotted });
const ashkan = await createAccount({ name: 'Ashkan', username: plain });

await pair(alice, parham);
await pair(alice, ashkan);
const gid = await group(alice, 'Family', [parham, ashkan]);

// Handles hydrate from the directory in the background; mentions resolve BY handle, so wait for
// both to land before composing (the picker is likewise empty until then).
for (const c of [parham, ashkan]) {
  await poll(
    () => alice.page.evaluate((id) => window.__ringTest.contactUsername(id), c.id),
    (u) => !!u,
    { timeout: 20_000, label: `${c.label} handle hydrated on Alice` },
  );
}

// Alice renames Parham locally — a mention must show HER name for him, not the directory one.
await alice.page.evaluate((id) => window.__ringTest.setContactLocalProfile(id, 'Dadi'), parham.id);

// Send through the REAL composer — resolveMentions (the fix) lives in the chat page, so a
// testhook send would bypass exactly what we are verifying.
await alice.page.goto(`/chat/${gid}`);
await alice.page.waitForSelector('ion-textarea.composer', { timeout: 15_000 });
await alice.page.waitForTimeout(600);
await alice.page.locator('ion-textarea.composer').click();
await alice.page.keyboard.type(`salam @${dotted} and @${plain}`);
await alice.page.waitForTimeout(300);
await alice.page.keyboard.press('Enter');

// 1) The STORED mentions array must contain BOTH ids — this is what drives the mention
//    notification, the mute-piercing frame class and the "@" badge.
const stored = await poll(
  () => alice.page.evaluate((g) => window.__ringTest.messages(g), gid),
  (ms) => ms.some((m) => (m.body ?? '').includes('salam @')),
  { timeout: 20_000, label: 'message stored' },
);
const sent = stored.find((m) => (m.body ?? '').includes('salam @'));
const ids = sent.mentions ?? [];
console.log('[1064] stored mentions:', ids.length, 'of 2 expected');
if (!ids.includes(parham.id)) throw new Error('FAIL: the DOTTED handle did not register a mention');
if (!ids.includes(ashkan.id)) throw new Error('FAIL: the underscore handle regressed');

// 2) The bubble must render NAMES, not handles — and the local rename must win.
await alice.page.waitForTimeout(1500);
const chips = await alice.page.evaluate(() =>
  Array.from(document.querySelectorAll('.mention')).map((e) => e.textContent?.trim()),
);
const bodyText = await alice.page.evaluate(() =>
  Array.from(document.querySelectorAll('.bubble')).map((e) => e.textContent?.trim()).join(' | '),
);
console.log('[1064] mention chips rendered:', JSON.stringify(chips));
if (!chips.includes('@Dadi')) throw new Error(`FAIL: local rename not used — chips were ${JSON.stringify(chips)}`);
if (!chips.includes('@Ashkan')) throw new Error(`FAIL: control mention missing — ${JSON.stringify(chips)}`);
if (bodyText.includes(dotted) || bodyText.includes(plain)) throw new Error('FAIL: a raw handle is still on screen');

// 3) Parham's device must see itself mentioned (the notification/badge precondition).
const his = await poll(
  () => parham.page.evaluate((g) => window.__ringTest.messages(g), gid),
  (ms) => ms.some((m) => (m.body ?? '').includes('salam @')),
  { timeout: 20_000, label: 'delivered to Parham' },
);
const hisCopy = his.find((m) => (m.body ?? '').includes('salam @'));
if (!(hisCopy.mentions ?? []).includes(parham.id)) {
  throw new Error('FAIL: the recipient copy does not carry the mention');
}
console.log('[1064] recipient copy carries the mention ✓');

console.log('[1064] PASS — dotted handle mentions resolve, render by local name, and notify ✓');
await shot(alice, 'mention-names-1064', { route: `/chat/${gid}` });

await sweep([alice, parham, ashkan]);
await done();
