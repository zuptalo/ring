/**
 * Read/write/search operations over the on-device stores. Search is plain
 * substring matching done in-memory, fine for on-device data sizes and works
 * across every field we care about. Swap for an indexed FTS later if needed.
 */
import { bulkPut, clearStore, get, getAll, getByIndex, put, remove } from './idb';
import { enqueue, removeOutboxByFrameId } from './outbox';
import { recordTombstone } from './tombstones';
import { uid } from '@/utils/uid';
import { initialsAvatar, groupAvatar, ghostAvatar } from '@/db/avatars';
import { fetchUserStatuses, blockUser, unblockUser, fetchBlocks, fetchDirectoryUser, cancelInvitation } from '@/services/api';
import { sealForChat, openPacket } from '@/services/messaging';
import { prepareOutgoingMedia, receiveIncomingMedia, getMaxBlobBytes, BlobUploadError } from '@/services/media-transfer';
import { getSecret, setSecret } from '@/db/secrets';
import { isUnlockedNow } from '@/services/crypto/identity';
import { getSelfUserId, getSelfUsername } from '@/services/auth';
import { notifyIncoming, isChatActive } from '@/services/notify';
import { compressImage, compressVideo } from '@/services/media-encode';
import { setCompressProgress, setUploadProgress, resetJobProgress, clearJobProgress } from '@/services/media-jobs';
import { readVideoMeta, readImageMeta, generateVideoPoster } from '@/utils/media-meta';
import { notifyPreview } from '@/utils/notify-preview';
import type {
  MessagePayload, ContactCard, GroupCard, GroupMember, ReactionSignal, PollVoteSignal, MediaRef,
} from '@/services/crypto/message';
import type {
  Alert, Call, Chat, Contact, FriendRequest, Media, Message, MessageKind, Reaction, ReplyRef,
  GeoLocation, Poll, PollVote, SharedContact, AudioMeta, Setting,
} from './types';

const now = () => Date.now();
const matches = (haystack: string, q: string) =>
  haystack.toLowerCase().includes(q.trim().toLowerCase());

/* ---- chats ---- */

export async function listChats(q = ''): Promise<Chat[]> {
  const chats = (await getAll<Chat>('chats')).filter((c) => !c.pending);
  const filtered = q
    ? chats.filter((c) => matches(c.name, q) || matches(c.lastMessage, q))
    : chats;
  return filtered.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
}

export function getChat(id: string): Promise<Chat | undefined> {
  return get<Chat>('chats', id);
}

/** Clear a chat's unread counter (called when the conversation is opened). */
export async function markChatRead(chatId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (chat && chat.unread) {
    chat.unread = 0;
    chat.updatedAt = now();
    await put('chats', chat);
  }
}

/* ---- messages ---- */

export async function listMessages(chatId: string, q = ''): Promise<Message[]> {
  const msgs = await getByIndex<Message>('messages', 'chatId', chatId);
  const filtered = q ? msgs.filter((m) => matches(m.body, q)) : msgs;
  return filtered.sort((a, b) => a.timestamp - b.timestamp);
}

export function getMessage(id: string): Promise<Message | undefined> {
  return get<Message>('messages', id);
}

/** Append a locally-authored message (starts `pending`) and update the chat.
 *  `replyTo` quotes another message above this one. */
export async function sendMessage(chatId: string, body: string, replyTo?: ReplyRef): Promise<void> {
  const ts = now();
  const chat = await getChat(chatId);
  await guardOutbound(chat);
  const message: Message = {
    id: uid(),
    chatId,
    senderId: 'me',
    senderName: 'You',
    body,
    kind: 'text',
    timestamp: ts,
    outgoing: true,
    status: 'pending',
    receipts: chat?.isGroup
      ? chat.participantIds.map((contactId) => ({ contactId }))
      : undefined,
    replyTo,
    updatedAt: ts,
  };
  await put('messages', message);

  if (chat) {
    chat.lastMessage = body;
    chat.lastKind = 'text';
    chat.lastMessageTime = ts;
    chat.unread = 0;
    chat.interactions = (chat.interactions ?? 0) + 1;
    chat.updatedAt = ts;
    await put('chats', chat);
  }

  // Seal the message (E2EE) and hand it to the sync engine; receipts advance the
  // status. Group chats fan out to each member over their 1:1 session.
  const payload: MessagePayload = { body, kind: 'text', timestamp: ts, reply: replyTo };
  if (chat?.isGroup) await sealAndEnqueueGroup(chat, message.id, payload);
  else await sealAndEnqueue(chat, message.id, payload);
}

/** Seal a payload for the chat's peer and enqueue it for relay, if possible. */
async function sealAndEnqueue(
  chat: Chat | undefined,
  messageId: string,
  payload: MessagePayload,
): Promise<void> {
  const peerUserId = chat?.participantIds[0];
  if (!chat || !peerUserId) return;
  try {
    const sealed = await sealForChat(chat.id, peerUserId, chat.isGroup, payload);
    if (sealed) await enqueue({ t: 'msg', id: messageId, to: sealed.to, ciphertext: sealed.packet });
    else if (!chat.isGroup) await detectTerminated(peerUserId); // no bundle → maybe deleted
  } catch (e) {
    console.warn('[messaging] seal/enqueue failed; message stays pending', e);
  }
}

/** When a 1:1 seal fails for lack of a key bundle (404), the peer may have
 *  terminated their account. Confirm via /v1/status before ghosting; a 404 also
 *  happens for a no-keys/demo contact ('unknown') or when they've blocked us
 *  ('active'), neither of which should be mislabeled "Ghosted". Exported so a chat
 *  can re-check the peer on open (an established ratchet session keeps sealing
 *  successfully after the peer terminates, so the send path alone won't notice). */
export async function detectTerminated(peerUserId: string): Promise<void> {
  if (await isContactGhosted(peerUserId)) return;
  let statuses: Record<string, 'active' | 'terminated' | 'unknown'>;
  try {
    statuses = await fetchUserStatuses([peerUserId]);
  } catch {
    return;
  }
  if (statuses[peerUserId] === 'terminated') await markContactGhosted(peerUserId);
}

/* ---- groups (pairwise fan-out over 1:1 sessions) ---- */

/**
 * The (hidden) 1:1 chat id used as the Double-Ratchet session container to reach
 * a group co-member. Reuses a real 1:1 chat if one exists; otherwise creates a
 * pending (hidden) one, so co-members don't clutter the chat list, and a
 * session is bootstrapped on demand (sealForChat does X3DH from their bundle).
 */
