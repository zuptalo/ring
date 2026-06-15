/**
 * DEV-ONLY showcase seeder. Injects a curated, deterministic demo dataset
 * (contacts, 1:1 + group chats, both-sided messages with reactions/replies/media,
 * and a call log) straight into IndexedDB so the screenshot harness
 * (showcase/capture.spec.ts) can capture a rich, realistic app state from a single
 * account — without a real second device.
 *
 * Messages are normally crypto-bound to the Double Ratchet, so this writes the
 * rendered records directly; the ratchet desync is irrelevant because a showcase
 * session never sends another real message. Imported only by the dev-only test
 * hook (testhook.ts), so it is tree-shaken out of production builds entirely.
 */
import { put } from '@/db/idb';
import { initialsAvatar, groupAvatar } from '@/db/avatars';
import { uid } from '@/utils/uid';
import type { Call, Chat, Contact, Media, Message } from '@/db/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Draw a soft gradient "photo" on a canvas and return it as a JPEG blob, so image
 *  bubbles render an actual picture rather than a broken thumbnail. */
async function gradientPhoto(c1: string, c2: string): Promise<Blob> {
  const w = 1080;
  const h = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // A soft sun + a horizon band, enough to read as a landscape photo.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(w * 0.72, h * 0.28, w * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, h * 0.66, w, h * 0.34);
  return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85));
}

interface SeedPerson {
  id: string;
  name: string;
  username?: string;
  about: string;
}

const PEOPLE: SeedPerson[] = [
  { id: 'sc-alice', name: 'Alice Rivera', username: 'alice', about: 'Designer. Mountain person. ⛰️' },
  { id: 'sc-daniel', name: 'Daniel Okafor', username: 'daniel', about: 'Coffee → code → repeat.' },
  { id: 'sc-sofia', name: 'Sofia Lindqvist', username: 'sofia', about: 'Photographer 📷' },
  { id: 'sc-mom', name: 'Mom', about: '' },
  { id: 'sc-tomas', name: 'Tomás García', username: 'tomas', about: 'Always planning the next trip.' },
];

const byId = (id: string): SeedPerson => PEOPLE.find((p) => p.id === id)!;

/** Build one message record with sensible defaults. `from` is a person id for an
 *  incoming message, or 'me' for an outgoing one. */
function message(
  chatId: string,
  from: string,
  body: string,
  ageMs: number,
  extra: Partial<Message> = {},
): Message {
  const outgoing = from === 'me';
  return {
    id: uid(),
    chatId,
    senderId: outgoing ? 'me' : from,
    senderName: outgoing ? 'You' : byId(from).name,
    body,
    kind: 'text',
    timestamp: Date.now() - ageMs,
    outgoing,
    status: 'read',
    updatedAt: Date.now(),
    ...extra,
  };
}

async function putAll<T>(store: 'contacts' | 'chats' | 'messages' | 'media' | 'calls', rows: T[]): Promise<void> {
  for (const row of rows) await put(store, row as never);
}

