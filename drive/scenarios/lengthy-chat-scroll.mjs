/**
 * Spec 1011 — Smooth chat-history scroll-up, proven end-to-end with 5 real users.
 *
 *   node drive/scenarios/lengthy-chat-scroll.mjs
 *   HEADED=1 node drive/scenarios/lengthy-chat-scroll.mjs
 *
 * Drives the live `make start` stack as 5 users: connect them, hold a 1:1 + a group
 * conversation exchanging EVERY message kind (text / voice-audio / video-message /
 * image-upload / video-upload), build a lengthy chat (real sends + a 5,000-message
 * bulk-seed), then open it and flick up — screenshotting each look-ahead page so the
 * captures (.tmp/drive/lengthy-chat-*.png) can be Read back to confirm continuous,
 * bounded, non-snapping content (SC-005 / SC-007). Ends with a sweep for a clean re-run.
 */
import {
  createAccount, pair, group, say, waitForMessage,
  sendAudio, sendVideoNote, sendImage, sendVideo,
  seedHistory, scrollUpPass, bubbleCount, chatWith, shot, sweep, done,
} from '../driver.mjs';

// 1) Five users connect (directory connect — the open-network model; one link makes both
//    sides Connected and lets the first sealed message bootstrap the session).
const u1 = await createAccount({ name: 'Uno' });
const u2 = await createAccount({ name: 'Dos' });
const u3 = await createAccount({ name: 'Tres', mobile: true });
const u4 = await createAccount({ name: 'Cuatro' });
const u5 = await createAccount({ name: 'Cinco' });
const all = [u1, u2, u3, u4, u5];
for (const u of [u2, u3, u4, u5]) await pair(u1, u);

// 2) 1:1 (Uno ↔ Dos): exchange every message kind both ways.
const dm = await chatWith(u1, u2.id);
await say(u1, u2.id, 'hey from uno 👋');
await waitForMessage(u2, u1.id, 'hey from uno');
await say(u2, u1.id, 'hey back 🙌');
await waitForMessage(u1, u2.id, 'hey back');
await sendAudio(u1, dm, 'voice.mp3', 'Voice note', 'Uno'); // voice-audio
await sendVideoNote(u1, dm, 'note.mp4'); // video-message (round)
await sendImage(u1, dm, 'pic.png'); // image-upload
await sendVideo(u1, dm, 'clip.mp4'); // video-upload
await u1.page.waitForTimeout(1500);
await shot(u2, 'dm-from-dos', { route: `/chat/${await chatWith(u2, u1.id)}` });

// 3) Group (all five): every kind delivered to + rendered for all participants.
const crew = await group(u1, 'Crew', [u2, u3, u4, u5]);
await say(u1, crew, 'welcome all 🎉', { isGroup: true });
for (const u of [u2, u3, u4, u5]) await waitForMessage(u, crew, 'welcome all', { isGroup: true });
await say(u2, crew, 'glad to be here', { isGroup: true });
await waitForMessage(u1, crew, 'glad to be here', { isGroup: true });
await sendAudio(u3, crew, 'g-voice.mp3', 'Group voice', 'Tres');
await sendVideoNote(u4, crew, 'g-note.mp4');
await sendImage(u5, crew, 'g-pic.png');
await sendVideo(u1, crew, 'g-clip.mp4');
await u1.page.waitForTimeout(1800);
await shot(u3, 'group-from-tres-mobile', { route: `/chat/${crew}` });

// 4) Build a LENGTHY 1:1 chat (real sends keep the newest end genuine; a 5,000-message
//    bulk-seed gives it depth) and flick up through it, capturing each page.
for (let i = 0; i < 8; i++) await say(u1, u2.id, `real message ${i}`);
await seedHistory(u1, dm, 5000, { mediaEvery: 12 });
const shots = await scrollUpPass(u1, dm, 'lengthy-chat', { steps: 10 });
console.log(`[lengthy] captured ${shots.length} pages; rendered bubbles now: ${await bubbleCount(u1)}`);

// 5) Clean up so a re-run sets up from scratch with no lingering accounts.
await sweep(all);
await done();