async function memberSessionChat(memberId: string): Promise<string | null> {
  let contact = await getContact(memberId);
  if (!contact) {
    await addContactWithId(memberId, '');
    contact = await getContact(memberId);
  }
  if (!contact) return null;
  const chats = await getAll<Chat>('chats');
  const existing = chats.find(
    (c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === memberId,
  );
  if (existing) return existing.id;
  const id = uid();
  await put<Chat>('chats', {
    id,
    name: contact.name,
    avatar: contact.avatar,
    isGroup: false,
    participantIds: [memberId],
    lastMessage: '',
    lastMessageTime: now(),
    unread: 0,
    pending: true, // hidden: this exists only as a session carrier
    updatedAt: now(),
  });
  return id;
}

/** Fan a payload out to every group member over their 1:1 session, tagging it
 *  with the group id so recipients route it to the group chat. All copies share
 *  the message id. */
async function sealAndEnqueueGroup(
  chat: Chat,
  messageId: string,
  payload: MessagePayload,
): Promise<void> {
  for (const member of chat.participantIds) {
    try {
      // Don't seal to a member who has left the network (ghosted) or whom we've
      // blocked; the rest of the group still receives the message.
      if ((await isContactGhosted(member)) || (await isPeerBlocked(member))) continue;
      const memberChat = await memberSessionChat(member);
      if (!memberChat) continue;
      const sealed = await sealForChat(memberChat, member, false, { ...payload, groupId: chat.id });
      if (sealed) await enqueue({ t: 'msg', id: messageId, to: sealed.to, ciphertext: sealed.packet });
    } catch (e) {
      console.warn('[group] seal/enqueue to member failed', member, e);
    }
  }
}

/** Send a group membership control card to each listed member over their 1:1
 *  session (applied as a side effect on receipt, never shown as a message). */
async function sendGroupCard(members: string[], card: GroupCard): Promise<void> {
  for (const member of members) {
    try {
      const memberChat = await memberSessionChat(member);
      if (!memberChat) continue;
      const sealed = await sealForChat(memberChat, member, false, {
        body: '',
        kind: 'group',
        timestamp: now(),
        group: card,
      });
      if (sealed) await enqueue({ t: 'msg', id: uid(), to: sealed.to, ciphertext: sealed.packet });
    } catch (e) {
      console.warn('[group] send card to member failed', member, e);
    }
  }
}

/* ---- reactions ---- */

/** Apply a reaction change to a message in place (shared by local + inbound).
 *  One reaction per user: a new emoji replaces the prior one; `at` resolves
 *  out-of-order updates so a stale frame can't override a newer choice. */
function applyReaction(
  message: Message,
  userId: string,
  emoji: string,
  remove: boolean,
  at: number,
): void {
  const list = message.reactions ?? [];
  const existing = list.find((r) => r.userId === userId);
  if (existing && existing.at > at) return; // stale update, ignore
  const next: Reaction[] = list.filter((r) => r.userId !== userId);
  if (!remove) next.push({ userId, emoji, at });
  message.reactions = next;
  message.updatedAt = now();
}

/** Toggle the local user's reaction on a message and propagate it to the chat
 *  (the peer for 1:1, every member for a group). Re-reacting with the same emoji
 *  clears it; a different emoji replaces it. Works on your own messages too. */
export async function reactToMessage(messageId: string, emoji: string): Promise<void> {
  const message = await getMessage(messageId);
  if (!message) return;
  const self = getSelfUserId() ?? '';
  const mine = (message.reactions ?? []).find((r) => r.userId === self);
  const remove = mine?.emoji === emoji; // tapping your current emoji clears it
  const at = now();
  applyReaction(message, self, emoji, remove, at);
  await put('messages', message);
  if (!remove) void recordEmojiUse(emoji); // most-used drives the quick-react order

  const chat = await getChat(message.chatId);
  if (!chat) return;
  // Surface the reaction in the chats list (WhatsApp-style), like a new activity.
  if (!remove) {
    chat.lastMessage = `You reacted ${emoji} to "${previewText(message)}"`;
    chat.lastKind = 'reaction';
    chat.lastMessageTime = at;
    chat.updatedAt = at;
    await put('chats', chat);
  }
  const reaction: ReactionSignal = { messageId, emoji, remove, at };
  const payload: MessagePayload = { body: '', kind: 'reaction', timestamp: at, reaction };
  if (chat.isGroup) await sealAndEnqueueGroup(chat, uid(), payload);
  else await sealAndEnqueue(chat, uid(), payload);
}

/** Apply an inbound reaction from `from` to the target message (side effect,
 *  never a stored message). */
async function handleReaction(from: string, signal: ReactionSignal): Promise<void> {
  const message = await getMessage(signal.messageId);
  if (!message) return; // we don't have that message (yet), drop it
  applyReaction(message, from, signal.emoji, !!signal.remove, signal.at);
  await put('messages', message);

  if (!signal.remove) {
    const chat = await getChat(message.chatId);
    if (chat) {
      const name = (await getContact(from))?.name ?? 'Someone';
      chat.lastMessage = `${name.split(' ')[0]} reacted ${signal.emoji} to "${previewText(message)}"`;
      chat.lastKind = 'reaction';
      chat.lastMessageTime = signal.at;
      chat.updatedAt = signal.at;
      await put('chats', chat);
    }
  }
}

/* ---- location / poll / contact ---- */

/** A plain outgoing-message scaffold shared by the location/poll/contact sends. */
function newOutgoing(chat: Chat | undefined, chatId: string, kind: MessageKind, ts: number): Message {
  return {
    id: uid(),
    chatId,
    senderId: 'me',
    senderName: 'You',
    body: '',
    kind,
    timestamp: ts,
    outgoing: true,
    status: 'pending',
    receipts: chat?.isGroup ? chat.participantIds.map((contactId) => ({ contactId })) : undefined,
    updatedAt: ts,
  };
}

/** Seal + relay an outgoing payload (1:1 peer or group fan-out). */
function enqueueMessage(chat: Chat | undefined, messageId: string, payload: MessagePayload): Promise<void> {
  return chat?.isGroup ? sealAndEnqueueGroup(chat, messageId, payload) : sealAndEnqueue(chat, messageId, payload);
}

/** Reject an outbound message to a 1:1 peer who is ghosted (account terminated)
 *  or blocked. Throws 'ghosted' / 'blocked' so the caller can surface it; the
 *  composer is also disabled in these states, so this is mainly a backstop (and
 *  the gate for forward/share paths). Group chats are unaffected here; ghosted /
 *  blocked members are skipped during fan-out instead. */
async function guardOutbound(chat: Chat | undefined): Promise<void> {
  const peer = chat && !chat.isGroup ? chat.participantIds[0] : undefined;
  if (!peer) return;
  // chat.ghosted survives the contact being removed from the address book.
  if (chat?.ghosted || (await isContactGhosted(peer))) throw new Error('ghosted');
  if (await isPeerBlocked(peer)) throw new Error('blocked');
}

/** Update a chat's list preview after an outgoing non-text message. */
async function bumpOutgoing(chat: Chat | undefined, kind: Chat['lastKind'], preview: string, ts: number): Promise<void> {
  if (!chat) return;
  chat.lastMessage = preview;
  chat.lastKind = kind;
  chat.lastMessageTime = ts;
  chat.unread = 0;
  chat.interactions = (chat.interactions ?? 0) + 1;
  chat.updatedAt = ts;
  await put('chats', chat);
}

/** Share the user's current location into a chat. */
export async function sendLocation(chatId: string, loc: GeoLocation, replyTo?: ReplyRef): Promise<void> {
  const ts = now();
  const chat = await getChat(chatId);
  await guardOutbound(chat);
  const message = newOutgoing(chat, chatId, 'location', ts);
  message.location = loc;
  message.replyTo = replyTo;
  await put('messages', message);
  await bumpOutgoing(chat, 'location', loc.label || 'Location', ts);
  await enqueueMessage(chat, message.id, { body: '', kind: 'location', timestamp: ts, location: loc, reply: replyTo });
}

/** Create and share a poll (votes start empty and fill in via vote signals). */
export async function sendPoll(
  chatId: string,
  question: string,
  options: string[],
  multi: boolean,
  replyTo?: ReplyRef,
): Promise<void> {
  const ts = now();
  const chat = await getChat(chatId);
  await guardOutbound(chat);
  const poll: Poll = { question, options, multi, votes: [] };
  const message = newOutgoing(chat, chatId, 'poll', ts);
  message.poll = poll;
  message.replyTo = replyTo;
  await put('messages', message);
  await bumpOutgoing(chat, 'poll', question, ts);
  await enqueueMessage(chat, message.id, {
    body: '',
    kind: 'poll',
    timestamp: ts,
    poll: { question, options, multi, votes: [] },
    reply: replyTo,
  });
}

/** Share a Ring contact (from the sender's own contacts) into a chat. */
export async function sendContact(chatId: string, contact: SharedContact, replyTo?: ReplyRef): Promise<void> {
  const ts = now();
  const chat = await getChat(chatId);
  await guardOutbound(chat);
  const message = newOutgoing(chat, chatId, 'contact', ts);
  message.contact = contact;
  message.replyTo = replyTo;
  await put('messages', message);
  await bumpOutgoing(chat, 'contact', contact.name, ts);
  await enqueueMessage(chat, message.id, { body: '', kind: 'contact', timestamp: ts, contact, reply: replyTo });
}

/** Ensure a shared contact exists locally and open a direct chat with them. */
export async function messageSharedContact(shared: SharedContact): Promise<string> {
  await addContactWithId(shared.userId, shared.name);
  const contact = await getContact(shared.userId);
  if (!contact) return '';
  let changed = false;
  if (shared.name && contact.name !== shared.name) {
    contact.name = shared.name;
    changed = true;
  }
  if (shared.avatar && contact.avatar !== shared.avatar) {
    contact.avatar = shared.avatar;
    changed = true;
  }
  if (changed) {
    contact.updatedAt = now();
    await put('contacts', contact);
  }
  return startDirectChat(contact);
}

/** Apply a poll-vote change in place (shared by local + inbound). Single-choice
 *  polls keep one vote per user; multi-choice polls toggle each option. */
function applyPollVote(message: Message, userId: string, option: number, remove: boolean, at: number): void {
  if (!message.poll) return;
  let votes = message.poll.votes ?? [];
  const prior = votes.find((v) => v.userId === userId && v.option === option);
  if (prior && prior.at > at) return; // stale update, ignore
  if (message.poll.multi) {
    votes = votes.filter((v) => !(v.userId === userId && v.option === option));
  } else {
    votes = votes.filter((v) => v.userId !== userId); // single choice, replace
  }
  if (!remove) votes.push({ userId, option, at } as PollVote);
  message.poll.votes = votes;
  message.updatedAt = now();
}

/** Toggle the local user's vote on a poll option and propagate it to the chat. */
export async function votePoll(messageId: string, option: number): Promise<void> {
  const message = await getMessage(messageId);
  if (!message?.poll) return;
  const self = getSelfUserId() ?? '';
  const has = (message.poll.votes ?? []).some((v) => v.userId === self && v.option === option);
  const at = now();
  applyPollVote(message, self, option, has, at); // tapping your current choice clears it
  await put('messages', message);
  const chat = await getChat(message.chatId);
  const signal: PollVoteSignal = { messageId, option, remove: has, at };
  await enqueueMessage(chat, uid(), { body: '', kind: 'pollvote', timestamp: at, pollVote: signal });
}

/** Apply an inbound poll vote from `from` (side effect, never a stored message). */
async function handlePollVote(from: string, signal: PollVoteSignal): Promise<void> {
  const message = await getMessage(signal.messageId);
  if (!message?.poll) return;
  applyPollVote(message, from, signal.option, !!signal.remove, signal.at);
  await put('messages', message);
}

/* ---- single-message actions (delete / favorite / caption) ---- */

/** Delete a message locally (and its media blob). */
export async function deleteMessage(messageId: string): Promise<void> {
  const m = await getMessage(messageId);
  if (!m) return;
  if (m.mediaId) await remove('media', m.mediaId);
  await remove('messages', messageId);
}

/** Soft-delete: keep the row but replace its content with a "deleted" marker
 *  (local-only; the placeholder shows in place of the message). */
export async function softDeleteMessage(messageId: string): Promise<void> {
  const m = await getMessage(messageId);
  if (!m) return;
  if (m.mediaId) await remove('media', m.mediaId);
  m.deleted = true;
  m.body = '';
  m.mediaId = undefined;
  m.reactions = undefined;
  m.replyTo = undefined;
  m.albumName = undefined;
  m.updatedAt = now();
  await put('messages', m);
}

/** Toggle the local "starred/favorite" flag on a message; returns the new state. */
export async function toggleFavorite(messageId: string): Promise<boolean> {
  const m = await getMessage(messageId);
  if (!m) return false;
  m.favorite = !m.favorite;
  m.updatedAt = now();
  await put('messages', m);
  return !!m.favorite;
}

/** Forward a message (text or media) to one or more chats. Creates fresh
 *  messages in each target (the media blob is re-sent). */
export async function forwardMessage(messageId: string, chatIds: string[]): Promise<void> {
  const m = await getMessage(messageId);
  if (!m) return;
  for (const cid of chatIds) {
    // Skip a target whose 1:1 peer is ghosted or blocked (the others still get it).
    const target = await getChat(cid);
    const peer = target && !target.isGroup ? target.participantIds[0] : undefined;
    if (peer && ((await isContactGhosted(peer)) || (await isPeerBlocked(peer)))) continue;
    if (m.mediaId && (m.kind === 'image' || m.kind === 'video' || m.kind === 'file' || m.kind === 'voice')) {
      const media = await get<Media>('media', m.mediaId);
      if (media) {
        await sendMediaMessage(cid, m.kind, media.blob, media.name, m.durationSec, {
          videoNote: m.videoNote,
        });
      }
    } else if (m.kind === 'location' && m.location) {
      await sendLocation(cid, m.location);
    } else if (m.kind === 'poll' && m.poll) {
      await sendPoll(cid, m.poll.question, m.poll.options, m.poll.multi);
    } else if (m.kind === 'contact' && m.contact) {
      await sendContact(cid, m.contact);
    } else {
      await sendMessage(cid, m.body);
    }
  }
}

/** Set/replace a media message's caption (its body). Local-only for now. */
export async function setCaption(messageId: string, text: string): Promise<void> {
  const m = await getMessage(messageId);
  if (!m) return;
  m.body = text;
  m.updatedAt = now();
  await put('messages', m);
}

/* ---- conversation media/links/docs (the "All media" browser) ---- */

const URL_RE = /\bhttps?:\/\/[^\s]+/i;

/** All image/video messages in a chat, newest-first. */
export async function listChatMedia(chatId: string): Promise<Message[]> {
  const all = await listMessages(chatId);
  return all.filter((m) => m.kind === 'image' || m.kind === 'video').reverse();
}
/** All file (document) messages in a chat, newest-first. */
export async function listChatDocs(chatId: string): Promise<Message[]> {
  return (await listMessages(chatId)).filter((m) => m.kind === 'file').reverse();
}
/** All text messages containing a link, newest-first. */
export async function listChatLinks(chatId: string): Promise<Message[]> {
  return (await listMessages(chatId)).filter((m) => m.kind === 'text' && URL_RE.test(m.body)).reverse();
}

/** Build a roster (id + display name) from our contacts + own profile. */
async function buildRoster(ids: string[]): Promise<GroupMember[]> {
  const self = getSelfUserId() ?? '';
  const selfName = await getSecret('profileName', 'You');
  const out: GroupMember[] = [];
  for (const id of ids) {
    if (id === self) {
      out.push({ id, name: selfName });
    } else {
      const c = await getContact(id);
      out.push({ id, name: c?.name ?? id.slice(0, 8) });
    }
  }
  return out;
}

const firstName = (n: string) => (n.split(/\s+/)[0] || n).trim();

/** Default group name from the other members' names: "Fredi & Ailin", "A, B & C",
 *  or "Kambiz & 6 more" when too long. */
function deriveGroupName(names: string[]): string {
  const firsts = names.map(firstName).filter(Boolean);
  if (firsts.length === 0) return 'Group';
  if (firsts.length === 1) return firsts[0];
  if (firsts.length === 2) return `${firsts[0]} & ${firsts[1]}`;
  const full = `${firsts.slice(0, -1).join(', ')} & ${firsts[firsts.length - 1]}`;
  return full.length <= 28 ? full : `${firsts[0]} & ${firsts.length - 1} more`;
}

/** Auto display name for a group from its roster (excluding self). */
function autoDisplayName(roster: GroupMember[], self: string): string {
  return deriveGroupName(roster.filter((m) => m.id !== self).map((m) => m.name));
}

/** Build the roster card reflecting the chat's current name/avatar state. */
function groupCard(
  chat: Chat,
  t: GroupCard['t'],
  roster: GroupMember[],
  at: number,
): GroupCard {
  return {
    t,
    groupId: chat.id,
    name: chat.autoName ? '' : chat.name, // empty → recipients auto-derive
    avatar: chat.customAvatar ? chat.avatar : undefined, // only propagate custom photos
    members: roster,
    at,
  };
}

/**
 * Create a group. The name is OPTIONAL: when empty, the display name is derived
 * from the members ("Fredi & Ailin" / "Kambiz & 6 more") per each viewer's
 * perspective, and a default group icon is used. Returns the group chat id.
 */
export async function createGroup(name: string, memberIds: string[]): Promise<string> {
  const self = getSelfUserId() ?? '';
  const groupId = uid();
  const ts = now();
  const custom = name.trim();
  const roster = await buildRoster([self, ...memberIds]);
  await put<Chat>('chats', {
    id: groupId,
    name: custom || autoDisplayName(roster, self),
    avatar: groupAvatar(groupId),
    isGroup: true,
    participantIds: memberIds.slice(),
    lastMessage: '',
    lastMessageTime: ts,
    unread: 0,
    rosterAt: ts,
    autoName: !custom,
    customAvatar: false,
    updatedAt: ts,
  });
  await sendGroupCard(memberIds, {
    t: 'create',
    groupId,
    name: custom,
    members: roster,
    at: ts,
  });
  return groupId;
}

/** Re-derive an auto-named group's display name after a roster change. */
function applyAutoName(chat: Chat, roster: GroupMember[], self: string): void {
  if (chat.autoName) chat.name = autoDisplayName(roster, self);
}

/** Add a contact to a group and broadcast the new roster to everyone. */
export async function addToGroup(chatId: string, memberId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat?.isGroup || chat.participantIds.includes(memberId)) return;
  const self = getSelfUserId() ?? '';
  const ts = now();
  chat.participantIds = [...chat.participantIds, memberId];
  const roster = await buildRoster([self, ...chat.participantIds]);
  applyAutoName(chat, roster, self);
  chat.rosterAt = ts;
  chat.updatedAt = ts;
  await put('chats', chat);
  await sendGroupCard(chat.participantIds, groupCard(chat, 'update', roster, ts));
}

/**
 * Invite a contact to an existing group (accept-first). Unlike addToGroup they
 * do NOT join immediately: they're tracked in `chat.invitedIds` (never
 * `participantIds`, so the fan-out in sealAndEnqueueGroup skips them and no
 * pre-join history is ever sent), and sent an 'invite' card. They become a real
 * member only when their 'accept' card arrives (handled in handleGroupCard).
 * Any member may invite (parity with addToGroup). Works for a directory member
 * we've never chatted with; sendGroupCard establishes the 1:1 session on the fly.
 */
export async function inviteToGroup(chatId: string, memberId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat?.isGroup) return;
  const self = getSelfUserId() ?? '';
  if (!memberId || memberId === self || chat.participantIds.includes(memberId)) return;
  const invited = chat.invitedIds ?? [];
  if (!invited.includes(memberId)) {
    chat.invitedIds = [...invited, memberId];
    chat.updatedAt = now();
    await put('chats', chat);
  }
  const ts = now();
  // The invite shows the invitee the roster they'd be joining (current members +
  // the inviter + themselves), so build it from participantIds + the invitee.
  const roster = await buildRoster([self, ...chat.participantIds, memberId]);
  await sendGroupCard([memberId], { ...groupCard(chat, 'invite', roster, ts), inviter: self });
}

/** Accept a group invitation (id `ginv:<groupId>`): create the group chat NOW
 *  from the invite's roster snapshot (with lastMessageTime = now and no stored
 *  messages, so pre-join history can't exist locally), then tell the inviter
 *  (who moves us into the live roster and re-broadcasts an 'update' to everyone). */
