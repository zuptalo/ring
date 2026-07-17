/**
 * DEV-ONLY showcase seeder. Injects a curated, deterministic demo dataset
 * (contacts with real portrait avatars, 1:1 + group chats with real photos/video/
 * album/voice, a call log, and a Wall feed) straight into IndexedDB so the
 * screenshot harness (showcase/capture.spec.ts) can capture a rich, realistic app
 * state from a single account — without a real second device.
 *
 * Messages are normally crypto-bound to the Double Ratchet, so this writes the
 * rendered records directly; the ratchet desync is irrelevant because a showcase
 * session never sends another real message. Imported only by the dev-only test
 * hook (testhook.ts), so it is tree-shaken out of production builds entirely.
 *
 * Real media (avatars/photos/video/voice) is supplied by the caller as data URLs —
 * see capture.spec.ts, which reads showcase/media/ (gitignored) off disk and hands
 * it in through window.__ringTest.seedShowcase(assets). This module has no
 * knowledge of the filesystem; it just turns data URLs into Blobs.
 */
import { bulkPut, remove } from '@/db/idb';
import { uid } from '@/utils/uid';
import { getSelfUserId } from '@/services/auth';
import type { Call, Chat, Contact, Media, Message, Post, PostEngagement } from '@/db/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

export interface ShowcaseAssets {
  avatars: { alice: string; daniel: string; sofia: string; mom: string; tomas: string };
  photos: { cocktail: string; pastry: string; arena1: string; arena2: string };
  video: { dataUrl: string; poster: string; durationSec: number; width: number; height: number };
  voice: { dataUrl: string; durationSec: number };
}

interface SeedPerson {
  id: string;
  name: string;
  username?: string;
  about: string;
  avatar: string; // data URL
}

function people(assets: ShowcaseAssets): SeedPerson[] {
  return [
    { id: 'sc-alice', name: 'Alice Rivera', username: 'alice', about: 'Designer. Mountain person. ⛰️', avatar: assets.avatars.alice },
    { id: 'sc-daniel', name: 'Daniel Okafor', username: 'daniel', about: 'Coffee → code → repeat.', avatar: assets.avatars.daniel },
    { id: 'sc-sofia', name: 'Sofia Lindqvist', username: 'sofia', about: 'Photographer 📷', avatar: assets.avatars.sofia },
    { id: 'sc-mom', name: 'Mom', about: '', avatar: assets.avatars.mom },
    { id: 'sc-tomas', name: 'Tomás García', username: 'tomas', about: 'Always planning the next trip.', avatar: assets.avatars.tomas },
  ];
}

// One transaction + one change-bus notification per store, not one per row: a loop of
// individual put()s fired a burst of rapid-fire 'messages' notifications no real send/
// receive flow (or e2e test) ever produces, which reconciled the freshly-mounted chat
// mid-burst and corrupted its first paint (duplicate bubbles) once a chat held more
// than 2 messages. bulkPut collapses that whole burst into a single settle.
async function putAll<T>(store: 'contacts' | 'chats' | 'messages' | 'media' | 'calls' | 'posts' | 'postEngagement', rows: T[]): Promise<void> {
  if (rows.length) await bulkPut(store, rows as never[]);
}

async function addMedia(
  media: Media[],
  kind: Media['kind'],
  mime: string,
  name: string,
  dataUrl: string,
  now: number,
  extra: Partial<Media> = {},
): Promise<string> {
  const blob = await dataUrlToBlob(dataUrl);
  const id = uid();
  media.push({ id, kind, mime, name, size: blob.size, blob, updatedAt: now, ...extra });
  return id;
}

/** Build one message record with sensible defaults. `from` is a person id for an
 *  incoming message, or 'me' for an outgoing one. */
function message(
  chatId: string,
  from: string,
  fromName: string,
  body: string,
  ageMs: number,
  now: number,
  extra: Partial<Message> = {},
): Message {
  const outgoing = from === 'me';
  return {
    id: uid(),
    chatId,
    senderId: outgoing ? 'me' : from,
    senderName: outgoing ? 'You' : fromName,
    body,
    kind: 'text',
    timestamp: now - ageMs,
    outgoing,
    status: 'seen',
    // Demo history reads as already-read, not freshly arrived — an incoming row
    // seeded with no seenReportedAt makes the mount-time "mark seen" write touch
    // every one of them at once, which currently corrupts the message list's
    // first paint (see showcase/README.md's known-bug note).
    seenReportedAt: outgoing ? undefined : now,
    updatedAt: now,
    ...extra,
  };
}