export async function seedShowcase(): Promise<void> {
  const now = Date.now();

  // --- Contacts ---------------------------------------------------------------
  const contacts: Contact[] = PEOPLE.map((p) => ({
    id: p.id,
    name: p.name,
    username: p.username,
    avatar: initialsAvatar(p.name),
    phone: '',
    about: p.about,
    updatedAt: now,
  }));
  await putAll('contacts', contacts);

  const messages: Message[] = [];
  const media: Media[] = [];

  // --- Alice: the rich, pinned conversation we open for the chat-detail shot ---
  const photoBlob = await gradientPhoto('#fda085', '#f6d365');
  const photoId = uid();
  media.push({
    id: photoId,
    kind: 'image',
    mime: 'image/jpeg',
    name: 'sunrise.jpg',
    size: photoBlob.size,
    blob: photoBlob,
    updatedAt: now,
  });
  const voiceBlob = new Blob([new Uint8Array(4096)], { type: 'audio/ogg' });
  const voiceId = uid();
  media.push({ id: voiceId, kind: 'voice', mime: 'audio/ogg', name: 'voice.ogg', size: voiceBlob.size, blob: voiceBlob, durationSec: 12, updatedAt: now });

  const aliceImg = message('sc-alice', 'me', 'Sunrise from the hike this morning ⛰️', 40 * MIN, {
    kind: 'image',
    mediaId: photoId,
    status: 'read',
    reactions: [{ userId: 'sc-alice', emoji: '❤️', at: now - 35 * MIN }],
  });
  messages.push(
    message('sc-alice', 'sc-alice', 'Morning! Did you try the new Ring update? 🎉', 2 * HOUR),
    message('sc-alice', 'me', 'Yes! The "What’s new" sheet is such a nice touch', 110 * MIN, { status: 'read' }),
    message('sc-alice', 'sc-alice', 'Voice message', 90 * MIN, { kind: 'voice', mediaId: voiceId, durationSec: 12 }),
    aliceImg,
    message('sc-alice', 'sc-alice', 'Gorgeous! Where is this?', 30 * MIN, {
      replyTo: { id: aliceImg.id, senderId: 'me', preview: 'Sunrise from the hike this morning ⛰️', kind: 'image' },
    }),
    message('sc-alice', 'me', 'The ridge above the lake 😄 we should go together', 28 * MIN, { status: 'delivered' }),
  );

  // --- Daniel: short, unread ---
  messages.push(
    message('sc-daniel', 'sc-daniel', 'Are we still on for tomorrow?', 3 * HOUR),
    message('sc-daniel', 'sc-daniel', 'Let me know 🙏', 50 * MIN),
  );

  // --- Mom: favorite ---
  messages.push(message('sc-mom', 'sc-mom', 'Call me when you get a chance ❤️', 5 * HOUR));

  // --- Sofia: a photo preview ---
  const photo2 = await gradientPhoto('#a1c4fd', '#c2e9fb');
  const photo2Id = uid();
  media.push({ id: photo2Id, kind: 'image', mime: 'image/jpeg', name: 'harbor.jpg', size: photo2.size, blob: photo2, updatedAt: now });
  messages.push(
    message('sc-sofia', 'sc-sofia', 'From the shoot today 📷', 7 * HOUR, { kind: 'image', mediaId: photo2Id }),
  );

  // --- Group: Weekend Trip ---
  const groupMembers = ['sc-alice', 'sc-daniel', 'sc-sofia'];
  const myMsg = message('sc-trip', 'me', "Perfect, I’ll bring snacks 🍫", 4 * HOUR, {
    status: 'read',
    reactions: [{ userId: 'sc-sofia', emoji: '👍', at: now - 3.5 * HOUR }],
  });
  messages.push(
    message('sc-trip', 'sc-alice', "Who’s driving on Saturday?", 5 * HOUR),
    message('sc-trip', 'sc-daniel', 'I can! 🚗 room for 3', 4.5 * HOUR),
    myMsg,
    message('sc-trip', 'sc-sofia', 'Can’t wait! 🏔️', 2 * HOUR),
  );

  await putAll('messages', messages);
  await putAll('media', media);

  // --- Chats (previews + ordering) -------------------------------------------
  const chat = (over: Partial<Chat> & Pick<Chat, 'id' | 'name' | 'avatar' | 'isGroup' | 'participantIds' | 'lastMessage' | 'lastMessageTime'>): Chat => ({
    unread: 0,
    updatedAt: now,
    ...over,
  });
  const chats: Chat[] = [
    chat({
      id: 'sc-alice', name: 'Alice Rivera', avatar: initialsAvatar('Alice Rivera'), isGroup: false,
      participantIds: ['sc-alice'], lastMessage: 'The ridge above the lake 😄 we should go together',
      lastMessageTime: now - 28 * MIN, pinned: true, favorite: true,
    }),
    chat({
      id: 'sc-daniel', name: 'Daniel Okafor', avatar: initialsAvatar('Daniel Okafor'), isGroup: false,
      participantIds: ['sc-daniel'], lastMessage: 'Let me know 🙏', lastMessageTime: now - 50 * MIN, unread: 2,
    }),
    chat({
      id: 'sc-trip', name: 'Weekend Trip 🏔️', avatar: groupAvatar('sc-trip'), isGroup: true,
      participantIds: groupMembers, lastMessage: 'Sofia: Can’t wait! 🏔️', lastKind: 'text',
      lastMessageTime: now - 2 * HOUR, autoName: false,
    }),
    chat({
      id: 'sc-sofia', name: 'Sofia Lindqvist', avatar: initialsAvatar('Sofia Lindqvist'), isGroup: false,
      participantIds: ['sc-sofia'], lastMessage: '📷 Photo', lastKind: 'image', lastMessageTime: now - 7 * HOUR,
    }),
    chat({
      id: 'sc-mom', name: 'Mom', avatar: initialsAvatar('Mom'), isGroup: false,
      participantIds: ['sc-mom'], lastMessage: 'Call me when you get a chance ❤️', lastMessageTime: now - 5 * HOUR,
      favorite: true,
    }),
  ];
  await putAll('chats', chats);

  // --- Call log ---------------------------------------------------------------
  const calls: Call[] = [
    { id: uid(), contactId: 'sc-alice', name: 'Alice Rivera', avatar: initialsAvatar('Alice Rivera'), direction: 'incoming', missed: false, video: true, durationSec: 754, timestamp: now - 90 * MIN, updatedAt: now },
    { id: uid(), contactId: 'sc-trip', name: 'Weekend Trip 🏔️', avatar: groupAvatar('sc-trip'), direction: 'outgoing', missed: false, video: false, durationSec: 1325, timestamp: now - 6 * HOUR, updatedAt: now, isGroup: true, roomId: 'sc-trip', participants: ['Alice Rivera', 'Daniel Okafor'] },
    { id: uid(), contactId: 'sc-mom', name: 'Mom', avatar: initialsAvatar('Mom'), direction: 'incoming', missed: true, video: false, timestamp: now - 1 * DAY, updatedAt: now },
    { id: uid(), contactId: 'sc-daniel', name: 'Daniel Okafor', avatar: initialsAvatar('Daniel Okafor'), direction: 'outgoing', missed: false, video: false, durationSec: 96, timestamp: now - 2 * DAY, updatedAt: now },
  ];
  await putAll('calls', calls);
}