export async function acceptGroupInvite(groupId: string): Promise<void> {
  const reqId = `ginv:${groupId}`;
  const r = await get<FriendRequest>('requests', reqId);
  if (!r) return;
  const self = getSelfUserId() ?? '';
  const ts = now();
  const roster = r.roster ?? [];
  for (const m of roster) {
    if (!m.id || m.id === self) continue;
    if (!(await getContact(m.id))) await addContactWithId(m.id, m.name);
  }
  if (!(await getChat(groupId))) {
    const participantIds = roster.map((m) => m.id).filter((id) => id !== self);
    await put<Chat>('chats', {
      id: groupId,
      name: r.name || autoDisplayName(roster, self),
      avatar: r.avatar || groupAvatar(groupId),
      isGroup: true,
      participantIds,
      lastMessage: '',
      lastMessageTime: ts,
      unread: 0,
      rosterAt: ts,
      autoName: !r.name,
      customAvatar: !!r.avatar && r.avatar !== groupAvatar(groupId),
      updatedAt: ts,
    });
  }
  if (r.inviter) {
    await sendGroupCard([r.inviter], { t: 'accept', groupId, name: '', members: roster, at: ts });
  }
  await dropRequest(reqId);
}

/** Decline a group invitation: tell the inviter (so they drop us from the pending
 *  set) and clear the local invitation. No group chat is created. */
export async function declineGroupInvite(groupId: string): Promise<void> {
  const reqId = `ginv:${groupId}`;
  const r = await get<FriendRequest>('requests', reqId);
  const ts = now();
  if (r?.inviter) {
    await sendGroupCard([r.inviter], { t: 'decline', groupId, name: '', members: [], at: ts });
  }
  await dropRequest(reqId);
}

/** Incoming, still-pending group invitations (drive the Contacts "Invitations"
 *  list). Separate from friend requests via the `kind` discriminator. */
export async function listGroupInvites(): Promise<FriendRequest[]> {
  const reqs = await getAll<FriendRequest>('requests');
  return reqs
    .filter((r) => r.kind === 'group-invite' && r.status === 'pending')
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Remove a member; notifies the remaining members AND the removed one (who'll
 *  see they're no longer in the roster and drop the group). */
export async function removeMember(chatId: string, memberId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat?.isGroup) return;
  // Cancelling a still-pending invite (the invitee never joined): just drop them
  // from invitedIds and signal them to clear the invitation. No roster broadcast.
  if (!chat.participantIds.includes(memberId)) {
    if (chat.invitedIds?.includes(memberId)) {
      chat.invitedIds = chat.invitedIds.filter((id) => id !== memberId);
      chat.updatedAt = now();
      await put('chats', chat);
      await sendGroupCard([memberId], { t: 'decline', groupId: chat.id, name: '', members: [], at: now() });
    }
    return;
  }
  const self = getSelfUserId() ?? '';
  const ts = now();
  chat.participantIds = chat.participantIds.filter((id) => id !== memberId);
  const roster = await buildRoster([self, ...chat.participantIds]);
  applyAutoName(chat, roster, self);
  chat.rosterAt = ts;
  chat.updatedAt = ts;
  await put('chats', chat);
  await sendGroupCard([...chat.participantIds, memberId], groupCard(chat, 'update', roster, ts));
}

/** Set a custom group name ('' reverts to the auto-derived name). */
export async function renameGroup(chatId: string, name: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat?.isGroup) return;
  const self = getSelfUserId() ?? '';
  const ts = now();
  const custom = name.trim();
  const roster = await buildRoster([self, ...chat.participantIds]);
  chat.autoName = !custom;
  chat.name = custom || autoDisplayName(roster, self);
  chat.rosterAt = ts;
  chat.updatedAt = ts;
  await put('chats', chat);
  await sendGroupCard(chat.participantIds, groupCard(chat, 'update', roster, ts));
}

/** Set a custom group photo (data URL); propagates to all members. */
export async function setGroupAvatar(chatId: string, dataUrl: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat?.isGroup) return;
  const self = getSelfUserId() ?? '';
  const ts = now();
  chat.avatar = await downscaleAvatar(dataUrl);
  chat.customAvatar = true;
  chat.rosterAt = ts;
  chat.updatedAt = ts;
  await put('chats', chat);
  const roster = await buildRoster([self, ...chat.participantIds]);
  await sendGroupCard(chat.participantIds, groupCard(chat, 'update', roster, ts));
}

/** Revert a group to the default icon; propagates to all members. */
export async function clearGroupAvatar(chatId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat?.isGroup) return;
  const self = getSelfUserId() ?? '';
  const ts = now();
  chat.avatar = groupAvatar(chatId);
  chat.customAvatar = false;
  chat.rosterAt = ts;
  chat.updatedAt = ts;
  await put('chats', chat);
  const roster = await buildRoster([self, ...chat.participantIds]);
  await sendGroupCard(chat.participantIds, groupCard(chat, 'update', roster, ts));
}

/** Leave a group: tell the others, then remove it locally. */
export async function leaveGroup(chatId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat?.isGroup) return;
  const self = getSelfUserId() ?? '';
  await sendGroupCard(chat.participantIds, {
    t: 'leave',
    groupId: chatId,
    name: chat.autoName ? '' : chat.name,
    members: await buildRoster([self]),
    at: now(),
  });
  // Tombstone (delete messages + session + record a tombstone) like deleteChat, so a
  // still-in-flight 'update' card, a redelivered group message, or an ownSync/pull
  // can't resurrect the group we just left; the old code only remove()'d the row.
  await deleteChat(chatId);
}

const durLabel = (sec?: number) =>
  sec ? ` (${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')})` : '';

/** Chats-list preview text for a media message (label + duration). The chats
 *  list pairs this with an Ionic icon derived from `previewKind`, so no emoji. */
function mediaPreview(kind: string, durationSec?: number, name?: string, videoNote?: boolean): string {
  if (kind === 'voice') return `Voice message${durLabel(durationSec)}`;
  if (kind === 'video') return videoNote ? `Video note${durLabel(durationSec)}` : 'Video';
  if (kind === 'image') return 'Photo';
  if (kind === 'audio') return name && name !== 'attachment' ? name : 'Audio';
  if (kind === 'file') return `${name && name !== 'attachment' ? name : 'Document'}`;
  return 'Attachment';
}

/** The icon category for the chats-list preview of a (possibly media) message. */
function previewKind(kind: string, albumName?: string, videoNote?: boolean): Chat['lastKind'] {
  if (albumName) return 'album';
  if (kind === 'video') return videoNote ? 'videonote' : 'video';
  if (kind === 'image' || kind === 'voice' || kind === 'file' || kind === 'audio') return kind;
  if (kind === 'location' || kind === 'poll' || kind === 'contact') return kind;
  return 'text';
}

/** Short snapshot of a message's content, for quotes / reaction previews. */
function previewText(m: Message): string {
  if (m.body) return m.body.length > 28 ? `${m.body.slice(0, 28)}…` : m.body;
  if (m.kind === 'location') return m.location?.label || 'Location';
  if (m.kind === 'poll') return m.poll?.question || 'Poll';
  if (m.kind === 'contact') return m.contact?.name || 'Contact';
  return mediaPreview(m.kind, m.durationSec, undefined, m.videoNote);
}

/** Store a media Blob on-device and send it as a message. Photos/videos chosen
 *  at SD/HD are compressed by a background job (status 'compressing') so the UI
 *  never blocks; everything else uploads inline. */
export async function sendMediaMessage(
  chatId: string,
  kind: 'image' | 'video' | 'file' | 'voice' | 'audio',
  blob: Blob,
  name: string,
  durationSec?: number,
  opts?: {
    replyTo?: ReplyRef;
    albumId?: string;
    albumName?: string;
    videoNote?: boolean;
    audio?: AudioMeta;
    quality?: 'sd' | 'hd' | 'original';
  },
): Promise<void> {
  const ts = now();
  await guardOutbound(await getChat(chatId)); // reject before storing media for a ghosted/blocked peer
  const mediaId = uid();
  // The original blob is stored; the (possibly compressed) blob is uploaded.
  await put<Media>('media', {
    id: mediaId,
    kind,
    mime: blob.type || 'application/octet-stream',
    name,
    size: blob.size,
    blob,
    durationSec,
    updatedAt: ts,
  });

  const compressible = (kind === 'image' || kind === 'video') && !!opts?.quality && opts.quality !== 'original';

  const chat = await getChat(chatId);
  const message: Message = {
    id: uid(),
    chatId,
    senderId: 'me',
    senderName: 'You',
    body: '',
    kind,
    mediaId,
    durationSec,
    timestamp: ts,
    outgoing: true,
    // All media goes through the background job (compress if needed → upload),
    // so every attachment gets uniform progress + retry/failed handling.
    status: 'compressing',
    compressQuality: compressible ? (opts!.quality as 'sd' | 'hd') : undefined,
    // The HD/SD/Original badge shown on photo/video bubbles (both sides).
    mediaQuality: kind === 'image' || kind === 'video' ? (opts?.quality ?? 'original') : undefined,
    jobAttempts: 0,
    receipts: chat?.isGroup
      ? chat.participantIds.map((contactId) => ({ contactId }))
      : undefined,
    replyTo: opts?.replyTo,
    albumId: opts?.albumId,
    albumName: opts?.albumName,
    videoNote: opts?.videoNote,
    audio: opts?.audio,
    updatedAt: ts,
  };
  await put('messages', message);

  if (chat) {
    chat.lastMessage = opts?.albumName
      ? opts.albumName
      : kind === 'audio'
        ? opts?.audio?.title || name
        : mediaPreview(kind, durationSec, name, opts?.videoNote);
    chat.lastKind = previewKind(kind, opts?.albumName, opts?.videoNote);
    chat.lastMessageTime = ts;
    chat.unread = 0;
    chat.interactions = (chat.interactions ?? 0) + 1;
    chat.updatedAt = ts;
    await put('chats', chat);
  }

  resetJobProgress(message.id);
  void processMediaJob(message.id); // background: (compress →) upload → pending / failed
}

/** Encrypt + upload the media ciphertext, then seal a MediaRef into the payload
 *  and relay it (1:1 peer or group fan-out). Throws on upload/seal failure. */
async function sealMediaAndEnqueue(
  message: Message,
  uploadBlob: Blob,
  onUploadProgress?: (p: number) => void,
): Promise<void> {
  const chat = await getChat(message.chatId);
  const peerUserId = chat?.participantIds[0];
  if (!chat || !peerUserId) throw new Error('no chat/peer for media send');
  const media = message.mediaId ? await get<Media>('media', message.mediaId) : undefined;
  const name = media?.name ?? 'attachment';
  const mediaRef = await prepareOutgoingMedia(
    uploadBlob,
    name,
    message.durationSec,
    {
      width: message.mediaWidth,
      height: message.mediaHeight,
      poster: message.posterData,
      quality: message.mediaQuality,
    },
    onUploadProgress,
  );
  const payload: MessagePayload = {
    body: '',
    kind: message.kind,
    timestamp: message.timestamp,
    mediaRef,
    reply: message.replyTo,
    albumId: message.albumId,
    albumName: message.albumName,
    videoNote: message.videoNote,
    audio: message.audio,
  };
  if (chat.isGroup) await sealAndEnqueueGroup(chat, message.id, payload);
  else await sealAndEnqueue(chat, message.id, payload);
}

/* ---- background media jobs (compress → upload), with retry + resume ---- */
const MAX_JOB_ATTEMPTS = 3;
const jobsInFlight = new Set<string>();
// Run media jobs one at a time. Several large videos encoding/encrypting/
// uploading at once contends for memory + bandwidth on a phone (and would clash
// on the single ffmpeg.wasm instance); sequential is far more reliable.
let jobChain: Promise<void> = Promise.resolve();

/** Queue a media job; jobs run sequentially. */
export function processMediaJob(messageId: string): Promise<void> {
  jobChain = jobChain.then(() => runMediaJob(messageId)).catch(() => {});
  return jobChain;
}

/** Compress (with progress) then upload a 'compressing' message; on success it
 *  becomes 'pending' (awaiting the server ack), on repeated failure 'failed'. */