export async function seedShowcase(assets: ShowcaseAssets): Promise<void> {
  const now = Date.now();
  const self = getSelfUserId() ?? 'me';
  const PEOPLE = people(assets);
  const byId = (id: string): SeedPerson => PEOPLE.find((p) => p.id === id)!;

  // --- Contacts (real portrait avatars) ----------------------------------------
  const contacts: Contact[] = PEOPLE.map((p) => ({
    id: p.id,
    name: p.name,
    username: p.username,
    avatar: p.avatar,
    phone: '',
    about: p.about,
    updatedAt: now,
  }));
  await putAll('contacts', contacts);

  const messages: Message[] = [];
  const media: Media[] = [];
  const msg = (chatId: string, from: string, body: string, ageMs: number, extra: Partial<Message> = {}) =>
    message(chatId, from, from === 'me' ? 'You' : byId(from).name, body, ageMs, now, extra);

  // --- Alice: the rich, pinned conversation we open for the chat-detail shot ---
  // Deliberately just 2 messages here: ChatDetailPage corrupts its first paint when
  // a chat's cold mount loads 3+ messages at once (a real Vue bug, isolated and
  // documented in showcase/README.md's "Known bug" section — independent of media/
  // reactions/replies/write-batching). The rest of this conversation is appended
  // live by seedAliceFollowup() below, AFTER capture.spec.ts has already navigated
  // into the chat — matching how a real conversation accumulates messages one at a
  // time instead of bulk-loading a whole history before the first paint, which
  // reconcile()'s incremental-append path handles correctly.
  messages.push(
    msg('sc-alice', 'sc-alice', 'Morning! Did you try the new Ring update? 🎉', 2 * HOUR),
    msg('sc-alice', 'me', 'Yes! The "What’s new" sheet is such a nice touch', 110 * MIN, { status: 'seen' }),
  );

  // --- Daniel: a coffee-run photo, then short + unread -------------------------
  const pastryId = await addMedia(media, 'image', 'image/jpeg', 'coffee-run.jpg', assets.photos.pastry, now);
  messages.push(
    msg('sc-daniel', 'sc-daniel', 'Are we still on for tomorrow?', 3 * HOUR),
    msg('sc-daniel', 'sc-daniel', 'Fuel before the standup ☕', 90 * MIN, { kind: 'image', mediaId: pastryId }),
    msg('sc-daniel', 'sc-daniel', 'Let me know 🙏', 50 * MIN),
  );

  // --- Mom: favorite ---
  messages.push(msg('sc-mom', 'sc-mom', 'Call me when you get a chance ❤️', 5 * HOUR));

  // --- Sofia: a photo from tonight's shoot ---
  const arena1Id = await addMedia(media, 'image', 'image/jpeg', 'golden-hour.jpg', assets.photos.arena1, now);
  messages.push(msg('sc-sofia', 'sc-sofia', 'Chasing golden hour again 📷', 7 * HOUR, { kind: 'image', mediaId: arena1Id }));

  // --- Group: Weekend Trip — an album (2 photos) + a video message -------------
  const groupMembers = ['sc-alice', 'sc-daniel', 'sc-sofia'];
  const albumArena1Id = await addMedia(media, 'image', 'image/jpeg', 'city-1.jpg', assets.photos.arena1, now);
  const albumArena2Id = await addMedia(media, 'image', 'image/jpeg', 'city-2.jpg', assets.photos.arena2, now);
  const albumId = 'sc-album-arena';
  const dogMediaId = await addMedia(media, 'video', 'video/mp4', 'trail-friend.mp4', assets.video.dataUrl, now, {
    durationSec: assets.video.durationSec,
    posterBlob: await dataUrlToBlob(assets.video.poster),
  });

  const myMsg = msg('sc-trip', 'me', "Perfect, I’ll bring snacks 🍫", 4 * HOUR, {
    status: 'seen',
    reactions: [{ userId: 'sc-sofia', emoji: '👍', at: now - 3.5 * HOUR }],
  });
  messages.push(
    msg('sc-trip', 'sc-alice', "Who’s driving on Saturday?", 5 * HOUR),
    msg('sc-trip', 'sc-daniel', 'I can! 🚗 room for 3', 4.5 * HOUR),
    msg('sc-trip', 'sc-alice', 'The city glowed like this last time 🌆', 4.2 * HOUR, {
      kind: 'image',
      mediaId: albumArena1Id,
      albumId,
      mediaWidth: 1600,
      mediaHeight: 1067,
    }),
    msg('sc-trip', 'sc-alice', '', 4.2 * HOUR - 1000, {
      kind: 'image',
      mediaId: albumArena2Id,
      albumId,
      mediaWidth: 1600,
      mediaHeight: 900,
    }),
    myMsg,
    msg('sc-trip', 'sc-daniel', 'Made a friend on the trail last time 🐶', 3 * HOUR, {
      kind: 'video',
      mediaId: dogMediaId,
      durationSec: assets.video.durationSec,
      mediaWidth: assets.video.width,
      mediaHeight: assets.video.height,
      posterData: assets.video.poster,
    }),
    msg('sc-trip', 'sc-sofia', 'Can’t wait! 🏔️', 2 * HOUR),
  );

  await putAll('messages', messages);

  // --- Chats (previews + ordering) -------------------------------------------
  const chat = (over: Partial<Chat> & Pick<Chat, 'id' | 'name' | 'avatar' | 'isGroup' | 'participantIds' | 'lastMessage' | 'lastMessageTime'>): Chat => ({
    unread: 0,
    updatedAt: now,
    ...over,
  });
  const chats: Chat[] = [
    chat({
      id: 'sc-alice', name: 'Alice Rivera', avatar: assets.avatars.alice, isGroup: false,
      participantIds: ['sc-alice'], lastMessage: 'The rooftop bar downtown 😄 we should go together',
      lastMessageTime: now - 28 * MIN, pinned: true, favorite: true,
    }),
    chat({
      id: 'sc-daniel', name: 'Daniel Okafor', avatar: assets.avatars.daniel, isGroup: false,
      participantIds: ['sc-daniel'], lastMessage: 'Let me know 🙏', lastMessageTime: now - 50 * MIN, unread: 2,
    }),
    chat({
      id: 'sc-trip', name: 'Weekend Trip 🏔️', avatar: assets.photos.arena1, isGroup: true,
      participantIds: groupMembers, lastMessage: 'Sofia: Can’t wait! 🏔️', lastKind: 'text',
      lastMessageTime: now - 2 * HOUR, autoName: false,
    }),
    chat({
      id: 'sc-sofia', name: 'Sofia Lindqvist', avatar: assets.avatars.sofia, isGroup: false,
      participantIds: ['sc-sofia'], lastMessage: '📷 Photo', lastKind: 'image', lastMessageTime: now - 7 * HOUR,
    }),
    chat({
      id: 'sc-mom', name: 'Mom', avatar: assets.avatars.mom, isGroup: false,
      participantIds: ['sc-mom'], lastMessage: 'Call me when you get a chance ❤️', lastMessageTime: now - 5 * HOUR,
      favorite: true,
    }),
  ];
  await putAll('chats', chats);

  // --- Call log ---------------------------------------------------------------
  const calls: Call[] = [
    { id: uid(), contactId: 'sc-alice', name: 'Alice Rivera', avatar: assets.avatars.alice, direction: 'incoming', missed: false, video: true, durationSec: 754, timestamp: now - 90 * MIN, updatedAt: now },
    { id: uid(), contactId: 'sc-trip', name: 'Weekend Trip 🏔️', avatar: assets.photos.arena1, direction: 'outgoing', missed: false, video: false, durationSec: 1325, timestamp: now - 6 * HOUR, updatedAt: now, isGroup: true, roomId: 'sc-trip', participants: ['Alice Rivera', 'Daniel Okafor'] },
    { id: uid(), contactId: 'sc-mom', name: 'Mom', avatar: assets.avatars.mom, direction: 'incoming', missed: true, video: false, timestamp: now - 1 * DAY, updatedAt: now },
    { id: uid(), contactId: 'sc-daniel', name: 'Daniel Okafor', avatar: assets.avatars.daniel, direction: 'outgoing', missed: false, video: false, durationSec: 96, timestamp: now - 2 * DAY, updatedAt: now },
  ];
  await putAll('calls', calls);

  // --- Wall: a photo post, an album post, and a video post --------------------
  const wallArena1Id = await addMedia(media, 'image', 'image/jpeg', 'wall-golden-hour.jpg', assets.photos.arena1, now);
  const wallArena2Id = await addMedia(media, 'image', 'image/jpeg', 'wall-city-2.jpg', assets.photos.arena2, now);
  const wallDogId = await addMedia(media, 'video', 'video/mp4', 'wall-trail-friend.mp4', assets.video.dataUrl, now, {
    durationSec: assets.video.durationSec,
    posterBlob: await dataUrlToBlob(assets.video.poster),
  });
  await putAll('media', media);

  const posts: Post[] = [
    {
      id: 'sc-post-sofia', author: 'sc-sofia', kind: 'image', body: 'Chasing golden hour again 📷',
      mediaId: wallArena1Id, mediaW: 1600, mediaH: 1067, createdAt: now - 6 * HOUR, outgoing: false, updatedAt: now,
    },
    {
      id: 'sc-post-album', author: self, kind: 'image', body: 'One more look before we left 🌆',
      mediaId: wallArena1Id, mediaIds: [wallArena1Id, wallArena2Id], mediaW: 1600, mediaH: 1067,
      audience: 'friends', createdAt: now - 4 * HOUR, outgoing: true, updatedAt: now,
    },
    {
      id: 'sc-post-dog', author: self, kind: 'video', body: 'He tagged along for the whole hike 🐶',
      mediaId: wallDogId, mediaW: assets.video.width, mediaH: assets.video.height,
      audience: 'close', createdAt: now - 2 * HOUR, outgoing: true, updatedAt: now,
    },
  ];
  await putAll('posts', posts);

  const engagement: PostEngagement[] = [
    { id: `sc-post-sofia:reaction:${self}`, postId: 'sc-post-sofia', type: 'reaction', actor: self, emoji: '😍', at: now - 5.5 * HOUR, updatedAt: now },
    { id: 'sc-post-album:reaction:sc-daniel', postId: 'sc-post-album', type: 'reaction', actor: 'sc-daniel', emoji: '🔥', at: now - 3.5 * HOUR, updatedAt: now },
    { id: 'sc-post-album:reaction:sc-sofia', postId: 'sc-post-album', type: 'reaction', actor: 'sc-sofia', emoji: '😍', at: now - 3.4 * HOUR, updatedAt: now },
    {
      id: 'sc-post-dog:comment:sc-alice', postId: 'sc-post-dog', type: 'comment', actor: 'sc-alice',
      text: 'so cute!! 😍', actorName: 'Alice Rivera', actorAvatar: assets.avatars.alice, at: now - 100 * MIN, updatedAt: now,
    },
    { id: 'sc-post-dog:reaction:sc-sofia', postId: 'sc-post-dog', type: 'reaction', actor: 'sc-sofia', emoji: '🐾', at: now - 95 * MIN, updatedAt: now },
  ];
  await putAll('postEngagement', engagement);
}

