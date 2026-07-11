// Verify: an animated emoji avatar (a fly-in/out Noto emoji like the running shoe)
// rests on the fully-formed native glyph after its play-cap, NOT on a blank Lottie
// frame. Repro of the "empty purple disc once the animation ends" bug.
//
//   node drive/scenarios/emoji-avatar-rest.mjs
//
// Bob sets the running-shoe emoji avatar; Alice pairs with him and views her chat
// list, where Bob's avatar animates twice (the default cap) then parks. We wait past
// the animation and screenshot — the disc must show the shoe, not an empty circle.
import { createAccount, pair, chatWith, shot, sweep } from '../driver.mjs';

const alice = await createAccount({ mobile: true, name: 'Alice', label: 'alice' });
const bob = await createAccount({ mobile: true, name: 'Bob', label: 'bob' });

// Bob picks the running-shoe emoji avatar (1f45f) — its Lottie flies the shoe in
// AND out of frame, so both the first and last frames are blank. The old code
// parked on frame 0 → an empty disc. publishOwnProfile() lands it in the directory.
await bob.page.evaluate(() => window.__ringTest.setEmojiAvatar('\u{1F45F}'));

await pair(alice, bob);
// Confirm Alice actually received Bob's shoe avatar before the render check is meaningful.
await bob.page.waitForTimeout(300);
await alice.page.evaluate((id) => window.__ringTest.importDirectoryUser(id), bob.id);
const got = await alice.page.evaluate((id) => window.__ringTest.contactAvatarEmoji(id), bob.id);
console.log(`[check] Alice sees Bob avatar emoji: ${JSON.stringify(got)} (expect "👟")`);

// Full-load the chat list (re-runs the auth gate past the onboarding recovery step),
// then let Bob's avatar animate its two loops and rest. Lottie load (server proxy →
// gstatic) + 2 loops (~2s each) + margin.
await alice.page.goto('/tabs/chats');
await alice.page.waitForTimeout(10_000);
await shot(alice, 'emoji-avatar-rest');

console.log('Screenshot .tmp/drive/emoji-avatar-rest.png: Bob’s disc must show the shoe, not an empty circle.');
await sweep([alice, bob]);