async function runMediaJob(messageId: string): Promise<void> {
  if (jobsInFlight.has(messageId)) return;
  jobsInFlight.add(messageId);
  try {
    const message = await getMessage(messageId);
    if (!message || message.status !== 'compressing' || !message.mediaId) return;
    const media = await get<Media>('media', message.mediaId);
    if (!media) return;
    try {
      resetJobProgress(messageId);
      let uploadBlob = media.blob;
      // --- encode phase --- (compression NEVER fails the job → send the original)
      if (message.compressQuality && (message.kind === 'image' || message.kind === 'video')) {
        try {
          if (message.kind === 'image') {
            uploadBlob = await compressImage(media.blob, message.compressQuality);
          } else {
            uploadBlob = await compressVideo(media.blob, message.compressQuality, (p) =>
              setCompressProgress(messageId, p),
            );
          }
        } catch (e) {
          console.warn('[media-job] compression failed; sending original', e);
          uploadBlob = media.blob;
        }
      }
      setCompressProgress(messageId, 1); // encoding done
      console.info('[media-job] encoded', { id: messageId, kind: message.kind, bytes: uploadBlob.size });
      // Tag the bubble with resolution / length / size (persisted FIRST so the badge
      // shows even if the thumbnail step is slow), then best-effort thumbnail.
      if (message.kind === 'video' && !message.videoNote) {
        const meta = await readVideoMeta(uploadBlob);
        message.mediaWidth = meta.width;
        message.mediaHeight = meta.height;
        message.durationSec = meta.durationSec ?? message.durationSec;
        message.mediaSize = uploadBlob.size;
        await put('messages', message);
        const poster = await generateVideoPoster(uploadBlob);
        if (poster) {
          message.posterData = poster;
          await put('messages', message);
        }
      } else if (message.kind === 'image') {
        const meta = await readImageMeta(uploadBlob);
        message.mediaWidth = meta.width;
        message.mediaHeight = meta.height;
        message.mediaSize = uploadBlob.size;
        await put('messages', message);
      }
      // --- upload phase --- (only the upload/seal can fail the job → retry/failed)
      // Pre-check against the server's cap so an oversize attachment (e.g. an
      // "original"-quality video bigger than the limit) fails FAST with a clear
      // reason, instead of encrypting + uploading it three times only to be 413'd.
      const maxBlob = await getMaxBlobBytes();
      if (uploadBlob.size > maxBlob) {
        console.warn('[media-job] media exceeds server cap; failing fast', {
          id: messageId,
          bytes: uploadBlob.size,
          maxBlob,
        });
        await failMediaPermanently(messageId, 'too-large');
        return;
      }
      console.info('[media-job] uploading', { id: messageId, bytes: uploadBlob.size });
      await sealMediaAndEnqueue(message, uploadBlob, (p) => setUploadProgress(messageId, p));
      console.info('[media-job] uploaded', { id: messageId });
      // Success → pending (the server 'sent' receipt will advance it further).
      const fresh = await getMessage(messageId);
      if (fresh && fresh.status === 'compressing') {
        fresh.status = 'pending';
        fresh.jobAttempts = 0;
        fresh.updatedAt = now();
        await put('messages', fresh);
      }
      clearJobProgress(messageId);
    } catch (e) {
      // A 413 "too large" is permanent; retrying just re-uploads the same bytes.
      // Fail fast with a specific reason; everything else is transient → retry.
      if (e instanceof BlobUploadError && e.status === 413) {
        console.warn('[media-job] server rejected as too large; failing fast', e);
        await failMediaPermanently(messageId, 'too-large');
        return;
      }
      console.warn('[media-job] failed; will retry', e);
      await onMediaJobFailure(messageId);
    }
  } finally {
    jobsInFlight.delete(messageId);
  }
}

/** Fail a media send permanently (no retry), recording why so the UI can explain
 *  it (e.g. "too large"). Used for non-transient errors like exceeding the cap. */
async function failMediaPermanently(messageId: string, reason: 'too-large'): Promise<void> {
  const m = await getMessage(messageId);
  if (!m || m.status !== 'compressing') return;
  m.status = 'failed';
  m.failReason = reason;
  m.updatedAt = now();
  await put('messages', m);
  clearJobProgress(messageId);
}

async function onMediaJobFailure(messageId: string): Promise<void> {
  const m = await getMessage(messageId);
  if (!m || m.status !== 'compressing') return;
  const attempts = (m.jobAttempts ?? 0) + 1;
  m.jobAttempts = attempts;
  if (attempts >= MAX_JOB_ATTEMPTS) {
    m.status = 'failed';
    clearJobProgress(messageId);
  }
  m.updatedAt = now();
  await put('messages', m);
  if (attempts < MAX_JOB_ATTEMPTS) {
    setTimeout(() => void processMediaJob(messageId), 3000 * attempts); // backoff retry
  }
}

/** Re-send a failed outgoing message: media re-runs the upload job, text/
 *  location/poll/contact re-seal + re-enqueue. Used by the retry button + the
 *  sticky "failed to send" toast. */
export async function retryOutgoing(messageId: string): Promise<void> {
  const m = await getMessage(messageId);
  if (!m || !m.outgoing) return;
  m.jobAttempts = 0;
  m.failReason = undefined; // a fresh attempt; re-set only if it fails again
  m.updatedAt = now();
  if (m.mediaId) {
    m.status = 'compressing';
    await put('messages', m);
    resetJobProgress(messageId);
    void processMediaJob(messageId);
    return;
  }
  m.status = 'pending';
  await put('messages', m);
  const chat = await getChat(m.chatId);
  const payload: MessagePayload = {
    body: m.body,
    kind: m.kind,
    timestamp: m.timestamp,
    reply: m.replyTo,
    location: m.location,
    contact: m.contact,
    poll: m.poll ? { question: m.poll.question, options: m.poll.options, multi: m.poll.multi, votes: [] } : undefined,
  };
  await enqueueMessage(chat, m.id, payload);
}

/** Back-compat alias (media-only retry). */
export const retryMediaMessage = retryOutgoing;

/** Outgoing messages that exhausted their send retries. */
export async function listFailedMessages(): Promise<Message[]> {
  return (await getAll<Message>('messages')).filter((m) => m.outgoing && m.status === 'failed');
}

/** Retry every failed outgoing message (the toast's "Retry" action). */
export async function retryAllFailed(): Promise<void> {
  for (const m of await listFailedMessages()) await retryOutgoing(m.id);
}

/** Mark an outgoing message failed after its send retries are exhausted (unless
 *  it already reached the server). */
export async function markSendFailed(messageId: string): Promise<void> {
  const m = await getMessage(messageId);
  if (!m || !m.outgoing) return;
  if (m.status === 'sent' || m.status === 'delivered' || m.status === 'read') return;
  m.status = 'failed';
  m.updatedAt = now();
  await put('messages', m);
}

/* ---- media auto-download (videos can be deferred + fetched on demand) ---- */

/** Whether to auto-download an incoming video, per Settings → Storage and data →
 *  Media auto-download → Video ('never' | 'wifi' | 'wifi-cellular') and the
 *  network. iOS Safari exposes no network type, so there we can't tell Wi-Fi from
 *  cellular, so any non-'never' setting auto-downloads. */
async function shouldAutoDownloadVideo(): Promise<boolean> {
  const mode = await getSetting<string>('storage.autoDownload.video', 'wifi');
  if (mode === 'never') return false;
  if (mode === 'wifi-cellular') return true;
  // mode === 'wifi': only on Wi-Fi/ethernet (or when the type is unknown, e.g. iOS).
  const conn = (navigator as unknown as { connection?: { type?: string } }).connection;
  const type = conn?.type;
  if (!type || type === 'unknown') return true;
  return type === 'wifi' || type === 'ethernet';
}

/** Download a deferred video's full clip (auto-download off, or manual tap). */
export async function downloadMessageMedia(messageId: string): Promise<void> {
  const m = await getMessage(messageId);
  if (!m?.pendingMedia || m.mediaId) return;
  const ref = m.pendingMedia;
  const blob = await receiveIncomingMedia(ref);
  if (!blob) throw new Error('download failed');
  const mediaId = uid();
  await put<Media>('media', {
    id: mediaId,
    kind: m.kind as Media['kind'],
    mime: ref.mime,
    name: ref.name,
    size: ref.size,
    blob,
    durationSec: m.durationSec ?? ref.durationSec,
    updatedAt: now(),
  });
  m.mediaId = mediaId;
  m.pendingMedia = undefined;
  m.updatedAt = now();
  await put('messages', m);
}

/** Resume any interrupted compressions (called on app start + when reconnecting). */
export async function resumePendingMediaJobs(): Promise<void> {
  const msgs = await getAll<Message>('messages');
  for (const m of msgs) {
    if (m.status === 'compressing') void processMediaJob(m.id);
  }
}

/* ---- calls ---- */

export async function listCalls(q = ''): Promise<Call[]> {
  const calls = await getAll<Call>('calls');
  const filtered = q ? calls.filter((c) => matches(c.name, q)) : calls;
  return filtered.sort((a, b) => b.timestamp - a.timestamp);
}

/** A run of consecutive calls with the same contact, collapsed into one row. */
export interface CallGroup extends Call {
  count: number;
  ids: string[]; // all calls collapsed into this row
}

/** Collapse consecutive same-contact calls (WhatsApp-style "(2)" grouping). */
export async function listCallGroups(q = ''): Promise<CallGroup[]> {
  const calls = await listCalls(q); // newest first
  const groups: CallGroup[] = [];
  for (const call of calls) {
    const prev = groups[groups.length - 1];
    if (prev && prev.contactId === call.contactId) {
      prev.count += 1;
      prev.ids.push(call.id);
    } else {
      groups.push({ ...call, count: 1, ids: [call.id] });
    }
  }
  return groups;
}

/** Delete one or more call-log entries (tombstoned so a pull can't resurrect them). */
export async function deleteCalls(ids: string[]): Promise<void> {
  const deletedAt = now();
  for (const id of ids) {
    await recordTombstone('calls', id, deletedAt);
    await enqueue({ t: 'tombstone', store: 'calls', recordId: id, deletedAt });
    await remove('calls', id);
  }
}

/** Delete a conversation: its messages + ratchet session (local) and the chat
 *  itself (tombstoned so a sync pull can't resurrect it). */
export async function deleteChat(chatId: string): Promise<void> {
  const msgs = await getByIndex<Message>('messages', 'chatId', chatId);
  for (const m of msgs) await remove('messages', m.id);
  await remove('sessions', chatId);
  const deletedAt = now();
  await recordTombstone('chats', chatId, deletedAt);
  await enqueue({ t: 'tombstone', store: 'chats', recordId: chatId, deletedAt });
  await remove('chats', chatId);
}

/** Delete a contact. Normally this also deletes the 1:1 conversation, EXCEPT for
 *  a Ghosted (terminated) peer, where we keep the conversation (read-only, via the
 *  chat's own `ghosted` flag) and only remove the address-book entry; deleting the
 *  conversation is then the user's separate choice. */