/** The rest of Alice's conversation (voice message, photo with a reaction, a reply
 *  to it, and the closing text) — call once ChatDetailPage is already open on
 *  '/chat/sc-alice' (see seedShowcase's comment on why this is split out). Fixed
 *  message ids make repeat calls (the capture loop revisits the chat once per
 *  theme) an idempotent overwrite rather than growing duplicate rows. */
export async function seedAliceFollowup(assets: ShowcaseAssets): Promise<void> {
  const now = Date.now();
  const media: Media[] = [];
  const cocktailId = await addMedia(media, 'image', 'image/jpeg', 'sunset.jpg', assets.photos.cocktail, now);
  const voiceId = await addMedia(media, 'voice', 'audio/mp4', 'voice.m4a', assets.voice.dataUrl, now, {
    durationSec: assets.voice.durationSec,
  });
  await putAll('media', media);

  const aliceImgId = 'sc-alice-img';
  const messages: Message[] = [
    {
      ...message('sc-alice', 'sc-alice', 'Alice Rivera', 'Voice message', 90 * MIN, now, {
        kind: 'voice', mediaId: voiceId, durationSec: assets.voice.durationSec,
      }),
      id: 'sc-alice-voice',
    },
    {
      ...message('sc-alice', 'me', 'Alice Rivera', 'Sunset toast to Friday 🍹', 40 * MIN, now, {
        kind: 'image', mediaId: cocktailId, status: 'seen',
        reactions: [{ userId: 'sc-alice', emoji: '❤️', at: now - 35 * MIN }],
      }),
      id: aliceImgId,
    },
    {
      ...message('sc-alice', 'sc-alice', 'Alice Rivera', 'Cheers! Where was this?', 30 * MIN, now, {
        replyTo: { id: aliceImgId, senderId: 'me', preview: 'Sunset toast to Friday 🍹', kind: 'image' },
      }),
      id: 'sc-alice-reply',
    },
    {
      ...message('sc-alice', 'me', 'Alice Rivera', 'The rooftop bar downtown 😄 we should go together', 28 * MIN, now, {
        status: 'delivered',
      }),
      id: 'sc-alice-rooftop',
    },
  ];
  await putAll('messages', messages);
}

/** Undo seedAliceFollowup — back to the known-safe 2-message state, for
 *  capture.spec.ts to retry the append from if it lands on the corrupted paint. */
export async function clearAliceFollowup(): Promise<void> {
  for (const id of ['sc-alice-voice', 'sc-alice-img', 'sc-alice-reply', 'sc-alice-rooftop']) {
    await remove('messages', id);
  }
}