export async function deleteContact(contactId: string): Promise<void> {
  const contact = await getContact(contactId);
  const chats = await getAll<Chat>('chats');
  const chat = chats.find(
    (c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === contactId,
  );
  const ghosted = contact?.ghosted || chat?.ghosted;
  if (chat && !ghosted) {
    await deleteChat(chat.id);
  } else if (chat && !chat.ghosted) {
    // Ensure the kept chat stays read-only after the contact record is gone.
    chat.ghosted = true;
    chat.updatedAt = now();
    await put('chats', chat);
  }
  const deletedAt = now();
  await recordTombstone('contacts', contactId, deletedAt);
  await enqueue({ t: 'tombstone', store: 'contacts', recordId: contactId, deletedAt });
  await remove('contacts', contactId);
}

/** Mark all missed calls as seen (called when the Calls tab is viewed). */
export async function markCallsSeen(): Promise<void> {
  const calls = await getAll<Call>('calls');
  for (const c of calls) {
    if (c.missed && !c.seen) {
      c.seen = true;
      c.updatedAt = now();
      await put('calls', c);
    }
  }
}

/* ---- friend requests (Contacts badge) ---- */

/** Incoming, still-pending requests (actionable: accept/reject; drive the badge). */
export async function listPendingRequests(): Promise<FriendRequest[]> {
  const reqs = await getAll<FriendRequest>('requests');
  return reqs
    .filter((r) => r.status === 'pending' && r.direction !== 'outgoing' && r.kind !== 'group-invite')
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Outgoing, still-pending requests we sent (informational: "Requested"). */
export async function listSentRequests(): Promise<FriendRequest[]> {
  const reqs = await getAll<FriendRequest>('requests');
  return reqs
    .filter((r) => r.status === 'pending' && r.direction === 'outgoing')
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Accept a friend request: the contact (id == requester's Ring id) was created
 * with their name/photo when the request card arrived. Unhide the chat, send
 * our own contact card back, and clear the request.
 */
/** Mark a contact as an accepted friend (persists across chat deletion, so their
 *  later messages aren't hidden as unaccepted requests). */
// Accepted-friend ledger. Kept in a dedicated settings key (NOT on the contact),
// so the frequent contact rewrites (updateContactProfile runs on every inbound
// card) can never clobber it via a stale read-modify-write, and it survives
// deleting + restarting a chat. A peer in this set is an accepted friend: their
// messages show immediately instead of being hidden behind the friend-request gate.
async function getConnectedPeers(): Promise<Record<string, boolean>> {
  const s = await get<Setting<Record<string, boolean>>>('settings', 'connectedPeers');
  return s?.value ?? {};
}
export async function isPeerConnected(id: string): Promise<boolean> {
  return !!(await getConnectedPeers())[id];
}
export async function markContactConnected(id: string): Promise<void> {
  const map = await getConnectedPeers();
  if (map[id]) return;
  map[id] = true;
  await put<Setting<Record<string, boolean>>>('settings', { key: 'connectedPeers', value: map });
}

/* ---- account termination ("Ghosted") ---- */

const GHOST_NAME = 'Ghosted';

export async function isContactGhosted(id: string): Promise<boolean> {
  return (await getContact(id))?.ghosted === true;
}

/** Turn a peer into a "Ghosted" contact after their account is terminated: rename
 *  to "Ghosted" + tombstone avatar, on the contact AND its 1:1 chat snapshot AND
 *  their past message bubbles (so a sender label reads "Ghosted"). Message bodies
 *  and media are untouched; only the displayed identity changes. */
export async function markContactGhosted(id: string): Promise<void> {
  const contact = await getContact(id);
  if (!contact || contact.ghosted) return;
  contact.ghosted = true;
  contact.name = GHOST_NAME;
  contact.avatar = ghostAvatar();
  // The account is gone; scrub its profile remnants (About + @username) so nothing
  // of the departed identity lingers; only the "Ghosted" tombstone remains.
  contact.about = '';
  contact.username = undefined;
  contact.updatedAt = now();
  await put('contacts', contact);
  // Push the new name/avatar onto the 1:1 chat snapshot (same as updateContactProfile).
  const chats = await getAll<Chat>('chats');
  const direct = chats.find(
    (c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === id,
  );
  if (direct) {
    direct.name = GHOST_NAME;
    direct.avatar = contact.avatar;
    direct.ghosted = true; // chat stays read-only even if the contact is removed
    direct.updatedAt = now();
    await put('chats', direct);
  }
  // Past messages from this peer (group bubbles show senderName) → "Ghosted".
  const msgs = await getAll<Message>('messages');
  for (const m of msgs) {
    if (m.senderId === id && m.senderName !== GHOST_NAME) {
      m.senderName = GHOST_NAME;
      m.updatedAt = now();
      await put('messages', m);
    }
  }
  // A ghosted friend stays visible (never re-gated as a request).
  await markContactConnected(id);
}

/** Poll the server for the status of our contacts and ghost any that terminated.
 *  Runs on connect; network errors are swallowed (retried next time). */
export async function refreshContactStatuses(): Promise<void> {
  const contacts = await getAll<Contact>('contacts');
  const ids = contacts.filter((c) => !c.ghosted).map((c) => c.id);
  if (ids.length === 0) return;
  let statuses: Record<string, 'active' | 'terminated' | 'unknown'>;
  try {
    statuses = await fetchUserStatuses(ids);
  } catch {
    return;
  }
  for (const id of ids) {
    if (statuses[id] === 'terminated') await markContactGhosted(id);
  }
}

/* ---- blocking (server-enforced; local ledger mirrors it) ---- */

async function getBlockedPeers(): Promise<Record<string, boolean>> {
  const s = await get<Setting<Record<string, boolean>>>('settings', 'blockedPeers');
  return s?.value ?? {};
}
export async function isPeerBlocked(id: string): Promise<boolean> {
  return !!(await getBlockedPeers())[id];
}
async function setPeerBlocked(id: string, on: boolean): Promise<void> {
  const map = await getBlockedPeers();
  if (!!map[id] === on) return;
  if (on) map[id] = true;
  else delete map[id];
  await put<Setting<Record<string, boolean>>>('settings', { key: 'blockedPeers', value: map });
}

async function setContactBlockedFlag(id: string, blocked: boolean): Promise<void> {
  const c = await getContact(id);
  if (!c || !!c.blocked === blocked) return;
  c.blocked = blocked;
  c.updatedAt = now();
  await put('contacts', c);
}

/** Block a peer: server stops relaying their messages to us and refuses them our
 *  key bundle (can't message / can't re-add). History is kept (read-only). */
export async function blockContact(id: string): Promise<void> {
  await blockUser(id); // server is the source of truth
  await setPeerBlocked(id, true);
  await setContactBlockedFlag(id, true);
}

/** Lift a block; messaging resumes. */
export async function unblockContact(id: string): Promise<void> {
  await unblockUser(id);
  await setPeerBlocked(id, false);
  await setContactBlockedFlag(id, false);
}

/** Reconcile the local block ledger + contact flags with the server (on connect). */
export async function refreshBlocks(): Promise<void> {
  let ids: string[];
  try {
    ids = await fetchBlocks();
  } catch {
    return;
  }
  const want = new Set(ids);
  const current = await getBlockedPeers();
  for (const id of ids) {
    await setPeerBlocked(id, true);
    await setContactBlockedFlag(id, true);
  }
  for (const id of Object.keys(current)) {
    if (!want.has(id)) {
      await setPeerBlocked(id, false);
      await setContactBlockedFlag(id, false);
    }
  }
}

export async function acceptRequest(id: string): Promise<void> {
  const r = await get<FriendRequest>('requests', id);
  if (!r) return;
  let contact = await getContact(id);
  if (!contact) {
    await addContactWithId(id, r.name);
    contact = await getContact(id);
  }
  if (!contact) {
    await dropRequest(id);
    return;
  }
  const chatId = await startDirectChat(contact);
  await setChatPending(chatId, false);
  await markContactConnected(id);
  const card = await ownCard('accept');
  await sendCard(await getChat(chatId), card);
  await setCardShared(chatId);
  await dropRequest(id);
}

/** Reject a friend request: drop it and remove the placeholder contact + chat. */
export async function rejectRequest(id: string): Promise<void> {
  const chats = await getAll<Chat>('chats');
  const chat = chats.find(
    (c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === id,
  );
  if (chat) await remove('chats', chat.id);
  await remove('contacts', id);
  await dropRequest(id);
}

/** Withdraw an outgoing request we sent: signal the peer to remove it from their
 *  Requests (best-effort over the relay; queued if we're offline), then tear it
 *  down locally (the pending chat + placeholder contact + the request record). */
export async function cancelSentRequest(id: string): Promise<void> {
  const chats = await getAll<Chat>('chats');
  const chat = chats.find(
    (c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === id,
  );
  if (chat) {
    // A bare card: the recipient only needs the 'cancel' signal, not name/photo.
    await sendCard(chat, { t: 'cancel', name: '', avatar: '' });
    await remove('sessions', chat.id);
    await remove('chats', chat.id);
  }
  await remove('contacts', id);
  await dropRequest(id);
}

/** Remove a friend request, tombstoned so a pull can't resurrect it. */
async function dropRequest(id: string): Promise<void> {
  const deletedAt = now();
  await recordTombstone('requests', id, deletedAt);
  await enqueue({ t: 'tombstone', store: 'requests', recordId: id, deletedAt });
  await remove('requests', id);
}

/* ---- friend requests + contact cards (iMessage-style name/photo share) ---- */

const CARD_KIND = 'card';

/** True once the user has set a real name AND profile photo, required before
 *  sending friend requests/invites (the request card carries name + photo). */
export async function profileComplete(): Promise<boolean> {
  const name = (await getSecret('profileName', '')).trim();
  const avatar = await getSecret('profileAvatar', '');
  return name.length > 0 && name !== 'You' && avatar.length > 0;
}

/** Prefill the profile name with the immutable username on a fresh account, so the
 *  user starts with their handle instead of the "You" placeholder (they can still
 *  edit it). No-op if a name is already set or there's no username yet. Requires the
 *  keystore unlocked (profile fields are encrypted at rest). */
export async function seedProfileName(): Promise<void> {
  const username = getSelfUsername();
  if (!username) return;
  const current = (await getSecret('profileName', '')).trim();
  if (!current || current === 'You') await setSecret('profileName', username);
}

/** This device's own contact card (name + a downscaled avatar). */
async function ownCard(t: ContactCard['t']): Promise<ContactCard> {
  const name = await getSecret('profileName', 'You');
  const stored = await getSecret('profileAvatar', '');
  const avatar = stored ? await downscaleAvatar(stored) : initialsAvatar(name);
  return { t, name, avatar };
}

/** Seal + relay a contact card (no visible message is stored). */
async function sendCard(chat: Chat | undefined, card: ContactCard): Promise<void> {
  await sealAndEnqueue(chat, uid(), { body: '', kind: CARD_KIND, timestamp: now(), card });
}

/* ---- session re-key recovery (robust delivery after a one-sided chat delete) ---- */

const REKEY_KIND = 'rekey';
const REKEY_DEBOUNCE_MS = 10_000;
const rekeyRequestedAt = new Map<string, number>();

/**
 * The peer sent us a message we could not decrypt (typically because we deleted
 * this chat and lost the ratchet, while they kept theirs and sent a NORMAL packet,
 * so there is no prekey to re-establish from). Tear down any stale session + its
 * meta so the next seal re-runs X3DH, then send a fresh prekey carrying a `rekey`
 * control: the peer adopts the new session (via openPacket's recovery path) and
 * resends its undelivered messages, and we resend ours. Debounced per chat.
 */
async function requestRekey(chatId: string, peerUserId: string): Promise<void> {
  if (!peerUserId) return;
  const last = rekeyRequestedAt.get(chatId) ?? 0;
  if (now() - last < REKEY_DEBOUNCE_MS) return;
  rekeyRequestedAt.set(chatId, now());
  await remove('sessions', chatId);
  await remove('settings', `smeta:${chatId}`);
  const chat = await getChat(chatId);
  if (!chat || chat.isGroup) return;
  // Fresh prekey packet the peer can adopt; its body is empty (never shown).
  await sealAndEnqueue(chat, uid(), { body: '', kind: REKEY_KIND, timestamp: now(), rekey: true });
  // Our own recent messages need re-sealing under the new session too.
  await resendRecentOutgoing(chatId);
}

/** Rebuild a sendable payload from a stored OUTGOING message, for re-sealing under a
 *  re-keyed session. Returns null for media (the transport file key isn't retained,
 *  so media can't be cheaply re-sent) - those stay recoverable via a manual resend. */
function payloadFromMessage(m: Message): MessagePayload | null {
  if (m.mediaId || m.pendingMedia) return null;
  if (m.kind === 'image' || m.kind === 'video' || m.kind === 'file' || m.kind === 'voice' || m.kind === 'audio') {
    return null;
  }
  return {
    body: m.body,
    kind: m.kind,
    timestamp: m.timestamp,
    reply: m.replyTo,
    location: m.location,
    poll: m.poll,
    contact: m.contact,
    albumId: m.albumId,
    albumName: m.albumName,
  };
}

const REKEY_RESEND_LIMIT = 50;

/**
 * Re-seal + re-enqueue our RECENT outgoing messages in this 1:1 chat under the
 * (freshly re-keyed) session, so messages the peer dropped while we were desynced
 * are recovered. Keyed on RECENCY, not status: the peer acks an undecryptable frame
 * to clear the relay (so this same-id resend isn't deduped), which also yields a
 * false 'delivered' - so status is unreliable here. The peer dedups by message id
 * (wasInboundSeen), so resending an already-seen message is a harmless no-op. Any
 * stale (old-session) outbox copy is dropped first so the at-least-once retry can't
 * re-send now-undecryptable ciphertext. Media is skipped (see payloadFromMessage).
 */
async function resendRecentOutgoing(chatId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat || chat.isGroup) return;
  const peerId = chat.participantIds[0];
  const recent = (await getByIndex<Message>('messages', 'chatId', chatId))
    .filter((m) => m.outgoing && m.status !== 'read')
    .sort((x, y) => x.timestamp - y.timestamp)
    .slice(-REKEY_RESEND_LIMIT);
  for (const m of recent) {
    const payload = payloadFromMessage(m);
    if (!payload) continue;
    if (peerId) await removeOutboxByFrameId(m.id, peerId);
    await sealAndEnqueue(chat, m.id, payload);
  }
}

async function setChatPending(chatId: string, pending: boolean): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  chat.pending = pending;
  chat.updatedAt = now();
  await put('chats', chat);
}

export async function updateContactProfile(id: string, name: string, avatar: string): Promise<void> {
  const c = await getContact(id);
  if (!c) return;
  c.name = name || c.name;
  c.avatar = avatar || c.avatar;
  c.updatedAt = now();
  await put('contacts', c);

  // The 1:1 chat keeps its own name/avatar snapshot (taken at creation, when the
  // contact was still a placeholder); refresh it so the chat list + header show
  // the peer's real name/photo from their contact card.
  const chats = await getAll<Chat>('chats');
  const chat = chats.find(
    (ch) => !ch.isGroup && ch.participantIds.length === 1 && ch.participantIds[0] === id,
  );
  if (chat) {
    chat.name = c.name;
    chat.avatar = c.avatar;
    chat.updatedAt = now();
    await put('chats', chat);
  }
}

/** Add a peer by Ring id and send them a friend request (our name + photo).
 *  The chat is created hidden (pending) until they accept. */
// Open-network model: there is no accept-first friend gate for 1:1 chats, so
// "requesting" a peer just means making them a connected, visible contact and
// sharing our profile card (so they learn our name/photo immediately). Used by
// the invite auto-connect (services/invites.ts) to introduce the invitee to the
// inviter; the directory fills in profiles the other direction.
export async function requestFriend(peerUserId: string): Promise<void> {
  if (!peerUserId) return;
  await addContactWithId(peerUserId, '');
  const contact = await getContact(peerUserId);
  if (!contact) return;
  await markContactConnected(peerUserId);
  const chatId = await startDirectChat(contact); // visible (connected → not pending)
  const card = await ownCard('profile');
  await sendCard(await getChat(chatId), card);
  await setCardShared(chatId);
}

/** Apply an inbound contact card. */
async function handleContactCard(from: string, chatId: string, card: ContactCard): Promise<void> {
  if (card.t === 'request') {
    // Fill the placeholder contact with the requester's name/photo.
    await updateContactProfile(from, card.name, card.avatar);
    // Already an accepted friend → a (re-)sent request card is a stale duplicate
    // (e.g. the requester retried before our accept reached them). Treat it as a
    // profile refresh only; never re-hide the chat or raise a fresh request. This
    // is the authoritative guard against a duplicate request racing our accept.
    if (await isPeerConnected(from)) {
      const c = await getChat(chatId);
      if (c?.pending) await setChatPending(chatId, false);
      return;
    }
    const chat = await getChat(chatId);
    // Already-connected (non-pending) chat → treat a re-sent request as just a
    // profile refresh; don't re-hide it or raise a new request.
    if (chat && !chat.pending) return;
    await setChatPending(chatId, true);
    await put<FriendRequest>('requests', {
      id: from,
      name: card.name,
      avatar: card.avatar,
      createdAt: now(),
      status: 'pending',
      direction: 'incoming',
    });
    // Auto-accept anyone who redeemed one of our invite codes; they're our
    // invitee, so no manual Accept tap is needed (auto-connect both ways). The
    // "joined Ring" notification is fired once by the invitation poll (deduped),
    // not here, so it can't double up with the poll's accept path.
    if (await shouldAutoAccept(from)) {
      await clearAutoAccept(from);
      await acceptRequest(from); // un-pends, sends our accept card, drops the request
      return;
    }
    void notifyIncoming({ kind: 'request', name: card.name, body: 'wants to connect' });
  } else if (card.t === 'accept') {
    await updateContactProfile(from, card.name, card.avatar);
    await setChatPending(chatId, false); // both sides connected → chat appears
    await markContactConnected(from);
    await dropRequest(from); // clear a mutual request if any
  } else if (card.t === 'cancel') {
    // The requester withdrew their request → remove it from our Requests. Only
    // tear down the placeholder chat/contact if we hadn't accepted yet (a late
    // cancel after we're already friends is ignored).
    const chat = await getChat(chatId);
    if (chat && chat.pending) {
      await remove('chats', chat.id);
      await remove('sessions', chat.id);
      await remove('contacts', from);
    }
    await dropRequest(from);
  } else {
    await updateContactProfile(from, card.name, card.avatar);
  }
}

/* ---- profile re-share hint ---- */

async function cardSignature(card: ContactCard): Promise<string> {
  const data = new TextEncoder().encode(`${card.name} ${card.avatar}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// A card built from the RAW stored secrets (full-size avatar). Its signature is
// byte-stable across sessions, unlike the transmitted card, whose avatar is a
// fresh canvas JPEG re-encode (downscaleAvatar) that varies each launch and made
// the re-share hint fire on every app open even when nothing had changed.
async function rawProfileCard(): Promise<ContactCard> {
  return {
    t: 'profile',
    name: await getSecret('profileName', 'You'),
    avatar: await getSecret('profileAvatar', ''),
  };
}

async function setCardShared(chatId: string): Promise<void> {
  await setSetting(`cardShared:${chatId}`, await cardSignature(await rawProfileCard()));
}

/** True when the user's current profile differs from what was last shared in a
 *  (non-pending) 1:1 chat, drives the "share updated name & photo" hint. */
export async function profileNeedsShare(chatId: string): Promise<boolean> {
  const chat = await getChat(chatId);
  if (!chat || chat.isGroup || chat.pending) return false;
  const shared = await getSetting<string>(`cardShared:${chatId}`, '');
  if (!shared) return false; // never shared here (e.g. a chat we didn't initiate), don't nag
  const current = await cardSignature(await rawProfileCard());
  return current !== shared;
}

/** Re-share the current profile to a chat (clears the hint). */
export async function shareProfileUpdate(chatId: string): Promise<void> {
  const card = await ownCard('profile');
  await sendCard(await getChat(chatId), card);
  await setCardShared(chatId);
}

/** Dismiss the re-share hint without sending: baseline the current profile so it
 *  won't nag again for this chat until the name/photo actually changes. */
export async function dismissShareHint(chatId: string): Promise<void> {
  await setCardShared(chatId);
}

/** Downscale a photo data-URL to ~256px JPEG so a contact card stays well under
 *  the relay's 1 MiB frame limit. Initials SVGs (already tiny) pass through.
 *  Exported so the directory profile push can reuse the same thumbnailing. */
export async function downscaleAvatar(dataUrl: string, size = 256): Promise<string> {
  if (dataUrl.startsWith('data:image/svg')) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    const scale = Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return dataUrl;
  }
}

/* ---- You alerts (You badge) ---- */

export async function listAlerts(): Promise<Alert[]> {
  const alerts = await getAll<Alert>('alerts');
  return alerts
    .filter((a) => !a.resolved)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function resolveAlert(id: string): Promise<void> {
  const a = await get<Alert>('alerts', id);
  if (a && !a.resolved) {
    a.resolved = true;
    await put('alerts', a);
  }
}

/* ---- badge counts ---- */

export async function countUnread(): Promise<number> {
  const chats = await getAll<Chat>('chats');
  return chats.reduce((n, c) => n + (c.unread || 0), 0);
}

export async function countMissedUnseen(): Promise<number> {
  const calls = await getAll<Call>('calls');
  return calls.filter((c) => c.missed && !c.seen).length;
}

export async function countPendingRequests(): Promise<number> {
  // The Contacts tab badge covers both friend requests and group invitations.
  const [requests, invites] = await Promise.all([listPendingRequests(), listGroupInvites()]);
  return requests.length + invites.length;
}

export async function countUnresolvedAlerts(): Promise<number> {
  return (await listAlerts()).length;
}

/** Full call history with one contact, newest first. */
export async function listCallsForContact(contactId: string): Promise<Call[]> {
  const calls = await getAll<Call>('calls');
  return calls
    .filter((c) => c.contactId === contactId)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/* ---- contacts ---- */

export function getContact(id: string): Promise<Contact | undefined> {
  return get<Contact>('contacts', id);
}

export async function listContacts(q = ''): Promise<Contact[]> {
  const [contacts, chats] = await Promise.all([
    getAll<Contact>('contacts'),
    getAll<Chat>('chats'),
  ]);
  // A contact whose 1:1 chat is still pending is just an un-accepted friend
  // request; it belongs in Requests, not the contacts list, until accepted.
  const pendingPeerIds = new Set(
    chats
      .filter((c) => c.pending && !c.isGroup && c.participantIds.length === 1)
      .map((c) => c.participantIds[0]),
  );
  // Ghosted (terminated) accounts are auto-removed from the address book; their
  // conversation stays in Chats (read-only) until the user deletes it.
  const visible = contacts.filter((c) => !pendingPeerIds.has(c.id) && !c.ghosted);
  const filtered = q
    ? visible.filter((c) => matches(c.name, q) || matches(c.phone, q))
    : visible;
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

/* ---- media ---- */

export async function getMediaUrl(id: string): Promise<string | null> {
  const media = await get<Media>('media', id);
  return media ? URL.createObjectURL(media.blob) : null;
}

/* ---- settings ---- */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await get<Setting<T>>('settings', key);
  return s ? s.value : fallback;
}

export function setSetting<T>(key: string, value: T): Promise<void> {
  return put('settings', { key, value });
}

/* ---- emoji usage (drives the most-used-first quick-react row) ---- */
const EMOJI_USAGE_KEY = 'emojiUsage';
const DEFAULT_QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Bump a reaction emoji's usage count. */
export async function recordEmojiUse(emoji: string): Promise<void> {
  const usage = await getSetting<Record<string, number>>(EMOJI_USAGE_KEY, {});
  usage[emoji] = (usage[emoji] ?? 0) + 1;
  await setSetting(EMOJI_USAGE_KEY, usage);
}

/** The quick-react set: the user's most-used emoji first, padded with the
 *  defaults, deduped. Capped at `limit`. */
export async function quickReactEmojis(limit = 8): Promise<string[]> {
  const usage = await getSetting<Record<string, number>>(EMOJI_USAGE_KEY, {});
  const used = Object.keys(usage).sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0));
  const ordered: string[] = [];
  for (const e of [...used, ...DEFAULT_QUICK]) {
    if (!ordered.includes(e)) ordered.push(e);
  }
  return ordered.slice(0, limit);
}

/* ---- storage & network stats (Storage and data screens) ---- */

export interface ChatStorage {
  chatId: string;
  name: string;
  avatar: string;
  bytes: number;
  count: number;
}

/**
 * Real per-chat media footprint: join messages (have chatId + mediaId) to the
 * media store (have size), summed per chat, largest first. Genuinely computed
 * from on-device Blobs, not stubbed.
 */
export async function storageByChat(): Promise<ChatStorage[]> {
  const [messages, media, chats] = await Promise.all([
    getAll<Message>('messages'),
    getAll<Media>('media'),
    getAll<Chat>('chats'),
  ]);
  const sizeById = new Map(media.map((m) => [m.id, m.size]));
  const byChat = new Map<string, { bytes: number; count: number }>();
  for (const m of messages) {
    if (!m.mediaId) continue;
    const size = sizeById.get(m.mediaId);
    if (size === undefined) continue;
    const row = byChat.get(m.chatId) ?? { bytes: 0, count: 0 };
    row.bytes += size;
    row.count += 1;
    byChat.set(m.chatId, row);
  }
  const chatById = new Map(chats.map((c) => [c.id, c]));
  return [...byChat.entries()]
    .map(([chatId, row]) => ({
      chatId,
      name: chatById.get(chatId)?.name ?? 'Unknown chat',
      avatar: chatById.get(chatId)?.avatar ?? '',
      bytes: row.bytes,
      count: row.count,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

/** Total on-device media bytes, broken down by media kind. */
export async function storageByType(): Promise<{
  total: number;
  byKind: Record<Media['kind'], number>;
}> {
  const media = await getAll<Media>('media');
  const byKind: Record<Media['kind'], number> = {
    image: 0,
    video: 0,
    file: 0,
    voice: 0,
    audio: 0,
  };
  let total = 0;
  for (const m of media) {
    byKind[m.kind] += m.size;
    total += m.size;
  }
  return { total, byKind };
}

export interface NetworkStats {
  messagesSent: number;
  messagesReceived: number;
  mediaBytes: number;
  calls: number;
  callSeconds: number;
  callBytes: number; // total data sent+received across calls
}

/**
 * Network usage derived honestly from on-device records created since `sinceTs`
 * (the persisted reset point). Counts are real; "bytes" is the summed size of
 * media actually stored. Wi-Fi/cellular split is intentionally omitted; a PWA
 * has no API for it.
 */
export async function networkStats(sinceTs = 0): Promise<NetworkStats> {
  const [messages, media, calls] = await Promise.all([
    getAll<Message>('messages'),
    getAll<Media>('media'),
    getAll<Call>('calls'),
  ]);
  const since = (ts: number) => ts >= sinceTs;
  const msgs = messages.filter((m) => since(m.timestamp));
  const mediaBytes = media
    .filter((m) => since(m.updatedAt))
    .reduce((n, m) => n + m.size, 0);
  const cs = calls.filter((c) => since(c.timestamp));
  return {
    messagesSent: msgs.filter((m) => m.outgoing).length,
    messagesReceived: msgs.filter((m) => !m.outgoing).length,
    mediaBytes,
    calls: cs.length,
    callSeconds: cs.reduce((n, c) => n + (c.durationSec ?? 0), 0),
    callBytes: cs.reduce((n, c) => n + (c.bytes ?? 0), 0),
  };
}

/* ---- destructive / write helpers used by settings actions ---- */

/** Add a contact from the "New contact" entry surface. Returns the new id. */
export async function addContact(name: string, phone: string): Promise<string> {
  const id = uid();
  await put<Contact>('contacts', {
    id,
    name,
    avatar: initialsAvatar(name),
    phone,
    about: 'Available',
    updatedAt: now(),
  });
  return id;
}

/**
 * Find an existing 1:1 chat with a contact, or create one. Returns the chat id.
 * Used by the "New chat" entry surface to start/open a direct conversation.
 */
export async function startDirectChat(contact: Contact): Promise<string> {
  const chats = await getAll<Chat>('chats');
  const matches = chats.filter(
    (c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === contact.id,
  );
  // Prefer a real (visible) chat over a hidden one, e.g. a group session-carrier
  // chat or an unaccepted-request placeholder.
  const visible = matches.find((c) => !c.pending);
  if (visible) return visible.id;
  const hidden = matches[0];
  if (hidden) {
    // Opening a chat with an already-accepted friend → make it visible.
    if (hidden.pending && (await isPeerConnected(contact.id))) {
      hidden.pending = false;
      hidden.updatedAt = now();
      await put('chats', hidden);
    }
    return hidden.id;
  }
  const ts = now();
  const id = uid();
  await put<Chat>('chats', {
    id,
    name: contact.name,
    avatar: contact.avatar,
    isGroup: false,
    participantIds: [contact.id],
    lastMessage: '',
    lastMessageTime: ts,
    unread: 0,
    updatedAt: ts,
  });
  return id;
}

/**
 * Create a contact with a specific id (the peer's server user id). Used when
 * adding someone "by ID", and when auto-creating a contact for an inbound
 * message from a sender we don't have yet. Idempotent.
 */
export async function addContactWithId(id: string, name: string): Promise<void> {
  const existing = await get<Contact>('contacts', id);
  if (existing) return;
  const label = name.trim() || id.slice(0, 8);
  await put<Contact>('contacts', {
    id,
    name: label,
    avatar: initialsAvatar(label),
    phone: '',
    about: 'Available',
    updatedAt: now(),
  });
}

/** Fill a contact's display name / @username / avatar / About from the directory
 *  used when we auto-create a contact from an inbound message so they don't show
 *  as a raw id-prefix while waiting for the next connect-time refresh. Best-effort. */
export async function hydrateContactFromDirectory(id: string): Promise<void> {
  const c = await getContact(id);
  if (!c || c.ghosted) return;
  let u;
  try {
    u = await fetchDirectoryUser(id);
  } catch {
    return;
  }
  if (!u) return;
  const name = (u.displayName || u.username || '').trim();
  if (name) c.name = name;
  c.username = u.username;
  if (u.avatar) c.avatar = u.avatar;
  if (typeof u.about === 'string') c.about = u.about;
  c.updatedAt = now();
  await put('contacts', c);
  // Mirror onto the 1:1 chat snapshot (name/avatar), like updateContactProfile.
  const chats = await getAll<Chat>('chats');
  const chat = chats.find(
    (ch) => !ch.isGroup && ch.participantIds.length === 1 && ch.participantIds[0] === id,
  );
  if (chat) {
    chat.name = c.name;
    chat.avatar = c.avatar;
    chat.updatedAt = now();
    await put('chats', chat);
  }
}

// Messages that arrive while the keystore is locked are stashed here (still
// encrypted) under `pendingIncoming:<id>` and decrypted on unlock. This lets the
// sync layer still ack them (so the sender gets "delivered" as soon as the device
// receives the message) without decrypting or notifying behind the passcode gate.
const PENDING_INCOMING_PREFIX = 'pendingIncoming:';

interface PendingIncoming {
  from: string;
  id: string;
  ciphertext: unknown;
}

async function queuePendingIncoming(from: string, id: string, ciphertext: unknown): Promise<void> {
  await setSetting<PendingIncoming>(`${PENDING_INCOMING_PREFIX}${id}`, { from, id, ciphertext });
}

/** Decrypt + apply any messages that arrived while locked. Called on unlock. */
export async function drainPendingIncoming(): Promise<void> {
  if (!isUnlockedNow()) return;
  const rows = await getAll<Setting<PendingIncoming>>('settings');
  for (const row of rows) {
    if (!row.key.startsWith(PENDING_INCOMING_PREFIX)) continue;
    const p = row.value;
    try {
      await receiveIncoming(p.from, p.id, p.ciphertext);
    } catch (e) {
      console.warn('[messaging] failed to apply a pending message', e);
    }
    await remove('settings', row.key);
  }
}

/** Apply an inbound group membership card (create/update/leave). Mirrors
 *  handleContactCard: a side effect, never a stored message. */
async function handleGroupCard(from: string, card: GroupCard): Promise<void> {
  const self = getSelfUserId() ?? '';
  const existing = await getChat(card.groupId);

  // --- accept-first invitation flow ---

  if (card.t === 'invite') {
    // Already a member (have the group) → stale invite, ignore. The group chat is
    // deliberately NOT created here; that's what keeps pre-join history out.
    if (existing?.isGroup) return;
    // Upsert the inviter + co-members so names render in the invite (and later the
    // group). Does NOT write any chat.
    for (const m of card.members) {
      if (!m.id || m.id === self) continue;
      if (!(await getContact(m.id))) await addContactWithId(m.id, m.name);
    }
    const inviterId = card.inviter ?? from;
    const displayName = card.name || autoDisplayName(card.members, self);
    const others = card.members.filter((m) => m.id !== self && m.id !== inviterId).map((m) => firstName(m.name));
    await put<FriendRequest>('requests', {
      id: `ginv:${card.groupId}`,
      kind: 'group-invite',
      groupId: card.groupId,
      inviter: inviterId,
      name: card.name, // raw (may be ''); UI falls back to memberPreview
      avatar: card.avatar || groupAvatar(card.groupId),
      memberPreview: others.join(', '),
      roster: card.members,
      createdAt: now(),
      status: 'pending',
      direction: 'incoming',
    });
    const inviterName = (await getContact(inviterId))?.name ?? 'Someone';
    void notifyIncoming({ kind: 'request', name: inviterName, body: `invited you to "${displayName}"` });
    return;
  }

  if (card.t === 'accept') {
    // The invitee confirmed: move them from invited → member and re-broadcast the
    // full roster so everyone (incl. the new member) converges. Idempotent.
    if (!existing?.isGroup || existing.participantIds.includes(from)) return;
    const ts = card.at || now();
    existing.invitedIds = (existing.invitedIds ?? []).filter((id) => id !== from);
    existing.participantIds = [...existing.participantIds, from];
    const roster = await buildRoster([self, ...existing.participantIds]);
    applyAutoName(existing, roster, self);
    existing.rosterAt = ts;
    existing.updatedAt = now();
    await put('chats', existing);
    await sendGroupCard(existing.participantIds, groupCard(existing, 'update', roster, ts));
    return;
  }

  if (card.t === 'decline') {
    // Sent either way: invitee→inviter (declined) or inviter→invitee (cancelled).
    if (existing?.isGroup) {
      // We're the inviter: drop them from the pending set.
      if (existing.invitedIds?.includes(from)) {
        existing.invitedIds = existing.invitedIds.filter((id) => id !== from);
        existing.updatedAt = now();
        await put('chats', existing);
      }
    } else {
      // We're the invitee being cancelled: clear our pending invitation.
      if (await get<FriendRequest>('requests', `ginv:${card.groupId}`)) {
        await dropRequest(`ginv:${card.groupId}`);
      }
    }
    return;
  }

  if (card.t === 'leave') {
    if (existing?.isGroup) {
      existing.participantIds = existing.participantIds.filter((id) => id !== from);
      existing.updatedAt = now();
      await put('chats', existing);
    }
    return;
  }

  // If we're no longer in the roster, we've been removed, so drop the group.
  if (!card.members.some((m) => m.id === self)) {
    if (existing?.isGroup && (existing.rosterAt ?? 0) <= card.at) await remove('chats', card.groupId);
    return;
  }

  // Upsert co-member contacts so their names render in the group view.
  for (const m of card.members) {
    if (!m.id || m.id === self) continue;
    const c = await getContact(m.id);
    if (!c) {
      await addContactWithId(m.id, m.name);
    } else if (m.name && (c.name.trim() === '' || c.name === m.id.slice(0, 8))) {
      c.name = m.name;
      if (!c.avatar) c.avatar = initialsAvatar(m.name);
      c.updatedAt = now();
      await put('contacts', c);
    }
  }

  const participantIds = card.members.map((m) => m.id).filter((id) => id !== self);
  // Empty card.name → auto-derive a display name from the other members.
  const autoName = !card.name;
  const displayName = card.name || autoDisplayName(card.members, self);
  if (existing?.isGroup) {
    if ((existing.rosterAt ?? 0) > card.at) return; // stale → ignore (last-write-wins)
    existing.name = displayName;
    existing.autoName = autoName;
    // card.avatar present → a custom photo was set; absent → revert to default icon.
    existing.avatar = card.avatar || groupAvatar(card.groupId);
    existing.customAvatar = !!card.avatar;
    existing.participantIds = participantIds;
    existing.rosterAt = card.at;
    existing.updatedAt = now();
    await put('chats', existing);
  } else {
    await put<Chat>('chats', {
      id: card.groupId,
      name: displayName,
      avatar: card.avatar || groupAvatar(card.groupId),
      isGroup: true,
      participantIds,
      lastMessage: '',
      lastMessageTime: now(),
      unread: 0,
      rosterAt: card.at,
      autoName,
      customAvatar: !!card.avatar,
      updatedAt: now(),
    });
  }
}

/** Ensure a group chat exists locally (placeholder if a message beats its card). */
async function ensureGroupChat(groupId: string, from: string): Promise<void> {
  if (await getChat(groupId)) return;
  const self = getSelfUserId() ?? '';
  await put<Chat>('chats', {
    id: groupId,
    name: 'Group',
    avatar: groupAvatar(groupId),
    isGroup: true,
    participantIds: from && from !== self ? [from] : [],
    lastMessage: '',
    lastMessageTime: now(),
    unread: 0,
    autoName: true,
    customAvatar: false,
    updatedAt: now(),
  });
}

/**
 * Apply an inbound relayed message: ensure a contact + 1:1 chat exist for the
 * sender, decrypt the sealed packet, and append the message (which surfaces in
 * the UI via useLiveQuery). Called by the sync engine on a 'msg' frame.
 *
 * While the keystore is LOCKED it instead stashes the (still-encrypted) message
 * for processing on unlock; the caller still acks it (delivery receipt fires),
 * but nothing is decrypted or surfaced behind the passcode gate.
 */
// Bounded ledger of inbound message ids we've already decrypted + applied, so a
// duplicate is skipped instead of re-running openPacket. A duplicate can arrive two
// ways: the sender's at-least-once re-send (outbox), or the relay re-delivering on
// reconnect a frame we'd received live but not yet acked. Re-running openPacket on a
// first/prekey duplicate would RE-establish and clobber the live Double Ratchet,
// desyncing the conversation; this guard prevents that without touching the genuine
// re-key path (a real re-key is a NEW message with a new id, so it isn't in the ledger).
const INBOUND_SEEN_KEY = 'inboundSeenIds';
const INBOUND_SEEN_CAP = 2000;
async function wasInboundSeen(id: string): Promise<boolean> {
  return (await getSetting<string[]>(INBOUND_SEEN_KEY, [])).includes(id);
}
async function markInboundSeen(id: string): Promise<void> {
  const seen = await getSetting<string[]>(INBOUND_SEEN_KEY, []);
  if (seen.includes(id)) return;
  seen.push(id);
  await setSetting<string[]>(INBOUND_SEEN_KEY, seen.slice(-INBOUND_SEEN_CAP));
}

// Serialize ALL inbound decrypts. The live path is already serialized through
// useSync's inboundChain, but drainPendingIncoming (messages received behind the
// lock) runs OFF that chain, so two receiveIncoming calls for the same id could
// otherwise overlap at the wasInboundSeen → openPacket → markInboundSeen await
// points, letting a duplicate re-establish (clobber) the live Double Ratchet. This
// module-level chain guarantees one inbound decrypt runs at a time.
let inboundSerial: Promise<void> = Promise.resolve();
export function receiveIncoming(from: string, remoteId: string, ciphertext: unknown): Promise<void> {
  const run = inboundSerial.then(() => receiveIncomingInner(from, remoteId, ciphertext));
  inboundSerial = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function receiveIncomingInner(from: string, remoteId: string, ciphertext: unknown): Promise<void> {
  if (!from) return;
  // Drop anything from a peer we've blocked, a backstop for frames that slipped
  // through before the server-side block took effect (or were already queued).
  if (await isPeerBlocked(from)) return;
  // Already decrypted + applied this exact frame → skip (the caller still acks, so the
  // server drops its queued copy). Prevents a duplicate re-establishing the ratchet.
  if (remoteId && (await wasInboundSeen(remoteId))) return;
  if (!isUnlockedNow()) {
    await queuePendingIncoming(from, remoteId, ciphertext);
    return;
  }

  let contact = await getContact(from);
  if (!contact) {
    await addContactWithId(from, '');
    contact = await getContact(from);
    // New inbound peer → pull their real name/photo/@username from the directory
    // (fire-and-forget; falls back to the next connect-time refresh).
    void hydrateContactFromDirectory(from);
  }
  if (!contact) return;
  // Open in-network inbox: the network is invite-only but internally everyone is
  // discoverable, so any member can message any member; there is no longer a
  // friend-request gate. A first message is shown immediately. We record the
  // sender as connected so their chat stays visible (and a stale legacy
  // 'request' card from an old client can't re-hide it).
  if (!(await isPeerConnected(from))) await markContactConnected(from);
  const chatId = await startDirectChat(contact);
  const ch = await getChat(chatId);
  if (ch?.pending) await setChatPending(chatId, false);

  let payload;
  try {
    payload = await openPacket(chatId, ciphertext);
  } catch (e) {
    console.warn('[messaging] failed to open incoming message', e);
    // Undecryptable most often means we deleted the chat (losing our ratchet) while
    // the peer kept theirs and sent a NORMAL packet, so we have no session and no
    // prekey to establish one. Don't silently lose it: ask the peer to re-key (and
    // resend), which re-establishes the session and recovers their undelivered
    // messages. Debounced, so a burst can't storm. We still leave this frame
    // unmarked; the peer's resend (with a fresh session) is what actually delivers it.
    void requestRekey(chatId, from);
    return;
  }
  // Session-reset control: the peer couldn't decrypt something of ours and asked us
  // to re-key. Their packet already re-established the session (a fresh prekey); now
  // resend our still-undelivered messages so they arrive under the new session. Never
  // stored or shown.
  if (payload.rekey) {
    await resendRecentOutgoing(chatId);
    if (remoteId) await markInboundSeen(remoteId);
    return;
  }
  // NOTE: each success path below records the id via markInboundSeen AFTER its durable
  // effect (the stored message / applied side effect), not here. Marking after the
  // ratchet advanced but BEFORE the row is stored would, on a crash in that window,
  // skip the redelivery that could otherwise re-establish + recover a first message.

  // Contact cards (friend request / accept / profile update) are applied as a
  // side effect, never stored or shown as a chat message.
  if (payload.card) {
    await handleContactCard(from, chatId, payload.card);
    if (remoteId) await markInboundSeen(remoteId);
    return;
  }
  // Group membership cards → side effect, never a stored message.
  if (payload.group) {
    await handleGroupCard(from, payload.group);
    if (remoteId) await markInboundSeen(remoteId);
    return;
  }
  // Emoji reactions → mutate the target message, never a stored message. (A group
  // reaction also carries groupId; the messageId lookup handles either case.)
  if (payload.reaction) {
    await handleReaction(from, payload.reaction);
    if (remoteId) await markInboundSeen(remoteId);
    return;
  }
  // Poll votes → mutate the target poll, never a stored message.
  if (payload.pollVote) {
    await handlePollVote(from, payload.pollVote);
    if (remoteId) await markInboundSeen(remoteId);
    return;
  }

  // A group message arrives over a 1:1 session but belongs to the group chat.
  const isGroupMsg = !!payload.groupId;
  const targetChatId = payload.groupId ?? chatId;
  if (payload.groupId) await ensureGroupChat(payload.groupId, from);

  const ts = payload.timestamp || now();
  const kind = (payload.kind as MessageKind) || 'text';

  // If the message carries media, download + decrypt the ciphertext and store
  // the plaintext blob locally (it never leaves the device unencrypted). Videos
  // can be deferred (auto-download setting): we keep the reference + thumbnail and
  // fetch the full clip on demand.
  let mediaId: string | undefined;
  let durationSec: number | undefined = payload.mediaRef?.durationSec;
  let pendingMedia: MediaRef | undefined;
  if (payload.mediaRef) {
    const defer = kind === 'video' && !payload.videoNote && !(await shouldAutoDownloadVideo());
    if (defer) {
      pendingMedia = payload.mediaRef; // fetched later via downloadMessageMedia
    } else {
      try {
        const blob = await receiveIncomingMedia(payload.mediaRef);
        if (blob) {
          mediaId = uid();
          await put<Media>('media', {
            id: mediaId,
            kind: kind as Media['kind'],
            mime: payload.mediaRef.mime,
            name: payload.mediaRef.name,
            size: payload.mediaRef.size,
            blob,
            durationSec,
            updatedAt: now(),
          });
        } else {
          pendingMedia = payload.mediaRef;
        }
      } catch (e) {
        console.warn('[messaging] failed to fetch incoming media', e);
        pendingMedia = payload.mediaRef; // allow a manual retry
      }
    }
  }

  const message: Message = {
    // Use the sender's message id so a read receipt we send back correlates to
    // their message; also dedupes a re-delivered message (same id → overwrite).
    id: remoteId || uid(),
    chatId: targetChatId,
    senderId: from,
    senderName: contact.name,
    body: payload.body,
    kind,
    mediaId,
    durationSec,
    timestamp: ts,
    outgoing: false,
    status: 'delivered',
    replyTo: payload.reply,
    albumId: payload.albumId,
    albumName: payload.albumName,
    videoNote: payload.videoNote,
    location: payload.location,
    poll: payload.poll,
    contact: payload.contact,
    audio: payload.audio,
    mediaWidth: payload.mediaRef?.width,
    mediaHeight: payload.mediaRef?.height,
    mediaSize: payload.mediaRef?.size,
    mediaQuality: payload.mediaRef?.quality as Message['mediaQuality'],
    posterData: payload.mediaRef?.poster,
    pendingMedia,
    updatedAt: now(),
  };
  await put('messages', message);

  const preview = payload.albumName
    ? payload.albumName
    : kind === 'location'
      ? payload.location?.label || 'Location'
      : kind === 'poll'
        ? payload.poll?.question || 'Poll'
        : kind === 'contact'
          ? payload.contact?.name || 'Contact'
          : kind === 'audio'
            ? payload.audio?.title || mediaPreview('audio', durationSec, payload.mediaRef?.name)
            : payload.body || mediaPreview(kind, durationSec, undefined, payload.videoNote);
  const chat = await getChat(targetChatId);
  if (chat) {
    // Group previews show the sender's first name (WhatsApp-style).
    chat.lastMessage = isGroupMsg ? `${contact.name.split(' ')[0]}: ${preview}` : preview;
    chat.lastKind = previewKind(kind, payload.albumName, payload.videoNote);
    chat.lastMessageTime = ts;
    chat.interactions = (chat.interactions ?? 0) + 1;
    // If the user is actively viewing this chat, the message is seen on arrival
    // (the open chat sends the read receipt), so don't grow the unread badge.
    chat.unread = isChatActive(targetChatId) ? 0 : (chat.unread ?? 0) + 1;
    chat.updatedAt = now();
    await put('chats', chat);
  }

  // Surface the message: in-app banner/sound if focused on another tab, or an
  // OS notification if backgrounded, all gated by the user's notification
  // settings (see services/notify). Skipped for the chat being viewed.
  void notifyIncoming({
    kind: 'message',
    chatId: targetChatId,
    name: chat?.isGroup ? chat.name : contact.name,
    // The notification spells out shared location / contact / poll (no icon to lean
    // on), unlike the terser `preview` used for the chats list above.
    body: isGroupMsg ? `${contact.name}: ${notifyPreview(payload)}` : notifyPreview(payload) || 'New message',
  });

  // Durably stored now → record so a duplicate re-send/redelivery is skipped. Marked
  // here (after the row is persisted) so a crash mid-processing leaves it UNmarked,
  // letting a redelivery re-establish + recover a first message.
  if (remoteId) await markInboundSeen(remoteId);
}

/** Remove all on-device media blobs and detach them from their messages. */
export async function clearAllMedia(): Promise<void> {
  const messages = await getAll<Message>('messages');
  await clearStore('media');
  for (const m of messages) {
    if (m.mediaId) {
      m.mediaId = undefined;
      m.updatedAt = now();
      await put('messages', m);
    }
  }
}

/* ---- granular media cleanup (by type / by size, globally or per-chat) ---- */

interface MediaSelector {
  kinds?: Media['kind'][]; // restrict to these media kinds
  minBytes?: number; // only blobs at least this large
  chatId?: string; // restrict to one conversation
}

/** Select the media blobs matching a cleanup selector. */
async function selectMedia(opts: MediaSelector): Promise<Media[]> {
  let pool = await getAll<Media>('media');
  if (opts.chatId) {
    const msgs = await getByIndex<Message>('messages', 'chatId', opts.chatId);
    const inChat = new Set(msgs.map((m) => m.mediaId).filter((id): id is string => !!id));
    pool = pool.filter((m) => inChat.has(m.id));
  }
  return pool.filter(
    (m) =>
      (!opts.kinds || opts.kinds.includes(m.kind)) &&
      (opts.minBytes === undefined || m.size >= opts.minBytes),
  );
}

/** Remove the given media blobs and detach them from their messages (the message
 *  stays, showing "media unavailable"). Returns bytes freed. */
async function deleteSelectedMedia(selected: Media[]): Promise<number> {
  if (!selected.length) return 0;
  const ids = new Set(selected.map((m) => m.id));
  const freed = selected.reduce((n, m) => n + m.size, 0);
  for (const id of ids) await remove('media', id);
  const messages = await getAll<Message>('messages');
  for (const msg of messages) {
    if (msg.mediaId && ids.has(msg.mediaId)) {
      msg.mediaId = undefined;
      msg.updatedAt = now();
      await put('messages', msg);
    }
  }
  return freed;
}

/** Delete all media of the given kind(s), optionally within one chat. Returns
 *  bytes freed. (media/messages aren't own-synced, so no tombstones needed.) */
export async function deleteMediaByKind(kinds: Media['kind'][], chatId?: string): Promise<number> {
  return deleteSelectedMedia(await selectMedia({ kinds, chatId }));
}

/** Delete all media at least `minBytes` large, optionally within one chat. */
export async function deleteMediaLargerThan(minBytes: number, chatId?: string): Promise<number> {
  return deleteSelectedMedia(await selectMedia({ minBytes, chatId }));
}

/** Preview a cleanup: bytes + count that WOULD be freed, without deleting. */
export async function mediaCleanupPreview(opts: MediaSelector): Promise<{ bytes: number; count: number }> {
  const sel = await selectMedia(opts);
  return { bytes: sel.reduce((n, m) => n + m.size, 0), count: sel.length };
}

/* ---- global search across everything ---- */

export interface GlobalSearchResults {
  chats: Chat[];
  messages: Message[];
  contacts: Contact[];
  calls: Call[];
}

export async function globalSearch(q: string): Promise<GlobalSearchResults> {
  if (!q.trim()) return { chats: [], messages: [], contacts: [], calls: [] };
  const [chats, allMessages, contacts, calls] = await Promise.all([
    listChats(q),
    getAll<Message>('messages'),
    listContacts(q),
    listCalls(q),
  ]);
  return {
    chats,
    messages: allMessages
      .filter((m) => matches(m.body, q))
      .sort((a, b) => b.timestamp - a.timestamp),
    contacts,
    calls,
  };
}

/* ---- call history (logged locally; the server persists nothing) ---- */

/**
 * Log a call at dial/offer time. "Missed" only ever applies to an unanswered
 * INCOMING call (you missed it); an unanswered outgoing call is just an outgoing
 * call with no answer, never "missed". So an incoming row starts provisionally
 * missed (cleared on connect by finishCall), while an outgoing row starts not
 * missed. The callId IS the row id so the later updates find it. Drives the
 * Calls tab (useLiveQuery on 'calls').
 */
export async function createCall(meta: {
  callId: string;
  contactId: string;
  direction: 'incoming' | 'outgoing';
  video: boolean;
}): Promise<void> {
  const contact = await getContact(meta.contactId);
  const ts = now();
  const incoming = meta.direction === 'incoming';
  await put<Call>('calls', {
    id: meta.callId,
    contactId: meta.contactId,
    name: contact?.name ?? meta.contactId.slice(0, 8),
    avatar: contact?.avatar ?? initialsAvatar(contact?.name ?? meta.contactId),
    direction: meta.direction,
    missed: incoming, // provisional for incoming; outgoing is never "missed"
    video: meta.video,
    seen: !incoming, // only an incoming missed call counts toward the badge
    timestamp: ts,
    updatedAt: ts,
  });
}

/** Mark a call connected→ended with its duration + data used (clears the
 *  provisional missed). */
export async function finishCall(callId: string, durationSec: number, bytes = 0): Promise<void> {
  const call = await get<Call>('calls', callId);
  if (!call) return;
  call.missed = false;
  call.durationSec = durationSec;
  call.bytes = bytes;
  call.seen = true;
  call.updatedAt = now();
  await put('calls', call);
}

/**
 * Finalize an unanswered/declined call. It's only "missed" for an INCOMING call;
 * an unanswered OUTGOING call stays a plain outgoing call (no answer), not red,
 * not counted in the missed badge.
 */
export async function markCallMissed(callId: string): Promise<void> {
  const call = await get<Call>('calls', callId);
  if (!call) return;
  call.missed = call.direction === 'incoming';
  call.durationSec = 0;
  call.seen = call.direction !== 'incoming'; // outgoing never pings the badge
  call.updatedAt = now();
  await put('calls', call);
}

/* ---- invitations (pending placeholders + auto-accept) ---- */

const PENDING_INVITE_PREFIX = 'pendingInvite:';
const AUTO_ACCEPT_PREFIX = 'autoAcceptInvite:';

/** A code you generated and sent to someone, awaiting their join. */
export interface PendingInvite {
  code: string;
  label: string; // your note for who you sent it to (replaced by their profile on join)
  createdAt: number;
}

/** Record a sent invite code with your label (shows under Contacts → Invited). */
export async function addPendingInvite(code: string, label: string): Promise<void> {
  await setSetting<PendingInvite>(`${PENDING_INVITE_PREFIX}${code}`, {
    code,
    label: label.trim(),
    createdAt: now(),
  });
}

export async function listPendingInvites(): Promise<PendingInvite[]> {
  const rows = await getAll<Setting<PendingInvite>>('settings');
  return rows
    .filter((r) => r.key.startsWith(PENDING_INVITE_PREFIX))
    .map((r) => r.value)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function removePendingInvite(code: string): Promise<void> {
  await remove('settings', `${PENDING_INVITE_PREFIX}${code}`);
}

/** Cancel a sent invite for real: delete it server-side so it can no longer be
 *  redeemed, then drop the local placeholder. Best-effort on the server (offline
 *  still clears it locally; the unused code expires on its own anyway). Returns
 *  true when the server delete went through, false when only the local note was
 *  cleared, so the caller can warn that the code may still be live. */
export async function cancelSentInvite(code: string): Promise<boolean> {
  let serverOk = true;
  try {
    await cancelInvitation(code);
  } catch {
    serverOk = false; // offline / transient: the live code stays until it expires
  }
  await removePendingInvite(code);
  return serverOk;
}

export async function getPendingInvite(code: string): Promise<PendingInvite | undefined> {
  const row = await get<Setting<PendingInvite>>('settings', `${PENDING_INVITE_PREFIX}${code}`);
  return row?.value;
}

// Marks a redeemed code as fully processed, so the "joined Ring" notification
// fires exactly once (the server keeps returning the redeemed row on every poll).
const INVITE_HANDLED_PREFIX = 'inviteHandled:';
export async function isInviteHandled(code: string): Promise<boolean> {
  return getSetting<boolean>(`${INVITE_HANDLED_PREFIX}${code}`, false);
}
export async function markInviteHandled(code: string): Promise<void> {
  await setSetting<boolean>(`${INVITE_HANDLED_PREFIX}${code}`, true);
}

/** True if we already have a (non-pending) 1:1 chat with this peer, or an
 *  outstanding outgoing request to them, so an invite auto-connect needn't
 *  re-send (avoids a duplicate card desyncing the ratchet). */
export async function isLinkedOrRequested(peerUserId: string): Promise<boolean> {
  const req = await get<FriendRequest>('requests', peerUserId);
  if (req && req.direction === 'outgoing') return true;
  const chats = await getAll<Chat>('chats');
  return chats.some(
    (c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === peerUserId && !c.pending,
  );
}

/** Mark a user (who redeemed our code) as one to auto-accept on their request. */
export async function markAutoAccept(userId: string): Promise<void> {
  await setSetting<boolean>(`${AUTO_ACCEPT_PREFIX}${userId}`, true);
}

export async function shouldAutoAccept(userId: string): Promise<boolean> {
  return getSetting<boolean>(`${AUTO_ACCEPT_PREFIX}${userId}`, false);
}

export async function clearAutoAccept(userId: string): Promise<void> {
  await remove('settings', `${AUTO_ACCEPT_PREFIX}${userId}`);
}

export { bulkPut };
