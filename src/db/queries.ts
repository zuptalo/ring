/**
 * Read/write/search operations over the on-device stores. Search is plain
 * substring matching done in-memory, fine for on-device data sizes and works
 * across every field we care about. Swap for an indexed FTS later if needed.
 */
import { bulkPut, clearStore, get, getAll, getByIndex, put, remove } from './idb';
import { enqueue, removeOutboxByFrameId } from './outbox';
import { recordTombstone } from './tombstones';
import { callLogPreview } from './calllog';
import { uid } from '@/utils/uid';
import { capitalizeFirst } from '@/utils/text';
import { sliceOlder, sliceNewer, compareByTimeId } from '@/utils/chat-pagination';
import { initialsAvatar, groupAvatar, ghostAvatar } from '@/db/avatars';
import { fetchUserStatuses, blockUser, unblockUser, fetchBlocks, fetchDirectoryUser, cancelInvitation, connectLink, fetchPeerBundle, createPost as apiCreatePost, listPosts as apiListPosts, deletePost as apiDeletePost, keepAlivePost as apiKeepAlivePost, addPostEnvelopes as apiAddPostEnvelopes, removePostRecipient as apiRemovePostRecipient, submitEngagement as apiSubmitEngagement, listEngagement as apiListEngagement, recordPostView as apiRecordPostView, listPostViews as apiListPostViews, type ServerPost } from '@/services/api';
import { sealForChat, openPacket } from '@/services/messaging';
import { prepareOutgoingMedia, receiveIncomingMedia, getMaxBlobBytes, BlobUploadError, deleteBlob, uploadBlob, downloadBlob } from '@/services/media-transfer';
import { autoSaveIncomingMedia } from '@/services/media-autosave';
import { wallSyncedOnce } from '@/services/wall-load';
import { buildPost, wrapForNewAudience, openReceivedPost, sealPostEngagement, openPostEngagement, type AudienceMember, type PostPayload } from '@/services/posts';
import { b64urlToBytes } from '@/services/crypto/envelope';
import { getSecret, setSecret } from '@/db/secrets';
import { isUnlockedNow, getIdentityKeys } from '@/services/crypto/identity';
import { getSelfUserId, getSelfUsername } from '@/services/auth';
import { notifyIncoming, isChatActive, pushWakeActive } from '@/services/notify';
import { compressImage, compressVideo, achievedQuality } from '@/services/media-encode';
import { setCompressProgress, setUploadProgress, resetJobProgress, clearJobProgress } from '@/services/media-jobs';
import { readVideoMeta, readImageMeta, generateVideoPoster, makeImageThumb, deriveTiers, blobToDataUrl } from '@/utils/media-meta';
import { THUMB_TIERS } from '@/utils/thumbs';
import { notifyPreview } from '@/utils/notify-preview';
import { firstLink, buildLinkPreview } from '@/services/link-preview';
import { ensureHiddenLoaded, isRevealed, isHiddenKnown } from '@/services/hidden-state';
import { hiddenCallKeys } from '@/db/hidden-calls';
import type {
  MessagePayload, ContactCard, GroupCard, GroupMember, ReactionSignal, PollVoteSignal, MediaRef,
  EditSignal, EraseSignal, LinkPreviewSignal,
} from '@/services/crypto/message';
import type {
  Alert, Call, CallLog, Chat, ChatList, Contact, FriendRequest, Media, Message, MessageKind, Reaction, ReplyRef,
  GeoLocation, Poll, PollVote, SharedContact, AudioMeta, Setting, Post, PostEngagement, OutboxPost, OutboxItem, ChatDraft,
  DraftMedia, DraftMediaItem,
} from './types';

// WhatsApp-style cap on pinned chats.
export const MAX_PINNED_CHATS = 3;

const now = () => Date.now();
const matches = (haystack: string, q: string) =>
  haystack.toLowerCase().includes(q.trim().toLowerCase());

/* ---- chats ---- */

// Pinned chats sort above the rest; within each group, newest activity first. Used
// by both the main list and any filtered view so pins stay on top everywhere.
function chatOrder(a: Chat, b: Chat): number {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  return b.lastMessageTime - a.lastMessageTime;
}

export async function listChats(q = ''): Promise<Chat[]> {
  // The main list hides pending requests, archived chats, and locked chats (the
  // last two have their own views). Hidden chats (spec 1019) are also excluded
  // unless a reveal session is active — this is the single choke point every
  // filter chip composes over, so excluding here covers them all. Pinned-first,
  // then most-recent.
  const hidden = await ensureHiddenLoaded();
  const showHidden = isRevealed();
  // Fail CLOSED while the hidden set is still unknown (the keystore can be briefly
  // locked when the app opens — the list query may run behind the unlock gate). An
  // empty cache then is "we don't know yet", NOT "nothing hidden", so showing chats
  // would flash hidden ones before they're filtered. Return nothing until the set
  // loads; its success nudges a re-query (hidden-state), so this lasts only until
  // unlock. Users with no hidden set load an empty set even while locked → known →
  // unaffected.
  if (!showHidden && !isHiddenKnown()) return [];
  const chats = (await getAll<Chat>('chats')).filter(
    (c) => !c.pending && !c.archived && !c.locked && (showHidden || !hidden.has(c.id)),
  );
  const filtered = q
    ? chats.filter((c) => matches(c.name, q) || matches(c.lastMessage, q))
    : chats;
  // During a reveal session, surface the just-revealed hidden chats at the VERY top
  // (above pins) so they're easy to find for the short time they're visible; the
  // rest keep their normal pinned-then-recent order. Outside a reveal, hidden chats
  // aren't in the list at all, so this is a no-op.
  if (showHidden) {
    return filtered.sort((a, b) => {
      const ah = hidden.has(a.id), bh = hidden.has(b.id);
      if (ah !== bh) return ah ? -1 : 1;
      return chatOrder(a, b);
    });
  }
  return filtered.sort(chatOrder);
}

/** Archived chats (the "Archived" view). Excludes locked chats. */
export async function listArchivedChats(q = ''): Promise<Chat[]> {
  const chats = (await getAll<Chat>('chats')).filter((c) => !c.pending && c.archived && !c.locked);
  const filtered = q ? chats.filter((c) => matches(c.name, q) || matches(c.lastMessage, q)) : chats;
  return filtered.sort(chatOrder);
}

/** Locked chats (the "Locked chats" view, gated by the app's auth). */
export async function listLockedChats(q = ''): Promise<Chat[]> {
  const chats = (await getAll<Chat>('chats')).filter((c) => !c.pending && c.locked);
  const filtered = q ? chats.filter((c) => matches(c.name, q) || matches(c.lastMessage, q)) : chats;
  return filtered.sort(chatOrder);
}

export function getChat(id: string): Promise<Chat | undefined> {
  return get<Chat>('chats', id);
}

/** Clear a chat's unread state (called when the conversation is opened). Also clears a
 *  manual "marked unread" flag. */
export async function markChatRead(chatId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (chat && (chat.unread || chat.manualUnread || chat.unreadMentions)) {
    chat.unread = 0;
    delete chat.manualUnread;
    chat.unreadMentions = 0; // @mentions seen when the chat is read (spec 1020)
    chat.updatedAt = now();
    await put('chats', chat);
  }
}

/** Mark a chat unread from the list (no unread messages needed): sets a manual flag
 *  that the Unread filter + the row's unread dot honour. Cleared on open/send. */
export async function markChatUnread(chatId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat || chat.unread || chat.manualUnread) return;
  chat.manualUnread = true;
  chat.updatedAt = now();
  await put('chats', chat);
}

/** Whether a chat counts as unread (real unread messages OR a manual mark). */
export function chatIsUnread(chat: Chat): boolean {
  return chat.unread > 0 || !!chat.manualUnread;
}

/** Toggle a chat's Favorite flag; returns the new state. */
export async function toggleChatFavorite(chatId: string): Promise<boolean> {
  const chat = await getChat(chatId);
  if (!chat) return false;
  chat.favorite = !chat.favorite;
  chat.updatedAt = now();
  await put('chats', chat);
  return !!chat.favorite;
}

/** Pin/unpin a chat. Returns false (and makes no change) if pinning would exceed
 *  MAX_PINNED_CHATS, so the caller can surface a toast. */
export async function setChatPinned(chatId: string, pinned: boolean): Promise<boolean> {
  const chat = await getChat(chatId);
  if (!chat) return false;
  if (pinned && !chat.pinned) {
    const count = (await getAll<Chat>('chats')).filter((c) => c.pinned && !c.archived).length;
    if (count >= MAX_PINNED_CHATS) return false;
  }
  if (pinned) chat.pinned = true;
  else delete chat.pinned;
  chat.updatedAt = now();
  await put('chats', chat);
  return true;
}

/** Archive/unarchive a chat (moves it in/out of the Archived view). Unarchiving on a
 *  new message is the caller's concern; this is the explicit user toggle. */
export async function setChatArchived(chatId: string, archived: boolean): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  if (archived) {
    chat.archived = true;
    delete chat.pinned; // archived chats aren't pinned in the main list
  } else delete chat.archived;
  chat.updatedAt = now();
  await put('chats', chat);
}

/** Archive every chat currently in the main list (the "Archive all chats" action).
 *  Mirrors listChats' scope: skips pending requests, locked chats, and hidden chats
 *  (those have their own views and must not be swept here). Returns the count. */
export async function archiveAllChats(): Promise<number> {
  const hidden = await ensureHiddenLoaded();
  const chats = await getAll<Chat>('chats');
  let n = 0;
  for (const chat of chats) {
    if (chat.pending || chat.archived || chat.locked || hidden.has(chat.id)) continue;
    chat.archived = true;
    delete chat.pinned;
    chat.updatedAt = now();
    await put('chats', chat);
    n += 1;
  }
  return n;
}

/** Lock/unlock a chat (moves it in/out of the auth-gated Locked chats view). */
export async function setChatLocked(chatId: string, locked: boolean): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  if (locked) chat.locked = true;
  else delete chat.locked;
  chat.updatedAt = now();
  await put('chats', chat);
}

/** Clear a chat's messages but KEEP the conversation (and its ratchet session). The
 *  row stays in place; only its history + preview are wiped. */
export async function clearChat(chatId: string): Promise<void> {
  const msgs = await getByIndex<Message>('messages', 'chatId', chatId);
  for (const m of msgs) await remove('messages', m.id);
  const chat = await getChat(chatId);
  if (chat) {
    chat.lastMessage = '';
    chat.lastKind = undefined;
    chat.unread = 0;
    delete chat.manualUnread;
    chat.updatedAt = now();
    await put('chats', chat);
  }
}

/* ---- chat lists (user-defined filter lists) ---- */

/** All custom lists, alphabetical. */
export async function listChatLists(): Promise<ChatList[]> {
  return (await getAll<ChatList>('chatlists')).sort((a, b) => a.name.localeCompare(b.name));
}

export function getChatList(id: string): Promise<ChatList | undefined> {
  return get<ChatList>('chatlists', id);
}

export async function createChatList(name: string, chatIds: string[] = []): Promise<string> {
  const id = uid();
  await put('chatlists', { id, name: name.trim(), chatIds: [...new Set(chatIds)], updatedAt: now() });
  return id;
}

export async function renameChatList(id: string, name: string): Promise<void> {
  const list = await getChatList(id);
  if (!list) return;
  list.name = name.trim();
  list.updatedAt = now();
  await put('chatlists', list);
}

export async function setChatListMembers(id: string, chatIds: string[]): Promise<void> {
  const list = await getChatList(id);
  if (!list) return;
  list.chatIds = [...new Set(chatIds)];
  list.updatedAt = now();
  await put('chatlists', list);
}

/** Add/remove a single chat to/from a list (used by the per-chat "Add to list"). */
export async function setChatInList(listId: string, chatId: string, member: boolean): Promise<void> {
  const list = await getChatList(listId);
  if (!list) return;
  const has = list.chatIds.includes(chatId);
  if (member && !has) list.chatIds.push(chatId);
  else if (!member && has) list.chatIds = list.chatIds.filter((c) => c !== chatId);
  else return;
  list.updatedAt = now();
  await put('chatlists', list);
}

/** Delete a custom list (tombstoned so a pull/own-sync can't resurrect it). */
export async function deleteChatList(id: string): Promise<void> {
  const deletedAt = now();
  await recordTombstone('chatlists', id, deletedAt);
  await enqueue({ t: 'tombstone', store: 'chatlists', recordId: id, deletedAt });
  await remove('chatlists', id);
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

/* ---- bounded chat-history reads (spec 1011, research D2) ----
   The chat view sources its window from these batches instead of holding the whole
   chat (the churn root behind the old `useLiveQuery(listMessages)`). They reuse the
   existing single `chatId` index (one getByIndex) + an in-memory sort/slice — no new
   index, no DB_VERSION bump. `listMessages` (loads-all) stays for search and the other
   callers (media/docs/links browsers, exports). Ordering is deterministic by
   (timestamp, id); the slice helpers dedupe the seam so adjacent batches never return
   the cursor row twice. The optional `q` keeps the existing substring filter. */

/** The `limit` messages immediately OLDER than `beforeTs` (the newest `limit` when
 *  null), oldest→newest. */
export async function listMessagesOlder(
  chatId: string,
  beforeTs: number | null,
  limit: number,
  q = '',
): Promise<Message[]> {
  const msgs = await getByIndex<Message>('messages', 'chatId', chatId);
  const filtered = q ? msgs.filter((m) => matches(m.body, q)) : msgs;
  filtered.sort(compareByTimeId);
  return sliceOlder(filtered, beforeTs, limit);
}

/** The `limit` messages immediately NEWER than `afterTs`, oldest→newest (scroll-down
 *  re-entry after eviction). */
export async function listMessagesNewer(
  chatId: string,
  afterTs: number,
  limit: number,
  q = '',
): Promise<Message[]> {
  const msgs = await getByIndex<Message>('messages', 'chatId', chatId);
  const filtered = q ? msgs.filter((m) => matches(m.body, q)) : msgs;
  filtered.sort(compareByTimeId);
  return sliceNewer(filtered, afterTs, limit);
}

/** Total messages in a chat (for "more above" detection + affordances). */
export async function countChatMessages(chatId: string): Promise<number> {
  return (await getByIndex<Message>('messages', 'chatId', chatId)).length;
}

/** Append a locally-authored message (starts `pending`) and update the chat.
 *  `replyTo` quotes another message above this one. */
export async function sendMessage(
  chatId: string,
  body: string,
  replyTo?: ReplyRef,
  mentions?: string[],
  mentionsEveryone?: boolean,
): Promise<void> {
  const ts = now();
  const chat = await getChat(chatId);
  await guardOutbound(chat);
  // @mentions are a GROUP concept only (spec 1020); ignore them in a 1:1.
  const ment = chat?.isGroup && mentions && mentions.length ? [...new Set(mentions)] : undefined;
  const everyone = chat?.isGroup && mentionsEveryone ? true : undefined;
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
    mentions: ment,
    mentionsEveryone: everyone,
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
  const payload: MessagePayload = { body, kind: 'text', timestamp: ts, reply: replyTo, mentions: ment, mentionsEveryone: everyone };
  if (chat?.isGroup) await sealAndEnqueueGroup(chat, message.id, payload);
  else await sealAndEnqueue(chat, message.id, payload);

  // Link preview: build it in the background (a relay round-trip + downscale) and
  // patch it in once ready, so the text isn't held up. Best-effort and gated by
  // the privacy toggle. Fire-and-forget — never awaited, never blocks the send.
  const link = firstLink(body);
  if (link && !(await getSetting<boolean>('privacy.disableLinkPreviews', false))) {
    void attachLinkPreview(message.id, link);
  }
}

/** If the chat has disappearing messages on, stamp the (real, stored) message and
 *  its outgoing payload with an expiry, so both sides sweep it. No-op for control
 *  signals (cards/rekey/ttl), which have no stored message row. */
async function stampExpiry(chat: Chat, messageId: string, payload: MessagePayload): Promise<void> {
  if (!chat.defaultTtlMs) return;
  const m = await getMessage(messageId);
  if (!m || m.expiresAt) return;
  const exp = (payload.timestamp || m.timestamp || now()) + chat.defaultTtlMs;
  payload.expiresAt = exp;
  m.expiresAt = exp;
  await put('messages', m);
}

/** Seal a payload for the chat's peer and enqueue it for relay, if possible. */
async function sealAndEnqueue(
  chat: Chat | undefined,
  messageId: string,
  payload: MessagePayload,
): Promise<void> {
  const peerUserId = chat?.participantIds[0];
  if (!chat || !peerUserId) return;
  await stampExpiry(chat, messageId, payload);
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
  await stampExpiry(chat, messageId, payload); // disappearing messages: one stamp, fanned out
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

/** Up to 3 reactions per person on a single message (Teams-style). */
export const MAX_REACTIONS_PER_USER = 3;

/** Cap on how many DIFFERENT emojis a single message can carry across everyone. Once
 *  a message has this many distinct emojis, no one can introduce a new one — they can
 *  only pile onto an existing emoji. Keeps a message's reaction set bounded/sane. */
export const MAX_DISTINCT_REACTIONS = 5;

/** Apply a reaction change to a message in place (shared by local + inbound).
 *  Up to MAX_REACTIONS_PER_USER per user, toggled per emoji; `at` resolves
 *  out-of-order updates so a stale frame can't override a newer choice. */
function applyReaction(
  message: Message,
  userId: string,
  emoji: string,
  remove: boolean,
  at: number,
): void {
  const list = message.reactions ?? [];
  // Reactions are now per (user, emoji): a user can hold up to 3 distinct emoji on one
  // message (Teams-style), each toggled independently. Staleness is per (user, emoji).
  const existing = list.find((r) => r.userId === userId && r.emoji === emoji);
  if (existing && existing.at > at) return; // stale update for this exact reaction
  const next: Reaction[] = list.filter((r) => !(r.userId === userId && r.emoji === emoji));
  if (!remove) {
    if (next.filter((r) => r.userId === userId).length >= MAX_REACTIONS_PER_USER) return; // at cap
    next.push({ userId, emoji, at });
  }
  message.reactions = next;
  message.updatedAt = now();
}

/** Toggle one of the local user's reactions on a message and propagate it to the chat
 *  (the peer for 1:1, every member for a group). Tapping an emoji you already used on
 *  this message clears it; tapping a new one adds it (up to MAX_REACTIONS_PER_USER).
 *  Returns what happened so the UI can nudge when the cap is hit. Works on your own
 *  messages too. */
export async function reactToMessage(
  messageId: string,
  emoji: string,
): Promise<'added' | 'removed' | 'limit' | 'limit-emojis'> {
  const message = await getMessage(messageId);
  if (!message) return 'removed';
  const self = getSelfUserId() ?? '';
  const mine = (message.reactions ?? []).filter((r) => r.userId === self);
  const has = mine.some((r) => r.emoji === emoji);
  if (!has) {
    // Adding (not toggling off): enforce both caps client-side at the emit site.
    if (mine.length >= MAX_REACTIONS_PER_USER) return 'limit'; // your own 3-reaction cap
    // Per-message distinct-emoji cap: a brand-new emoji is blocked once the message
    // already carries MAX_DISTINCT_REACTIONS different ones; piling onto an existing
    // emoji is always allowed. Every up-to-date client gates its own user this way,
    // so nobody contributes a 6th distinct emoji (kept as an emit gate, not an
    // inbound drop, so reaction state stays convergent across devices).
    const distinct = new Set((message.reactions ?? []).map((r) => r.emoji));
    if (!distinct.has(emoji) && distinct.size >= MAX_DISTINCT_REACTIONS) return 'limit-emojis';
  }
  const remove = has; // tapping one of your existing emoji clears just that one
  const at = now();
  applyReaction(message, self, emoji, remove, at);
  await put('messages', message);
  if (!remove) void recordEmojiUse(emoji); // most-used drives the quick-react order

  const chat = await getChat(message.chatId);
  if (!chat) return remove ? 'removed' : 'added';
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
  return remove ? 'removed' : 'added';
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

/** Delete a message locally (and its media blob), leaving no trace — the row
 *  is gone outright. The chat preview is recomputed so a vanished last message
 *  can't linger in the chats list. */
export async function deleteMessage(messageId: string): Promise<void> {
  const m = await getMessage(messageId);
  if (!m) return;
  if (m.mediaId) await remove('media', m.mediaId);
  await remove('messages', messageId);
  await refreshChatPreview(m.chatId);
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
  await refreshChatPreview(m.chatId);
}

/** Recompute a chat's list preview from its newest remaining message — needed
 *  after an edit or a deletion touches what WAS the latest message (a no-trace
 *  delete especially must not leave the vanished text in the chats list). The
 *  group "Name: " prefix is rebuilt for received messages. */
async function refreshChatPreview(chatId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  const msgs = (await getByIndex<Message>('messages', 'chatId', chatId)).sort(
    (a, b) => b.timestamp - a.timestamp,
  );
  const newest = msgs[0];
  if (!newest) {
    chat.lastMessage = '';
    chat.lastKind = 'text';
  } else {
    const text = newest.deleted
      ? 'This message was deleted'
      : newest.albumName || previewText(newest);
    chat.lastMessage =
      chat.isGroup && !newest.outgoing && !newest.deleted
        ? `${newest.senderName.split(' ')[0]}: ${text}`
        : text;
    chat.lastKind = newest.deleted
      ? 'text'
      : previewKind(newest.kind, newest.albumName, newest.videoNote);
    chat.lastMessageTime = newest.timestamp;
  }
  chat.updatedAt = now();
  await put('chats', chat);
}

/** Rewrite the text of one of the local user's own messages and propagate the
 *  edit to the chat (the peer for 1:1, every member for a group). The receiving
 *  side applies it only while its copy isn't deleted — so a message stays
 *  editable just as long as neither side has deleted it. */
export async function editMessage(messageId: string, body: string): Promise<void> {
  const m = await getMessage(messageId);
  if (!m || m.senderId !== 'me' || m.deleted || m.kind !== 'text') return;
  const text = body.trim();
  if (!text || text === m.body) return;
  const at = now();
  m.body = text;
  m.editedAt = at;
  m.updatedAt = at;
  await put('messages', m);
  await refreshChatPreview(m.chatId);
  const chat = await getChat(m.chatId);
  if (!chat) return;
  const payload: MessagePayload = {
    body: '',
    kind: 'edit',
    timestamp: at,
    edit: { messageId, body: text, at },
  };
  if (chat.isGroup) await sealAndEnqueueGroup(chat, uid(), payload);
  else await sealAndEnqueue(chat, uid(), payload);
}

/** Apply an inbound edit from `from` to the target message (side effect, never
 *  a stored message). Dropped unless it comes from the message's author, and
 *  dropped once we've deleted our copy (a deleted message can't be "un-deleted"
 *  into new content by an edit). */
async function handleEdit(from: string, signal: EditSignal): Promise<void> {
  const m = await getMessage(signal.messageId);
  if (!m || m.deleted || m.senderId !== from) return;
  if (signal.at <= (m.editedAt ?? 0)) return; // stale / out-of-order edit
  m.body = signal.body;
  m.editedAt = signal.at;
  m.updatedAt = now();
  await put('messages', m);
  await refreshChatPreview(m.chatId);
}

/** Generate a link preview for an already-sent text message and, if successful,
 *  patch it onto our copy and propagate it to the peer/group (a side effect, like
 *  an edit — never a new message). Best-effort: a failed/empty build leaves the
 *  message with its fetch-free domain-only card. */
async function attachLinkPreview(messageId: string, url: string): Promise<void> {
  const preview = await buildLinkPreview(url);
  if (!preview) return;
  // Re-load: the user may have edited (changing the URL) or deleted the message
  // while we were generating. Only attach if the link is still present.
  const m = await getMessage(messageId);
  if (!m || m.deleted || m.kind !== 'text' || !m.body.includes(url)) return;
  const at = now();
  m.linkPreview = preview;
  m.updatedAt = at;
  await put('messages', m);
  const chat = await getChat(m.chatId);
  if (!chat) return;
  const payload: MessagePayload = {
    body: '',
    kind: 'link-preview',
    timestamp: at,
    linkPreviewSig: { messageId, preview, at },
  };
  if (chat.isGroup) await sealAndEnqueueGroup(chat, uid(), payload);
  else await sealAndEnqueue(chat, uid(), payload);
}

/** Apply an inbound link-preview attach from `from` (side effect, never a stored
 *  message). Only the message's author may attach one, and not onto a deleted copy. */
async function handleLinkPreview(from: string, signal: LinkPreviewSignal): Promise<void> {
  const m = await getMessage(signal.messageId);
  if (!m || m.deleted || m.senderId !== from) return;
  m.linkPreview = signal.preview;
  m.updatedAt = now();
  await put('messages', m);
}

/** The author deleting their own message for everyone. `trace` (the default UX)
 *  leaves the "This message was deleted" placeholder on both sides; without it
 *  the message is removed outright everywhere — no trace in the conversation. */
export async function deleteMessageForEveryone(messageId: string, trace = true): Promise<void> {
  const m = await getMessage(messageId);
  if (!m || m.senderId !== 'me') return;
  const at = now();
  const chat = await getChat(m.chatId);
  if (trace) await softDeleteMessage(messageId);
  else await deleteMessage(messageId);
  if (!chat) return;
  const payload: MessagePayload = {
    body: '',
    kind: 'erase',
    timestamp: at,
    erase: { messageId, trace, at },
  };
  if (chat.isGroup) await sealAndEnqueueGroup(chat, uid(), payload);
  else await sealAndEnqueue(chat, uid(), payload);
}

/** Apply an inbound delete-for-everyone from `from` (side effect, never a
 *  stored message). Only the message's author may erase it. */
async function handleErase(from: string, signal: EraseSignal): Promise<void> {
  const m = await getMessage(signal.messageId);
  if (!m || m.senderId !== from) return;
  if (signal.trace) await softDeleteMessage(m.id);
  else await deleteMessage(m.id);
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

/**
 * Spec 1013: stamp `seenReportedAt` on the given INCOMING messages — this device has accounted
 * them Seen. Drives the not-yet-Seen pill (a write notifies the change bus, so the count
 * recomputes) and dedups receipt sends. Skips outgoing/own and any already stamped, so it's a
 * cheap idempotent no-op when nothing is new. Returns the ids it actually stamped.
 */
export async function markMessagesSeenReported(ids: readonly string[], at: number): Promise<string[]> {
  const stamped: string[] = [];
  for (const id of ids) {
    const m = await getMessage(id);
    if (!m || m.outgoing || m.senderId === 'me' || m.seenReportedAt != null) continue;
    m.seenReportedAt = at;
    m.updatedAt = now();
    await put('messages', m);
    stamped.push(id);
  }
  return stamped;
}

/** The starred (favorited) messages in a chat, newest first. */
export async function listStarred(chatId: string): Promise<Message[]> {
  const msgs = await getByIndex<Message>('messages', 'chatId', chatId);
  return msgs.filter((m) => m.favorite && !m.deleted).sort((a, b) => b.timestamp - a.timestamp);
}

/** The id of the first message in a chat at or after `sinceMs` (epoch ms), for
 *  jump-to-date. Null when the chat has no message that recent. */
export async function firstMessageOnOrAfter(chatId: string, sinceMs: number): Promise<string | null> {
  const msgs = (await getByIndex<Message>('messages', 'chatId', chatId)).sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  return msgs.find((m) => m.timestamp >= sinceMs)?.id ?? null;
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
      if (media?.blob) {
        await sendMediaMessage(cid, m.kind, media.blob, media.name, m.durationSec, {
          videoNote: m.videoNote,
          caption: m.body, // a forwarded photo keeps its caption, like WhatsApp
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

/** Hard cap on media captions. Chosen so a caption renders in full under the
 *  photo in the bubble and in the viewer's bottom overlay without burying the
 *  picture or needing a "…" truncation — roughly a short paragraph. Enforced
 *  everywhere a caption is written (composer paste-send, caption editor). */
export const CAPTION_MAX = 300;

/** Set/replace a media message's caption (its body). Local-only for now. */
export async function setCaption(messageId: string, text: string): Promise<void> {
  const m = await getMessage(messageId);
  if (!m) return;
  m.body = text.slice(0, CAPTION_MAX);
  m.updatedAt = now();
  await put('messages', m);
}

/* ---- conversation media/links/docs (the "All media" browser) ---- */

const URL_RE = /\bhttps?:\/\/[^\s]+/i;

/** All image/video messages in a chat, newest-first. */
export async function listChatMedia(chatId: string): Promise<Message[]> {
  const all = await listMessages(chatId);
  // Round video NOTES are conversational/ephemeral (like voice messages, which are already
  // excluded here) and play inline only — keep them OUT of the "Media, links & docs" gallery
  // and its fullscreen viewer. Regular videos still appear.
  // Media DELETED to free space (mediaCleared: record removed, mediaId gone) has nothing to
  // show, so it's dropped from the gallery — otherwise it leaves an empty placeholder tile
  // (spec 2007). "Freed keeping previews" is NOT cleared, so its preview still shows.
  return all
    .filter((m) => (m.kind === 'image' || (m.kind === 'video' && !m.videoNote)) && !m.mediaCleared)
    .reverse();
}
/** All blob-backed media messages in a chat (image/video/voice/audio), oldest→newest.
 *  The chat list is windowed (useChatHistory) but the media viewer + audio playlist span
 *  the WHOLE chat (spec 1005/1007), so they source from this whole-chat media subset —
 *  far smaller than every message, and not the scroll hot path. */
export async function listChatMediaAll(chatId: string): Promise<Message[]> {
  const all = await listMessages(chatId);
  // Exclude media deleted to free space (mediaCleared) — there's nothing to view/play, so it
  // must not produce a blank page in the fullscreen viewer or audio playlist (spec 2007).
  return all.filter(
    (m) =>
      (m.kind === 'image' || m.kind === 'video' || m.kind === 'voice' || m.kind === 'audio') &&
      !m.mediaCleared,
  );
}
/** All file (document) messages in a chat, newest-first. Excludes docs deleted to free
 *  space (mediaCleared) so they don't leave an empty row (spec 2007). */
export async function listChatDocs(chatId: string): Promise<Message[]> {
  return (await listMessages(chatId)).filter((m) => m.kind === 'file' && !m.mediaCleared).reverse();
}
/** All text messages containing a link, newest-first. (Links live in text bodies, not
 *  blob media, so storage cleanup never clears them.) */
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
    createdBy: chat.createdBy, // carry the owner so members can validate @everyone (spec 1020)
  };
}

/**
 * Create a group. The name is OPTIONAL: when empty, the display name is derived
 * from the members ("Fredi & Ailin" / "Kambiz & 6 more") per each viewer's
 * perspective, and a default group icon is used. Returns the group chat id.
 */
/** Connect (gate-link) to every group co-member, so message fan-out can fetch their
 *  prekey bundles under the connect-request gate (group membership is the consent).
 *  Best-effort + fire-and-forget; idempotent on the server. */
function linkGroupMembers(memberIds: string[]): void {
  const self = getSelfUserId() ?? '';
  for (const id of memberIds) {
    if (id && id !== self) void connectLink(id).catch(() => {});
  }
}

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
    createdBy: self, // group owner — v1 "admin" for @everyone gating (spec 1020)
    updatedAt: ts,
  });
  linkGroupMembers(memberIds); // connect to co-members so fan-out works under the gate
  await sendGroupCard(memberIds, {
    t: 'create',
    groupId,
    name: custom,
    members: roster,
    at: ts,
    createdBy: self, // tell members who the owner is (for @everyone validation, spec 1020)
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
  linkGroupMembers([memberId]); // connect to the new member so fan-out reaches them
  const ts = now();
  chat.participantIds = [...chat.participantIds, memberId];
  // Clear any stale pending invitation for this member (e.g. invited under the old
  // accept-first flow), so the "Invited" list doesn't keep a ghost entry.
  chat.invitedIds = (chat.invitedIds ?? []).filter((id) => id !== memberId);
  const roster = await buildRoster([self, ...chat.participantIds]);
  applyAutoName(chat, roster, self);
  chat.rosterAt = ts;
  chat.updatedAt = ts;
  await put('chats', chat);
  await sendGroupCard(chat.participantIds, groupCard(chat, 'update', roster, ts));
}

/** Add a member to a group: a saved contact joins immediately (membership is a natural
 *  extension of the contact relationship); a non-contact (e.g. a future "add from
 *  directory" path) still gets the accept-first invite so they can consent. The group
 *  member picker only offers contacts today, so this is immediate in practice. */
export async function addMemberToGroup(chatId: string, memberId: string): Promise<void> {
  const contact = await getContact(memberId);
  if (contact && !contact.ghosted) await addToGroup(chatId, memberId);
  else await inviteToGroup(chatId, memberId);
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
  linkGroupMembers([memberId]); // connect to the invitee so we can fetch their bundle
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
    quality?: 'sd' | 'hd' | 'fhd' | 'original';
    /** A ready-made thumbnail (data URL) to embed, e.g. a frame captured live by the
     *  video-note recorder — more reliable than decoding the recorded blob. */
    poster?: string;
    /** Caption typed alongside the media (the message body); receivers render it
     *  under the photo/video. Clamped to CAPTION_MAX. */
    caption?: string;
  },
): Promise<string> {
  const ts = now();
  const caption = (opts?.caption ?? '').slice(0, CAPTION_MAX);
  await guardOutbound(await getChat(chatId)); // reject before storing media for a ghosted/blocked peer
  const mediaId = uid();
  // The original blob is stored first so the background job can (re-)encode + retry
  // from it; runMediaJob swaps in the actually-sent (compressed) blob once the upload
  // succeeds, so the on-device copy and storage footprint match what was sent.
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
    body: caption,
    kind,
    mediaId,
    durationSec,
    timestamp: ts,
    outgoing: true,
    // All media goes through the background job (compress if needed → upload),
    // so every attachment gets uniform progress + retry/failed handling.
    status: 'compressing',
    compressQuality: compressible ? (opts!.quality as 'sd' | 'hd' | 'fhd') : undefined,
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
    // A caller-provided thumbnail (video-note recorder); runMediaJob may later replace
    // it with a first-frame poster if it can decode one, but this guarantees one.
    posterData: opts?.poster,
    updatedAt: ts,
  };
  await put('messages', message);

  if (chat) {
    // Caption-first preview, mirroring how the receiving side previews it.
    chat.lastMessage = opts?.albumName
      ? opts.albumName
      : kind === 'audio'
        ? opts?.audio?.title || name
        : caption || mediaPreview(kind, durationSec, name, opts?.videoNote);
    chat.lastKind = previewKind(kind, opts?.albumName, opts?.videoNote);
    chat.lastMessageTime = ts;
    chat.unread = 0;
    chat.interactions = (chat.interactions ?? 0) + 1;
    chat.updatedAt = ts;
    await put('chats', chat);
  }

  resetJobProgress(message.id);
  void processMediaJob(message.id); // background: (compress →) upload → pending / failed
  return message.id;
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
    // The caption rides in `body` — the receive path already stores payload.body
    // on media messages and renders it under the photo/video.
    body: message.body,
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
  // Remember the uploaded blob id so we can DELETE it from the server once every recipient
  // has downloaded the bytes (and on chat delete). Re-read the row to avoid clobbering a
  // concurrent status update from the send we just enqueued.
  const fresh = await getMessage(message.id);
  if (fresh) {
    fresh.sentBlobId = mediaRef.blobId;
    fresh.updatedAt = now();
    await put('messages', fresh);
  }
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
    if (!media?.blob) return; // a freed-original record can't be (re)sent — nothing to upload
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
      // Honest badge (spec 2007): label by what we actually sent, never by what was
      // requested. If the transcode couldn't shrink the clip it returns the original
      // blob, and this becomes 'original' so we never claim an HD/SD we didn't achieve.
      // sealMediaAndEnqueue copies message.mediaQuality onto the recipient's MediaRef,
      // so correcting it here fixes the badge on BOTH sides.
      if (message.kind === 'image' || message.kind === 'video') {
        message.mediaQuality = achievedQuality(message.compressQuality, media.blob.size, uploadBlob);
      }
      console.info('[media-job] encoded', {
        id: messageId,
        kind: message.kind,
        bytes: uploadBlob.size,
        requested: message.compressQuality ?? 'original',
        achieved: message.mediaQuality,
      });
      // Tag the bubble with resolution / length / size (persisted FIRST so the badge
      // shows even if the thumbnail step is slow), then best-effort thumbnail.
      if (message.kind === 'video') {
        const meta = await readVideoMeta(uploadBlob);
        message.mediaWidth = meta.width;
        message.mediaHeight = meta.height;
        message.durationSec = meta.durationSec ?? message.durationSec;
        message.mediaSize = uploadBlob.size;
        await put('messages', message);
        // Embed a first-frame poster for ALL videos, including round video notes, so
        // they show a thumbnail before/without playback (otherwise iOS shows nothing).
        // Skip if a poster is already embedded (e.g. the live frame the video-note
        // recorder captured) — don't overwrite a good frame with the often-black
        // first frame of the clip (camera warm-up).
        if (!message.posterData) {
          const poster = await generateVideoPoster(uploadBlob);
          if (poster) {
            message.posterData = poster;
            await put('messages', message);
          }
        }
      } else if (message.kind === 'image') {
        const meta = await readImageMeta(uploadBlob);
        message.mediaWidth = meta.width;
        message.mediaHeight = meta.height;
        message.mediaSize = uploadBlob.size;
        await put('messages', message);
        // Spec 1014: generate the bubble tier — it rides MediaRef.poster (so the recipient previews
        // before downloading the full image) and seeds the local tiers (posterBlob + derived
        // grid/strip). An image already within the bubble size IS its own bubble (small upload).
        if (!message.posterData && message.mediaId) {
          const big = Math.max(meta.width ?? 0, meta.height ?? 0);
          let bubble = await makeImageThumb(uploadBlob, THUMB_TIERS.bubble);
          if (!bubble && big > 0 && big <= THUMB_TIERS.bubble) bubble = uploadBlob;
          if (bubble) {
            message.posterData = await blobToDataUrl(bubble);
            await put('messages', message);
            await applyThumbTiers(message.mediaId, bubble);
          }
        }
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
      // Replace the sender's local copy with what was ACTUALLY sent (spec 2007): we
      // keep the original blob during the encode/upload so a retry can re-encode it,
      // but once the send succeeds, storing the full original wastes space and
      // overstates the storage footprint (storageByType sums Media.size) while the
      // bubble badge shows the smaller sent size. The user's true original still lives
      // in their photo library — Ring only ever held a copy. Only swap when a genuinely
      // smaller blob was produced (`uploadBlob !== media.blob`; compress* returns the
      // original ref otherwise), so 'original' sends are untouched. Done AFTER upload so
      // a failed/retried send still re-encodes from the original.
      if (uploadBlob !== media.blob && message.mediaId) {
        const m = await get<Media>('media', message.mediaId);
        if (m?.blob) {
          m.blob = uploadBlob;
          m.size = uploadBlob.size;
          m.mime = uploadBlob.type || m.mime;
          m.updatedAt = now();
          await put('media', m);
        }
      }
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
  if (m.status === 'sent' || m.status === 'delivered' || m.status === 'seen') return;
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

/** Spec 1014: persist the thumbnail tiers on a Media record from its bubble-tier blob — store it as
 *  `posterBlob` (bubble) and derive `posterGrid` (320) + `posterStrip` (128) locally. Works for both
 *  images (bubble from the sender's MediaRef.poster) and videos (bubble = the existing poster), so
 *  the grid + strip render right-sized for both. No-op when there's no bubble or the tiers exist. */
async function applyThumbTiers(mediaId: string, bubble: Blob | undefined): Promise<void> {
  if (!bubble) return;
  const media = await get<Media>('media', mediaId);
  if (!media || (media.posterGrid && media.posterStrip)) return; // gone or already derived
  try {
    const { grid, strip } = await deriveTiers(bubble);
    media.posterBlob = bubble;
    media.posterGrid = grid ?? bubble; // tiny source: reuse the larger tier
    media.posterStrip = strip ?? grid ?? bubble;
    media.updatedAt = now();
    await put<Media>('media', media);
  } catch (e) {
    console.warn('[media-thumbs] tier derive failed', e);
  }
}

/** Decode a poster data URL (MediaRef.poster) back to a Blob to seed the tiers on the receive side. */
async function bubbleFromDataUrl(dataUrl: string | undefined): Promise<Blob | undefined> {
  if (!dataUrl) return undefined;
  try {
    return await (await fetch(dataUrl)).blob();
  } catch {
    return undefined;
  }
}

/** Spec 1014 backfill: ensure the grid (320) + strip (128) tiers exist for media already on the
 *  device that predates them (images + videos). Bounded per call (`max`) so it never hogs the main
 *  thread, and idempotent — records that already carry both tiers are skipped. The bubble source is
 *  an existing poster (video poster / image bubble) or, for a tier-less image, one derived from the
 *  full blob. Returns how many records it upgraded. Callers pass the on-screen chat's mediaIds and
 *  schedule it at idle, so the media you're actually looking at upgrades first. */
export async function backfillThumbTiers(mediaIds: string[], max = 16): Promise<number> {
  let upgraded = 0;
  for (const id of mediaIds) {
    if (upgraded >= max) break;
    const media = await get<Media>('media', id);
    if (!media || (media.posterGrid && media.posterStrip)) continue; // gone or already tiered
    if (media.kind !== 'image' && media.kind !== 'video') continue;
    let bubble = media.posterBlob;
    const full = media.blob;
    if (!bubble && media.kind === 'image' && full) {
      // No poster yet: the bubble is a 512 downscale, or the (small) original itself.
      bubble = (await makeImageThumb(full, THUMB_TIERS.bubble)) ?? full;
    }
    if (!bubble) continue; // a video whose poster hasn't been generated yet — leave for that path
    await applyThumbTiers(id, bubble);
    upgraded++;
  }
  return upgraded;
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
  await applyThumbTiers(mediaId, await bubbleFromDataUrl(ref.poster)); // spec 1014 tiers from the sent poster
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
// Hidden calls (spec 1019, FR-019) are excluded from the Calls tab and the missed
// badge ALWAYS (even while revealed): the reveal session surfaces hidden chats to
// read, but the call history stays clean of any trace. `hiddenCallKeys` maps the
// hidden chat set to the call `contactId`s to drop (see src/db/hidden-calls.ts).
export async function listCallGroups(q = ''): Promise<CallGroup[]> {
  let calls = await listCalls(q); // newest first
  const hidden = await ensureHiddenLoaded();
  // Fail closed while the hidden set is unknown (locked at open): an empty cache is
  // "not loaded yet", not "nothing hidden", so showing calls could flash a hidden
  // chat's call history. Re-queries once the set loads (see listChats).
  if (!isHiddenKnown()) return [];
  if (hidden.size > 0) {
    const exclude = hiddenCallKeys(await getAll<Chat>('chats'), hidden);
    calls = calls.filter((c) => !exclude.has(c.contactId));
  }
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
  // Before wiping, free any media blobs WE uploaded that every recipient has already
  // downloaded (best-effort, fire-and-forget). Conservative: blobs still in flight to a
  // recipient are left to the server's age-based sweep rather than yanked out from under
  // them. (The eager per-message delete already handles the online case; this re-attempts
  // for any that failed while we were offline.)
  for (const m of msgs) {
    if (!m.outgoing || !m.sentBlobId) continue;
    const allDownloaded = m.receipts?.length
      ? m.receipts.every((r) => r.downloadedAt)
      : (m.downloadedBy?.length ?? 0) > 0;
    if (allDownloaded) void deleteBlob(m.sentBlobId).catch(() => {});
  }
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

/** Accepted friends: contacts whose peer is in the connected-peers ledger (i.e. an
 *  accepted connection), excluding blocked/ghosted peers. This is the audience source
 *  for Wall posts (spec 0003) — "all friends". */
export async function listFriends(): Promise<Contact[]> {
  const connected = await getConnectedPeers();
  const all = await getAll<Contact>('contacts');
  return all.filter((c) => connected[c.id] && !c.blocked && !c.ghosted);
}

/** Close friends: the curated subset of friends flagged `closeFriend`. Author-private
 *  (the flag never leaves the device); drives the "close friends" Wall audience. */
export async function listCloseFriends(): Promise<Contact[]> {
  return (await listFriends()).filter((c) => c.closeFriend);
}

/** Set/clear the author-private close-friend flag on a contact (spec 0003, US5).
 *  Demoting someone (close → not) revokes your close-only posts from them: their key
 *  envelopes are dropped server-side and their device prunes the local copies, so a
 *  removed close friend can no longer see posts that were meant only for close friends. */
export async function setCloseFriend(id: string, value: boolean): Promise<void> {
  const c = await getContact(id);
  if (!c || !!c.closeFriend === value) return;
  await put<Contact>('contacts', { ...c, closeFriend: value, updatedAt: Date.now() });
  if (!value) await revokeCloseFriendPosts(id);
}

/** Revoke every still-live close-only post we authored from `userId` (called when they
 *  are removed from close friends). Best-effort + idempotent: the server drops their
 *  envelope and records a revocation; a post they never received is a harmless no-op. */
export async function revokeCloseFriendPosts(userId: string): Promise<void> {
  const self = getSelfUserId();
  if (!self) return;
  const nowMs = now();
  const closePosts = (await getAll<Post>('posts')).filter(
    (p) => p.outgoing && p.audience === 'close' && (!p.expiresAt || p.expiresAt > nowMs),
  );
  for (const p of closePosts) {
    await apiRemovePostRecipient(p.id, userId).catch(() => {});
  }
}

/* ---- spec 0003: Wall posts ---- */

// Author-chosen post lifetime → ttl (ms). Wall posts are ALWAYS ephemeral: nothing
// lives longer than 72 hours, whatever its type (text/photo/video/voice). There is no
// "keep" option, and the server independently clamps to MAX_POST_TTL_MS as a backstop.
export const MAX_POST_TTL_MS = 72 * 60 * 60 * 1000;
const POST_TTL_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '72h': MAX_POST_TTL_MS,
};
export type PostLifetime = '1h' | '24h' | '72h';

// Cache each friend's X25519 identity public key (stable per account) so building a
// post doesn't re-fetch (and re-consume a one-time prekey) for every post. Lazily
// filled from the peer bundle; this key is the wrap target for K_post.
async function peerPostKey(userId: string): Promise<Uint8Array | null> {
  const cache = (await getSetting<Record<string, string>>('postPeerKeys', {})) ?? {};
  if (cache[userId]) return b64urlToBytes(cache[userId]);
  const bundle = await fetchPeerBundle(userId).catch(() => null);
  if (!bundle) return null;
  cache[userId] = bundle.xPub;
  await setSetting('postPeerKeys', cache);
  return b64urlToBytes(bundle.xPub);
}

// Decode a base64 data URL to a Blob WITHOUT fetch() — fetch of a `data:` URL can hang in the
// iOS PWA webview, which would freeze a video post on poster generation. Returns undefined on
// a malformed input.
function dataUrlToBlobSafe(dataUrl: string): Blob | undefined {
  try {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return undefined;
    const mime = dataUrl.slice(0, comma).match(/data:([^;]+)/)?.[1] ?? 'image/jpeg';
    const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: mime });
  } catch {
    return undefined;
  }
}

/** One media attachment for a post: a picked/recorded blob + how to send it. */
export interface PostMediaInput {
  blob: Blob;
  kind: 'image' | 'video' | 'voice';
  name: string;
  durationSec?: number;
  quality?: 'sd' | 'hd';
}

/**
 * Create a Wall post: seal the payload under a fresh per-post key, wrap that key to
 * each audience member, upload the opaque blob, register the post server-side, then
 * persist it locally so the author sees it immediately. The server only ever holds
 * ciphertext + the per-recipient envelope set.
 */
export async function createPost(opts: {
  body?: string;
  audience: 'friends' | 'close';
  lifetime: PostLifetime;
  // Spec 1024: a stable post id supplied by the outbox worker so a retry is idempotent — the same
  // id overwrites the local post and the server upserts it, instead of creating a duplicate.
  id?: string;
  // Optional attachment(s). A single item is an ordinary media post; an array of 2+
  // image/video items is an ALBUM post (spec 1022, FR-019) — every item is compressed to
  // the chosen quality, encrypted + uploaded, and all the media-refs ride sealed inside
  // the one post payload.
  media?: PostMediaInput | PostMediaInput[];
  // Progress for the composer's "encoding / uploading …" bar (per media item, 0–1).
  onProgress?: (p: { phase: 'encoding' | 'uploading'; index: number; total: number; value: number }) => void;
}): Promise<Post> {
  const self = getSelfUserId();
  if (!self) throw new Error('not signed in');
  const body = opts.body?.trim() || undefined;
  if (!body && !opts.media) throw new Error('Nothing to post.');
  const friends = opts.audience === 'close' ? await listCloseFriends() : await listFriends();
  if (!friends.length) throw new Error('No audience — add friends first.');
  const audience: AudienceMember[] = [];
  for (const f of friends) {
    const pub = await peerPostKey(f.id);
    if (pub) audience.push({ userId: f.id, pubKey: pub });
  }
  if (!audience.length) throw new Error('No reachable audience for this post.');

  // Encrypt + upload the attachment first (its key rides sealed in the payload), and
  // keep a local Media copy so the author renders it immediately.
  // Normalise to a list: one item = a single-media post; 2+ image/video items = an album.
  const mediaList: PostMediaInput[] = opts.media ? (Array.isArray(opts.media) ? opts.media : [opts.media]) : [];
  const kind: Post['kind'] = mediaList.length ? mediaList[0].kind : 'text';
  let mediaId: string | undefined; // the cover (first item) — keeps single-media paths working
  let mediaW: number | undefined;
  let mediaH: number | undefined;
  const mediaIds: string[] = [];
  const refs: NonNullable<PostPayload['album']> = [];
  const payload: PostPayload = { kind, body };
  const total = mediaList.length;
  for (const m of mediaList) {
    const index = mediaIds.length; // 0-based position of this item
    // Posts only ship SD or HD (never the original): compress images/videos to the
    // chosen quality before upload; voice is left as-is. Video reports encode progress.
    const q = m.quality ?? 'hd';
    const toUpload =
      m.kind === 'image'
        ? await compressImage(m.blob, q)
        : m.kind === 'video'
          ? await compressVideo(m.blob, q, (value) => opts.onProgress?.({ phase: 'encoding', index, total, value }))
          : m.blob;
    // Honest badge (spec 2007): label by the quality actually achieved (a transcode that
    // can't shrink the clip returns the original). Voice isn't transcoded — keep requested.
    const achieved = m.kind === 'voice' ? q : achievedQuality(q, m.blob.size, toUpload);
    // Dimensions → reserve an aspect-ratio box in the feed (no layout jump).
    let w: number | undefined;
    let h: number | undefined;
    if (m.kind === 'image') ({ width: w, height: h } = await readImageMeta(toUpload).catch(() => ({ width: undefined, height: undefined })));
    else if (m.kind === 'video') ({ width: w, height: h } = await readVideoMeta(toUpload).catch(() => ({ width: undefined, height: undefined })));
    const ref = await prepareOutgoingMedia(
      toUpload,
      m.name,
      m.durationSec,
      { width: w, height: h, quality: achieved },
      (value) => opts.onProgress?.({ phase: 'uploading', index, total, value }),
    );
    refs.push(ref);
    const id = uid();
    mediaIds.push(id);
    if (mediaIds.length === 1) {
      mediaId = id; // cover
      mediaW = w;
      mediaH = h;
    }
    // A first-frame poster for videos: the feed (and a not-yet-downloaded recipient) shows a
    // thumbnail before/without playback instead of a blank box. Stored as a Blob (+ derived
    // tiers) so the Wall's posterUrl resolves it like an image poster.
    let posterBlob: Blob | undefined;
    let posterGrid: Blob | undefined;
    let posterStrip: Blob | undefined;
    if (m.kind === 'video') {
      const dataUrl = await generateVideoPoster(toUpload).catch(() => undefined);
      // Embed the poster (a small JPEG data URL, ≤~40KB) in the sealed MediaRef so a RECIPIENT
      // shows the thumbnail without downloading/decoding the clip — exactly how chat video
      // messages carry MediaRef.poster. It rides in the one sealed post blob, not per envelope.
      if (dataUrl) ref.poster = dataUrl;
      // Decode the data URL to a Blob directly (NOT fetch(dataUrl) — that can hang in the iOS
      // PWA webview) so a video post never stalls on poster generation.
      if (dataUrl) posterBlob = dataUrlToBlobSafe(dataUrl);
      if (posterBlob) {
        const tiers = await deriveTiers(posterBlob).catch(() => ({}) as { grid?: Blob; strip?: Blob });
        posterGrid = tiers.grid;
        posterStrip = tiers.strip;
      }
    }
    await put<Media>('media', {
      id,
      kind: m.kind,
      mime: ref.mime,
      name: ref.name,
      size: ref.size,
      blob: toUpload,
      posterBlob,
      posterGrid,
      posterStrip,
      durationSec: ref.durationSec,
      updatedAt: now(),
    });
  }
  // Single item rides in `media`; an album rides as the ordered `album` list.
  if (refs.length === 1) payload.media = refs[0];
  else if (refs.length > 1) payload.album = refs;

  const built = buildPost(payload, audience);
  const blobId = await uploadBlob(new Blob([built.blob as BlobPart]));
  const id = opts.id ?? uid();
  const createdAt = now();
  // The chosen window (1h/24h/72h), capped at 72h. Keep-alive later resets the expiry
  // to now + this same window on each interaction.
  const ttlMs = Math.min(POST_TTL_MS[opts.lifetime] ?? MAX_POST_TTL_MS, MAX_POST_TTL_MS);
  const expiresAt = createdAt + ttlMs;
  await apiCreatePost({ id, blobId, size: built.blob.length, expiresAt, ttlMs, envelopes: built.envelopes });
  const post: Post = {
    id,
    author: self,
    kind,
    body,
    mediaId,
    mediaIds: mediaIds.length > 1 ? mediaIds : undefined,
    mediaW,
    mediaH,
    audience: opts.audience,
    createdAt,
    lastActivityAt: createdAt,
    expiresAt,
    ttlMs,
    outgoing: true,
    postKey: built.postKey,
    updatedAt: createdAt,
  };
  await put<Post>('posts', post);
  return post;
}

// ---- spec 1024: resilient-posting outbox (`pendingPosts` store) ----

/** Cache the staged media + metadata as a pending post and return its id. The composer dismisses
 *  the moment this resolves; the upload worker (services/pending-posts) drains it in the
 *  background. The blobs are the app's OWN cached copies, so removing the source can't break it. */
export async function enqueuePendingPost(input: {
  target: 'wall' | 'chat';
  chatId?: string;
  body: string;
  audience?: 'friends' | 'close';
  lifetime?: PostLifetime;
  items: {
    blob: Blob;
    kind: 'image' | 'video' | 'voice';
    name: string;
    mime: string;
    durationSec?: number;
    width?: number;
    height?: number;
    poster?: string;
  }[];
}): Promise<string> {
  const id = uid();
  // Read every item's bytes and store them INLINE (as an ArrayBuffer, not a Blob). This is what lets
  // a post survive a full app close: a Blob read back from IDB after a restart can be unreadable on
  // iOS, an ArrayBuffer always reads back. So an interrupted post keeps its photos/videos/voice and
  // can be finished from the recovered draft. The read happens once here, at Share (in-session, while
  // the picked files are still readable).
  const items: OutboxItem[] = [];
  for (const it of input.items) {
    items.push({
      localId: uid(),
      bytes: await it.blob.arrayBuffer(),
      kind: it.kind,
      name: it.name,
      mime: it.mime,
      durationSec: it.durationSec,
      width: it.width,
      height: it.height,
      poster: it.poster,
      progress: 0,
    });
  }
  const rec: OutboxPost = {
    id,
    target: input.target,
    chatId: input.chatId,
    body: input.body,
    audience: input.audience,
    lifetime: input.lifetime,
    items,
    status: 'uploading',
    attempts: 0,
    createdLocally: now(),
    updatedAt: now(),
  };
  await put<OutboxPost>('pendingPosts', rec);
  return id;
}

export async function listPendingPosts(): Promise<OutboxPost[]> {
  const all = await getAll<OutboxPost>('pendingPosts');
  return all.sort((a, b) => a.createdLocally - b.createdLocally);
}

export async function getPendingPost(id: string): Promise<OutboxPost | undefined> {
  return get<OutboxPost>('pendingPosts', id);
}

export async function updatePendingPost(rec: OutboxPost): Promise<void> {
  await put<OutboxPost>('pendingPosts', { ...rec, updatedAt: now() });
}

export async function deletePendingPost(id: string): Promise<void> {
  await remove('pendingPosts', id);
}

/* ---- per-chat composer drafts (local-only; keep your place across leave/close) ---- */
export async function getDraft(chatId: string): Promise<ChatDraft | undefined> {
  return get<ChatDraft>('drafts', chatId);
}
export async function saveDraft(d: Omit<ChatDraft, 'updatedAt'>): Promise<void> {
  await put<ChatDraft>('drafts', { ...d, updatedAt: now() });
}
export async function clearDraft(chatId: string): Promise<void> {
  await remove('drafts', chatId);
}
/** All saved drafts — the Chats list uses this to mark which chats have an unsent message. */
export async function listDrafts(): Promise<ChatDraft[]> {
  return getAll<ChatDraft>('drafts');
}
/* Staged attachments for a chat draft (bytes stored inline; see DraftMedia). */
export async function getDraftMedia(chatId: string): Promise<DraftMedia | undefined> {
  return get<DraftMedia>('draftMedia', chatId);
}
export async function saveDraftMedia(chatId: string, items: DraftMediaItem[]): Promise<void> {
  await put<DraftMedia>('draftMedia', { chatId, items, updatedAt: now() });
}
export async function clearDraftMedia(chatId: string): Promise<void> {
  await remove('draftMedia', chatId);
}

// Persist a single received post: unwrap K_post with our identity key, open the
// payload, store it. Own posts come back without an envelope (already local) and are
// skipped; anything we can't open (not for us / tampered) is dropped silently.
async function receivePost(sp: ServerPost): Promise<void> {
  if (!sp.wrappedKey) return;
  if (await get<Post>('posts', sp.id)) return;
  const blob = await downloadBlob(sp.blobId);
  if (!blob) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let payload: PostPayload;
  let postKey: string;
  try {
    ({ payload, postKey } = openReceivedPost(bytes, sp.wrappedKey, getIdentityKeys().x.privateKey));
  } catch {
    return;
  }
  // Pull + decrypt the attachment (if any) and store it as a local Media record so the
  // Wall renders it like any other media.
  // Pull + decrypt each attachment (a single `media`, or every item of an `album`) and
  // store them as local Media records, preserving order, so the Wall renders them like
  // any other media. The first becomes the cover (mediaId), matching createPost.
  let mediaId: string | undefined;
  let mediaW: number | undefined;
  let mediaH: number | undefined;
  const mediaIds: string[] = [];
  const refsToGet = payload.album ?? (payload.media ? [payload.media] : []);
  const pending: { id: string; ref: MediaRef }[] = [];
  if (payload.kind !== 'text') {
    for (const ref of refsToGet) {
      const id = uid();
      mediaIds.push(id);
      if (mediaIds.length === 1) {
        mediaId = id;
        mediaW = ref.width;
        mediaH = ref.height;
      }
      // A mixed album can carry both images and videos, so derive each item's kind from
      // its mime rather than the post's overall kind.
      const itemKind = ref.mime.startsWith('video/') ? 'video' : ref.mime.startsWith('audio/') ? 'voice' : 'image';
      // Persist the embedded poster (videos) NOW so the post renders a thumbnail immediately.
      let posterBlob: Blob | undefined;
      let posterGrid: Blob | undefined;
      let posterStrip: Blob | undefined;
      if (itemKind === 'video' && ref.poster) {
        posterBlob = dataUrlToBlobSafe(ref.poster);
        if (posterBlob) {
          const tiers = await deriveTiers(posterBlob).catch(() => ({}) as { grid?: Blob; strip?: Blob });
          posterGrid = tiers.grid;
          posterStrip = tiers.strip;
        }
      }
      // Store the Media record WITHOUT the heavy blob (it's optional — the same shape as a
      // "kept preview"). The full blob streams in afterwards (downloadPostMedia) so the post +
      // its Wall badge appear AT ONCE instead of waiting on a full video download. The feed
      // shows the poster meanwhile and the idb bus live-updates each item as its blob lands.
      await put<Media>('media', {
        id,
        kind: itemKind,
        mime: ref.mime,
        name: ref.name,
        size: ref.size,
        posterBlob,
        posterGrid,
        posterStrip,
        durationSec: ref.durationSec,
        updatedAt: now(),
      });
      pending.push({ id, ref });
    }
  }
  const prev = await get<Post>('posts', sp.id);
  await put<Post>('posts', {
    id: sp.id,
    author: sp.author,
    kind: payload.kind,
    body: payload.body,
    mediaId,
    mediaIds: mediaIds.length > 1 ? mediaIds : undefined,
    mediaW,
    mediaH,
    createdAt: sp.createdAt,
    lastActivityAt: Math.max(prev?.lastActivityAt ?? 0, sp.createdAt),
    expiresAt: sp.expiresAt,
    ttlMs: sp.ttlMs,
    outgoing: false,
    postKey,
    updatedAt: now(),
  });
  // Pull any engagement (reactions/comments) that already exists on this post (also
  // applies keep-alive from past interactions).
  void syncEngagement(sp.id);
  // Stream the full media in the BACKGROUND — the post is already visible (posters); each blob
  // landing live-updates the feed (video becomes playable, image fills in).
  void downloadPostMedia(sp.id, pending);
}

// Download a received post's media blobs after the post is already on the Wall, attaching each
// to its (poster-only) Media record. Best-effort + sequential so one slow video doesn't block
// the others' visibility — they're all already showing their posters. After each blob lands we
// touch the post so useWall re-resolves it (the freshly-downloaded blob becomes a playable URL).
async function downloadPostMedia(postId: string, pending: { id: string; ref: MediaRef }[]): Promise<void> {
  for (const { id, ref } of pending) {
    const mblob = await receiveIncomingMedia(ref).catch(() => null);
    if (!mblob) continue;
    const md = await get<Media>('media', id);
    if (md) await put<Media>('media', { ...md, blob: mblob, size: ref.size, updatedAt: now() });
    const post = await get<Post>('posts', postId);
    if (post) await put<Post>('posts', { ...post, updatedAt: now() });
  }
}

/** Pull new posts addressed to us and persist them (called on app open, on the
 *  `post-new` WS nudge, and on reconnect). No-op while locked. */
export async function syncPosts(): Promise<void> {
  if (!isUnlockedNow()) return;
  const cursor = (await getSetting<number>('postsCursor', 0)) ?? 0;
  try {
    const { posts, cursor: next, revoked } = await apiListPosts(cursor);
    for (const sp of posts) await receivePost(sp);
    // Posts the author revoked from us (e.g. they dropped us from close friends) —
    // prune any local copy. Idempotent: an id we never had is a harmless no-op.
    for (const id of revoked) await pruneLocalPost(id);
    if (next > cursor) await setSetting('postsCursor', next);
  } catch {
    /* offline / transient — retried on the next nudge */
  } finally {
    // First real sync attempt done (success or transient fail) → drop the Wall first-load spinner.
    wallSyncedOnce.value = true;
  }
}

/** Remove a post and its engagement from this device only (no server call). Used by
 *  the sweep, by revocation pulls, and by the live `post-revoke` nudge. Idempotent. */
export async function pruneLocalPost(id: string): Promise<void> {
  if (!(await get<Post>('posts', id))) return;
  await remove('posts', id);
  for (const e of await getByIndex<PostEngagement>('postEngagement', 'postId', id)) {
    await remove('postEngagement', e.id);
  }
}

/** Human label for what was shared, used in notifications. */
function postShareLabel(kind: Post['kind']): string {
  return kind === 'image'
    ? 'shared a photo'
    : kind === 'video'
      ? 'shared a video'
      : kind === 'voice'
        ? 'shared a voice message'
        : 'shared a post';
}

// Posts we've already notified about this session (avoids a repeat banner if the
// `post-new` nudge fires again for the same post).
const notifiedPostIds = new Set<string>();

/** Surface an in-app banner / system notification for a freshly-arrived post from
 *  `authorId` ("X shared a photo"). Called from the live `post-new` nudge, so it only
 *  fires for genuinely new posts (a recency guard backs that up). */
export async function notifyNewPost(authorId: string): Promise<void> {
  // Respect notification controls: master toggle, a temporary global mute, and a
  // per-user mute/hide.
  if (!(await getSetting<boolean>('notifications.wall.show', true))) return;
  if (await isWallTempMuted()) return;
  if (await isWallUserMuted(authorId)) return;
  if (await isWallUserHidden(authorId)) return;
  const recent = (await getAll<Post>('posts'))
    .filter((p) => p.author === authorId && !p.outgoing && !notifiedPostIds.has(p.id))
    .sort((a, b) => b.createdAt - a.createdAt);
  const p = recent[0];
  if (!p || now() - p.createdAt > 5 * 60_000) return;
  notifiedPostIds.add(p.id);
  const c = await getContact(authorId);
  void notifyIncoming({
    kind: 'system',
    name: c?.name ?? 'Someone',
    body: postShareLabel(p.kind),
    avatar: c?.avatar,
    url: '/tabs/wall',
  });
}

/* ---- Wall mute / hide controls (client-only ledgers) ---- */

async function getWallLedger(key: string): Promise<Record<string, boolean>> {
  return (await getSetting<Record<string, boolean>>(key, {})) ?? {};
}
async function setWallLedgerEntry(key: string, id: string, on: boolean): Promise<void> {
  const map = await getWallLedger(key);
  if (!!map[id] === on) return;
  if (on) map[id] = true;
  else delete map[id];
  await setSetting(key, map);
}

/** Users whose posts are hidden from your Wall entirely. */
export async function getWallHiddenUsers(): Promise<Record<string, boolean>> {
  return getWallLedger('wall.hiddenUsers');
}
/** Users whose Wall notifications you've muted (their posts still show). */
export async function getWallMutedUsers(): Promise<Record<string, boolean>> {
  return getWallLedger('wall.mutedUsers');
}
export async function setWallUserHidden(id: string, hidden: boolean): Promise<void> {
  await setWallLedgerEntry('wall.hiddenUsers', id, hidden);
}
export async function setWallUserMuted(id: string, muted: boolean): Promise<void> {
  await setWallLedgerEntry('wall.mutedUsers', id, muted);
}
export async function isWallUserHidden(id: string): Promise<boolean> {
  return !!(await getWallHiddenUsers())[id];
}
export async function isWallUserMuted(id: string): Promise<boolean> {
  return !!(await getWallMutedUsers())[id];
}

/** Everyone you've muted or hidden on the Wall, with their profile, for the manage
 *  screen (so a hidden user — whose posts no longer appear — can be un-hidden). */
export async function listWallManagedUsers(): Promise<
  { id: string; name: string; avatar: string; muted: boolean; hidden: boolean }[]
> {
  const hidden = await getWallHiddenUsers();
  const muted = await getWallMutedUsers();
  const ids = new Set([...Object.keys(hidden), ...Object.keys(muted)]);
  const out: { id: string; name: string; avatar: string; muted: boolean; hidden: boolean }[] = [];
  for (const id of ids) {
    const c = await getContact(id);
    out.push({ id, name: c?.name ?? 'Someone', avatar: c?.avatar ?? '', muted: !!muted[id], hidden: !!hidden[id] });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Temporary global mute of Wall notifications until this epoch ms (0 = not muted). */
export async function getWallMuteUntil(): Promise<number> {
  return (await getSetting<number>('wall.muteUntil', 0)) ?? 0;
}
export async function setWallMuteUntil(ts: number): Promise<void> {
  await setSetting('wall.muteUntil', ts);
}
export async function isWallTempMuted(): Promise<boolean> {
  return (await getWallMuteUntil()) > now();
}

/** Mark the Wall as seen (clears the unread-post badge). Called when the Wall is open. */
export async function markWallSeen(): Promise<void> {
  await setSetting('wall.lastSeenAt', now());
}

/** Count of received (non-own), non-expired posts newer than the last time the Wall was
 *  seen — drives the Wall tab + app icon badge. Hidden users are excluded. */
export async function wallUnreadCount(): Promise<number> {
  const since = (await getSetting<number>('wall.lastSeenAt', 0)) ?? 0;
  const nowMs = now();
  const hidden = await getWallHiddenUsers();
  return (await getAll<Post>('posts')).filter(
    (p) => !p.outgoing && p.createdAt > since && !hidden[p.author] && (!p.expiresAt || p.expiresAt > nowMs),
  ).length;
}

/** All non-expired Wall posts on this device, ordered by last activity — so a brand-
 *  new post AND a post that just got a reaction/comment both rise to the top. */
export async function listWallPosts(): Promise<Post[]> {
  const nowMs = now();
  const hidden = await getWallHiddenUsers();
  const activity = (p: Post) => p.lastActivityAt ?? p.createdAt;
  return (await getAll<Post>('posts'))
    .filter((p) => (!p.expiresAt || p.expiresAt > nowMs) && !hidden[p.author])
    .sort((a, b) => activity(b) - activity(a));
}

/** A single Wall post by id (or null). */
export async function getPost(id: string): Promise<Post | null> {
  return (await get<Post>('posts', id)) ?? null;
}

/** A media record by id (for rendering a post's photo/video/voice). */
export async function getMedia(id: string): Promise<Media | null> {
  return (await get<Media>('media', id)) ?? null;
}

/** Delete one of our own posts: best-effort server delete + remove the local copy. */
export async function deletePost(id: string): Promise<void> {
  await apiDeletePost(id).catch(() => {});
  await remove('posts', id);
}

/** Explicitly extend one of our own posts' lifetime ("Keep for longer"): the server pushes
 *  its expiry back to a full window, and we mirror that locally so the countdown updates. */
export async function keepAlivePost(id: string): Promise<void> {
  await apiKeepAlivePost(id);
  await bumpPostActivity(id, now());
}

/** Change one of our own posts' visibility after the fact (close ↔ all friends). Broadening
 *  re-wraps K_post to the newly-included friends and adds their envelopes (they receive it
 *  SILENTLY — no new notification); narrowing revokes the non-close friends' copies (their
 *  device prunes it). Those already in the audience are never re-notified. */
export async function setPostAudience(id: string, audience: 'friends' | 'close'): Promise<void> {
  const post = await get<Post>('posts', id);
  if (!post || !post.outgoing || !post.postKey || post.audience === audience) return;
  const closeIds = new Set((await listCloseFriends()).map((c) => c.id));
  const friends = await listFriends();
  if (audience === 'friends') {
    // Broaden: add every friend not already a recipient (i.e. the non-close ones).
    const members: AudienceMember[] = [];
    for (const f of friends) {
      if (closeIds.has(f.id)) continue;
      const pub = await peerPostKey(f.id);
      if (pub) members.push({ userId: f.id, pubKey: pub });
    }
    if (members.length) await apiAddPostEnvelopes(id, wrapForNewAudience(post.postKey, members));
  } else {
    // Narrow: revoke every friend who isn't a close friend (reuses the existing revoke path).
    for (const f of friends) {
      if (!closeIds.has(f.id)) await apiRemovePostRecipient(id, f.id).catch(() => {});
    }
  }
  post.audience = audience;
  post.updatedAt = now();
  await put<Post>('posts', post);
}

/** Remove posts (and their engagement) whose lifetime has elapsed. Wired into the
 *  existing disappearing-message sweep. */
export async function sweepExpiredPosts(): Promise<void> {
  const nowMs = now();
  for (const p of await getAll<Post>('posts')) {
    if (p.expiresAt && p.expiresAt <= nowMs) {
      await remove('posts', p.id);
      for (const e of await getByIndex<PostEngagement>('postEngagement', 'postId', p.id)) {
        await remove('postEngagement', e.id);
      }
    }
  }
}

/* ---- engagement: reactions (spec 0003, US4) ---- */

interface ReactionData {
  emoji: string;
  at: number;
  remove?: boolean;
}

// Keep-alive (rolling 72h of inactivity): any interaction extends the post's life to
// (interaction time + 72h) and bumps its last-activity, so an actively-engaged post
// stays alive and jumps to the top of the feed. Local mirror of the server bump.
async function bumpPostActivity(postId: string, atMs: number): Promise<void> {
  const post = await get<Post>('posts', postId);
  if (!post) return;
  const window = Math.min(post.ttlMs ?? MAX_POST_TTL_MS, MAX_POST_TTL_MS);
  const lastActivityAt = Math.max(post.lastActivityAt ?? post.createdAt, atMs);
  const expiresAt = Math.max(post.expiresAt ?? 0, atMs + window);
  if (lastActivityAt === (post.lastActivityAt ?? post.createdAt) && expiresAt === (post.expiresAt ?? 0)) return;
  await put<Post>('posts', { ...post, lastActivityAt, expiresAt, updatedAt: now() });
}

/** React to a post (audience-visible), mirroring chat: up to MAX_REACTIONS_PER_USER
 *  emoji per person and MAX_DISTINCT_REACTIONS distinct emoji per post; tapping your
 *  own emoji again removes it. Sealed under K_post and fanned out; applied LWW per
 *  (actor, emoji). Returns what happened so the UI can surface a cap. */
export async function reactToPost(
  postId: string,
  emoji: string,
): Promise<'added' | 'removed' | 'limit' | 'limit-emojis' | 'noop'> {
  const self = getSelfUserId();
  const post = await get<Post>('posts', postId);
  if (!self || !post?.postKey) return 'noop';
  const rows = (await getByIndex<PostEngagement>('postEngagement', 'postId', postId)).filter(
    (e) => e.type === 'reaction' && !e.deleted,
  );
  const mine = rows.filter((r) => r.actor === self);
  const has = mine.some((r) => r.emoji === emoji);
  if (!has) {
    if (mine.length >= MAX_REACTIONS_PER_USER) return 'limit';
    const distinct = new Set(rows.map((r) => r.emoji));
    if (!distinct.has(emoji) && distinct.size >= MAX_DISTINCT_REACTIONS) return 'limit-emojis';
  }
  const remove = has;
  const at = now();
  await put<PostEngagement>('postEngagement', {
    id: `${postId}:reaction:${self}:${emoji}`, postId, type: 'reaction', actor: self, emoji, at,
    deleted: remove || undefined, updatedAt: at,
  });
  if (!remove) void recordEmojiUse(emoji); // most-used drives the quick-react order
  await bumpPostActivity(postId, at);
  try {
    await apiSubmitEngagement(postId, {
      id: uid(),
      kind: 'reaction',
      payload: sealPostEngagement(post.postKey, { emoji, at, remove } satisfies ReactionData),
    });
  } catch {
    /* offline — the optimistic local row stands; a later sync reconciles */
  }
  return remove ? 'removed' : 'added';
}

interface CommentData {
  text: string;
  at: number;
}

/** Pull + decrypt a post's engagement and apply it: reactions (LWW per actor),
 *  comments (append, keyed by engagement id), and tombstones (mark target removed). */
export async function syncEngagement(postId: string): Promise<void> {
  if (!isUnlockedNow()) return;
  const post = await get<Post>('posts', postId);
  if (!post?.postKey) return;
  try {
    const { items } = await apiListEngagement(postId);
    let latestActivity = 0; // newest reaction/comment time seen → keep-alive
    for (const it of items) {
      if (it.kind === 'reaction') {
        let data: ReactionData;
        try {
          data = openPostEngagement<ReactionData>(post.postKey, it.payload);
        } catch {
          continue;
        }
        latestActivity = Math.max(latestActivity, data.at);
        const id = `${postId}:reaction:${it.actor}:${data.emoji}`;
        const existing = await get<PostEngagement>('postEngagement', id);
        if (existing && existing.at >= data.at) continue; // LWW per (actor, emoji)
        await put<PostEngagement>('postEngagement', {
          id, postId, type: 'reaction', actor: it.actor, emoji: data.emoji, at: data.at,
          deleted: data.remove || undefined, updatedAt: now(),
        });
      } else if (it.kind === 'comment') {
        if (await get<PostEngagement>('postEngagement', it.id)) continue; // already have it
        let data: CommentData;
        try {
          data = openPostEngagement<CommentData>(post.postKey, it.payload);
        } catch {
          continue;
        }
        latestActivity = Math.max(latestActivity, data.at);
        await put<PostEngagement>('postEngagement', {
          id: it.id, postId, type: 'comment', actor: it.actor, text: data.text, at: data.at, updatedAt: now(),
        });
      } else if (it.kind === 'tombstone') {
        // The tombstone's payload is the (cleartext) target engagement id.
        const target = await get<PostEngagement>('postEngagement', it.payload);
        if (target && !target.deleted) {
          await put<PostEngagement>('postEngagement', { ...target, deleted: true, updatedAt: now() });
        }
      }
    }
    if (latestActivity) await bumpPostActivity(postId, latestActivity);
  } catch {
    /* offline / transient */
  }
}

/** Live reactions on a post (non-removed), oldest-first. */
export async function listPostReactions(postId: string): Promise<PostEngagement[]> {
  const rows = await getByIndex<PostEngagement>('postEngagement', 'postId', postId);
  return rows.filter((e) => e.type === 'reaction' && !e.deleted).sort((a, b) => a.at - b.at);
}

/** All engagement rows (for the feed, which groups them by post in one live query). */
export async function listAllPostEngagement(): Promise<PostEngagement[]> {
  return getAll<PostEngagement>('postEngagement');
}

/** Live comments on a post (non-deleted), oldest-first (timestamp then id tiebreak). */
export async function listPostComments(postId: string): Promise<PostEngagement[]> {
  const rows = await getByIndex<PostEngagement>('postEngagement', 'postId', postId);
  return rows
    .filter((e) => e.type === 'comment' && !e.deleted)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** Add an audience-visible comment to a post (sealed under K_post; fanned out). */
export async function commentOnPost(postId: string, text: string): Promise<void> {
  const self = getSelfUserId();
  const post = await get<Post>('posts', postId);
  const body = text.trim();
  if (!self || !post?.postKey || !body) return;
  const at = now();
  const engId = uid(); // local id == server engagement id, so tombstones can target it
  await put<PostEngagement>('postEngagement', {
    id: engId, postId, type: 'comment', actor: self, text: body, at, updatedAt: at,
  });
  await bumpPostActivity(postId, at);
  try {
    await apiSubmitEngagement(postId, {
      id: engId,
      kind: 'comment',
      payload: sealPostEngagement(post.postKey, { text: body, at } satisfies CommentData),
    });
  } catch {
    /* offline — local stands; a later sync reconciles */
  }
}

/** Remove a comment (the commenter's own, or any comment if you authored the post).
 *  Best-effort propagation: delivered copies can't be cryptographically recalled. */
export async function deleteComment(postId: string, commentId: string): Promise<void> {
  const target = await get<PostEngagement>('postEngagement', commentId);
  if (target) await put<PostEngagement>('postEngagement', { ...target, deleted: true, updatedAt: now() });
  try {
    await apiSubmitEngagement(postId, { id: uid(), kind: 'tombstone', target: commentId });
  } catch {
    /* offline — local stands; a later sync reconciles */
  }
}

/* ---- view receipts (spec 0003, US7) ---- */

/** Record that we viewed a post — only if our seen-receipts setting is on (reciprocal
 *  with the chat setting) and it isn't our own post. */
export async function recordPostView(postId: string): Promise<void> {
  const post = await get<Post>('posts', postId);
  if (!post || post.outgoing) return;
  if (!(await getSetting<boolean>('privacy.seenReceipts', true))) return;
  try {
    await apiRecordPostView(postId);
  } catch {
    /* best effort */
  }
}

/** Author-only view list for our own post, gated by our own seen-receipts setting
 *  (reciprocity). Returns viewer ids (resolve names in the UI). */
export async function listPostViews(postId: string): Promise<string[]> {
  if (!(await getSetting<boolean>('privacy.seenReceipts', true))) return [];
  try {
    const { views } = await apiListPostViews(postId);
    return views.map((v) => v.viewer);
  } catch {
    return [];
  }
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
  // Seed with the username, first letter capitalized for display (e.g. "ada" → "Ada").
  if (!current || current === 'You') await setSecret('profileName', capitalizeFirst(username));
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
    .filter((m) => m.outgoing && m.status !== 'seen')
    .sort((x, y) => x.timestamp - y.timestamp)
    .slice(-REKEY_RESEND_LIMIT);
  for (const m of recent) {
    const payload = payloadFromMessage(m);
    if (!payload) continue;
    if (peerId) await removeOutboxByFrameId(m.id, peerId);
    await sealAndEnqueue(chat, m.id, payload);
  }
}

/* ---- delivery reconcile (recover a 'delivered' receipt dropped while we were offline) ---- */

const RECONCILE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const RECONCILE_ID_CAP = 500;

/**
 * Collect the ids of our recent OUTGOING messages whose delivery/seen isn't
 * confirmed yet - 1:1 messages still at 'sent', and group messages with any member
 * not yet 'delivered' OR not yet 'seen'. On reconnect these are handed to the
 * server (checkDeliveries + checkSeen, spec 1010) so a 'delivered'/'seen' receipt
 * that was dropped because WE were offline when the recipient acked/opened it is
 * recovered. Bounded by a recency window + a hard cap so the check is cheap.
 */
export async function collectUnconfirmedOutgoing(): Promise<string[]> {
  const since = now() - RECONCILE_WINDOW_MS;
  const all = await getAll<Message>('messages');
  const ids: string[] = [];
  for (const m of all) {
    if (!m.outgoing || m.timestamp < since) continue;
    const recs = m.receipts;
    if (recs && recs.length) {
      // Group: any member not yet delivered (→ checkDeliveries) or not yet seen
      // (→ checkSeen) keeps this message in the reconcile set.
      if (recs.some((r) => !r.deliveredAt || !r.seenAt)) ids.push(m.id);
    } else if (m.status === 'sent') {
      ids.push(m.id);
    }
  }
  return ids.slice(-RECONCILE_ID_CAP);
}

/** Set (or clear) disappearing messages for a chat: messages sent from now on
 *  self-destruct after `ttlMs` (null/0 = off). The setting is shared with the
 *  peer(s) via a `ttl` control so it disappears for everyone. */
export async function setChatTtl(chatId: string, ttlMs: number | null): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  const ttl = ttlMs && ttlMs > 0 ? ttlMs : null;
  if (ttl) chat.defaultTtlMs = ttl;
  else delete chat.defaultTtlMs;
  chat.updatedAt = now();
  await put('chats', chat);
  if (chat.isGroup) {
    for (const member of chat.participantIds) {
      try {
        const memberChat = await memberSessionChat(member);
        if (!memberChat) continue;
        const sealed = await sealForChat(memberChat, member, false, {
          body: '', kind: TTL_KIND, timestamp: now(), ttl, groupId: chat.id,
        });
        if (sealed) await enqueue({ t: 'msg', id: uid(), to: sealed.to, ciphertext: sealed.packet });
      } catch (e) {
        console.warn('[ttl] notify member failed', member, e);
      }
    }
  } else {
    await sealAndEnqueue(chat, uid(), { body: '', kind: TTL_KIND, timestamp: now(), ttl });
  }
}

const TTL_KIND = 'ttl';

/** Apply an inbound TTL control: adopt the peer's disappearing-message setting on the
 *  target chat (the group chat for a group control, else this 1:1 chat). */
async function applyTtlControl(chatId: string, ttl: number | null): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  if (ttl && ttl > 0) chat.defaultTtlMs = ttl;
  else delete chat.defaultTtlMs;
  chat.updatedAt = now();
  await put('chats', chat);
}

/** Remove messages whose disappearing-message timer has elapsed (both the sender's
 *  and the recipient's copy carry the same expiresAt). Returns how many were removed.
 *  Run on a timer + on connect from useSync. */
export async function sweepExpiredMessages(): Promise<number> {
  const t = now();
  const due = (await getAll<Message>('messages')).filter((m) => m.expiresAt && m.expiresAt <= t);
  for (const m of due) await deleteMessage(m.id);
  return due.length;
}

/** Mute (or unmute) a chat's alerting until `until` epoch-ms (a far-future value =
 *  always; null/0 = unmute). The message still arrives and counts toward the badge;
 *  only the OS notification / in-app banner / sound are suppressed. Local only. */
export async function setChatMute(chatId: string, until: number | null): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  if (until && until > now()) chat.mutedUntil = until;
  else delete chat.mutedUntil;
  chat.updatedAt = now();
  await put('chats', chat);
}

/** Whether a chat's alerting is currently muted. */
export async function isChatMuted(chatId: string): Promise<boolean> {
  const chat = await getChat(chatId);
  return !!chat?.mutedUntil && chat.mutedUntil > now();
}

/* ---- per-chat notification controls (spec 1015) ---- */

export type ChatNotifyContent = 'full' | 'generic' | 'none';

/** The effective per-chat notification preferences, with the pre-1015 defaults
 *  applied when a field is absent (so existing chats read as web-push on, in-app
 *  on, content full). Device-local; enforcement is entirely client-side. */
export interface ChatNotifyPrefs {
  webPush: boolean;
  inApp: boolean;
  content: ChatNotifyContent;
  // @mentions (spec 1020): "Notify for mentions even when muted" — when off, a mention
  // gets no escalation. Default true. Group chats only.
  mentions: boolean;
}

const CHAT_NOTIFY_DEFAULTS: ChatNotifyPrefs = { webPush: true, inApp: true, content: 'full', mentions: true };

/** Read a chat's notification controls with defaults applied. A missing chat (or
 *  any absent field) yields the defaults, so callers never special-case undefined. */
export async function getChatNotifyPrefs(chatId: string): Promise<ChatNotifyPrefs> {
  const chat = await getChat(chatId);
  return {
    webPush: chat?.notifyWebPush ?? CHAT_NOTIFY_DEFAULTS.webPush,
    inApp: chat?.notifyInApp ?? CHAT_NOTIFY_DEFAULTS.inApp,
    content: chat?.notifyContent ?? CHAT_NOTIFY_DEFAULTS.content,
    mentions: chat?.notifyMentions ?? CHAT_NOTIFY_DEFAULTS.mentions,
  };
}

/** Patch one or more per-chat notification controls. Writing a value equal to the
 *  default deletes the stored field (keeps records minimal + "unchanged" chats
 *  field-free). Bumps updatedAt like setChatMute, so the change rides the encrypted
 *  own-data sync; the server only ever sees ciphertext (FR-026). */
export async function setChatNotifyPrefs(chatId: string, patch: Partial<ChatNotifyPrefs>): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  if (patch.webPush !== undefined) {
    if (patch.webPush === CHAT_NOTIFY_DEFAULTS.webPush) delete chat.notifyWebPush;
    else chat.notifyWebPush = patch.webPush;
  }
  if (patch.inApp !== undefined) {
    if (patch.inApp === CHAT_NOTIFY_DEFAULTS.inApp) delete chat.notifyInApp;
    else chat.notifyInApp = patch.inApp;
  }
  if (patch.content !== undefined) {
    if (patch.content === CHAT_NOTIFY_DEFAULTS.content) delete chat.notifyContent;
    else chat.notifyContent = patch.content;
  }
  if (patch.mentions !== undefined) {
    if (patch.mentions === CHAT_NOTIFY_DEFAULTS.mentions) delete chat.notifyMentions;
    else chat.notifyMentions = patch.mentions;
  }
  chat.updatedAt = now();
  await put('chats', chat);
}

/** Per-contact presence overrides (userId -> 'allow'|'deny'), layered on top of the
 *  global online/last-seen tier. Sent to the server with presence-prefs. */
export async function getPresenceOverrides(): Promise<Record<string, 'allow' | 'deny'>> {
  return getSetting<Record<string, 'allow' | 'deny'>>('presence.overrides', {});
}

/** Always show ('allow') / always hide ('deny') / default (null) my presence to one
 *  contact. Writing the setting triggers a presence-prefs resend (settings bus). */
export async function setPresenceOverride(userId: string, ov: 'allow' | 'deny' | null): Promise<void> {
  const m = await getPresenceOverrides();
  if (ov) m[userId] = ov;
  else delete m[userId];
  await setSetting('presence.overrides', m);
}

async function setChatPending(chatId: string, pending: boolean): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  chat.pending = pending;
  chat.updatedAt = now();
  await put('chats', chat);
}

// Mirror a contact's display name/avatar onto its paired 1:1 chat (the chat keeps its
// own snapshot, taken at creation when the contact was still a placeholder), so the
// chat list + header reflect the current name/photo.
async function syncChatFromContact(id: string, name: string, avatar: string): Promise<void> {
  const chats = await getAll<Chat>('chats');
  const chat = chats.find(
    (ch) => !ch.isGroup && ch.participantIds.length === 1 && ch.participantIds[0] === id,
  );
  if (chat && (chat.name !== name || chat.avatar !== avatar)) {
    chat.name = name;
    chat.avatar = avatar;
    chat.updatedAt = now();
    await put('chats', chat);
  }
}

/**
 * Ingest a peer's published profile (name/avatar) from a contact card or the directory.
 * The FIRST profile we learn is applied directly; any later CHANGE is STAGED (pending)
 * and the user is asked whether to adopt it (so a peer can't silently relabel themselves,
 * and a user's local override is preserved). A re-send of an unchanged (incl. previously
 * dismissed) profile is a no-op — `remoteName`/`remoteAvatar` track the last seen value,
 * so a dismissed change never re-prompts until the peer changes it again.
 */
export async function updateContactProfile(id: string, name: string, avatar: string, force = false): Promise<void> {
  const c = await getContact(id);
  if (!c) return;
  const newName = (name || '').trim() || c.remoteName || c.name;
  const newAvatar = avatar || c.remoteAvatar || c.avatar;
  const hadRemote = c.remoteName != null || c.remoteAvatar != null;
  if (!force && hadRemote && c.remoteName === newName && c.remoteAvatar === newAvatar) return; // unchanged
  c.remoteName = newName;
  c.remoteAvatar = newAvatar;
  if (force || (!hadRemote && !c.localProfile)) {
    // Apply directly (no prompt): the FIRST profile we learn, or a forced refetch when
    // the user resets a local override back to the peer's own name/photo.
    c.name = newName;
    c.avatar = newAvatar;
    delete c.pendingName;
    delete c.pendingAvatar;
    if (force) delete c.localProfile; // a reset/refetch drops the override
    c.updatedAt = now();
    await put('contacts', c);
    await syncChatFromContact(id, newName, newAvatar);
    return;
  }
  // A genuine change to a known profile → stage it; the user adopts/dismisses via the
  // in-app prompt (useContactProfilePrompts). The displayed name/avatar are untouched.
  c.pendingName = newName;
  c.pendingAvatar = newAvatar;
  c.updatedAt = now();
  await put('contacts', c);
}

/** Adopt a staged remote name/avatar change (the user said yes to the prompt). */
export async function adoptContactProfile(id: string): Promise<void> {
  const c = await getContact(id);
  if (!c || (c.pendingName == null && c.pendingAvatar == null)) return;
  if (c.pendingName != null) c.name = c.pendingName;
  if (c.pendingAvatar != null) c.avatar = c.pendingAvatar;
  delete c.pendingName;
  delete c.pendingAvatar;
  delete c.localProfile; // adopting the peer's profile clears any local override
  c.updatedAt = now();
  await put('contacts', c);
  await syncChatFromContact(id, c.name, c.avatar);
}

/** Decline a staged remote change. It won't re-prompt until the peer changes again
 *  (remoteName/remoteAvatar already hold the new value). */
export async function dismissContactProfile(id: string): Promise<void> {
  const c = await getContact(id);
  if (!c || (c.pendingName == null && c.pendingAvatar == null)) return;
  delete c.pendingName;
  delete c.pendingAvatar;
  c.updatedAt = now();
  await put('contacts', c);
}

/** Set a LOCAL override of a contact's display name and/or avatar (takes precedence
 *  over the peer's; future remote changes still prompt). */
export async function setContactLocalProfile(id: string, opts: { name?: string; avatar?: string }): Promise<void> {
  const c = await getContact(id);
  if (!c) return;
  if (opts.name != null && opts.name.trim()) c.name = opts.name.trim();
  if (opts.avatar) c.avatar = opts.avatar;
  c.localProfile = true;
  c.updatedAt = now();
  await put('contacts', c);
  await syncChatFromContact(id, c.name, c.avatar);
}

/** Revert a local override back to the peer's current name/avatar. */
export async function resetContactToRemote(id: string): Promise<void> {
  const c = await getContact(id);
  if (!c) return;
  if (c.remoteName) c.name = c.remoteName;
  if (c.remoteAvatar) c.avatar = c.remoteAvatar;
  delete c.localProfile;
  delete c.pendingName;
  delete c.pendingAvatar;
  c.updatedAt = now();
  await put('contacts', c);
  await syncChatFromContact(id, c.name, c.avatar);
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
  // How hidden chats (spec 1019) affect the unread badge is user-chosen
  // (privacy.hiddenChatsBadge):
  //   'always'   (default) — hidden chats count, so you always know something is
  //               waiting (the badge can hint a hidden chat exists; the user opted in).
  //   'revealed' — hidden chats count only during an active reveal session.
  //   'never'    — hidden chats never contribute, so the badge can't betray one.
  const mode = await getSetting<string>('privacy.hiddenChatsBadge', 'always');
  const chats = await getAll<Chat>('chats');
  if (mode === 'always') return chats.reduce((n, c) => n + (c.unread || 0), 0);
  // 'never' / 'revealed' need the hidden set to know what to exclude.
  const hidden = await ensureHiddenLoaded();
  if (!isHiddenKnown()) return 0; // unknown set (locked at open) → fail closed
  const countHidden = mode === 'revealed' && isRevealed();
  return chats.reduce((n, c) => n + (!countHidden && hidden.has(c.id) ? 0 : c.unread || 0), 0);
}

export async function countMissedUnseen(): Promise<number> {
  const calls = await getAll<Call>('calls');
  const hidden = await ensureHiddenLoaded();
  if (!isHiddenKnown()) return 0; // unknown set (locked at open) → fail closed so a hidden missed call can't leak into the badge
  if (hidden.size === 0) return calls.filter((c) => c.missed && !c.seen).length;
  const exclude = hiddenCallKeys(await getAll<Chat>('chats'), hidden);
  return calls.filter((c) => c.missed && !c.seen && !exclude.has(c.contactId)).length;
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
  return media?.blob ? URL.createObjectURL(media.blob) : null;
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
// Seven defaults so the quick-react bar is full (7) on a fresh account before any
// usage history exists (spec 1008).
const DEFAULT_QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉'];

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
  bytes: number; // original (full-resolution) bytes
  bytesThumbs: number; // thumbnail-tier bytes (spec 1014 FR-016), shown distinctly from originals
  count: number;
}

/** Spec 1014: total bytes of a Media record's thumbnail tiers (bubble + grid + strip). */
const tierBytes = (m: Media): number =>
  (m.posterBlob?.size ?? 0) + (m.posterGrid?.size ?? 0) + (m.posterStrip?.size ?? 0);
/** Original (full-resolution) bytes still on device — 0 once freed via freeKeepingPreviews. */
const originalBytes = (m: Media): number => (m.blob ? m.size : 0);

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
  // Originals AND thumbnail tiers accounted separately (spec 1014 FR-016).
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const byChat = new Map<string, { bytes: number; bytesThumbs: number; count: number }>();
  for (const m of messages) {
    if (!m.mediaId) continue;
    const md = mediaById.get(m.mediaId);
    if (!md) continue;
    const row = byChat.get(m.chatId) ?? { bytes: 0, bytesThumbs: 0, count: 0 };
    row.bytes += originalBytes(md);
    row.bytesThumbs += tierBytes(md);
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
      bytesThumbs: row.bytesThumbs,
      count: row.count,
    }))
    .sort((a, b) => b.bytes + b.bytesThumbs - (a.bytes + a.bytesThumbs));
}

/** Total on-device media bytes by kind. Originals (`total`/`byKind`) and thumbnail tiers
 *  (`thumbsTotal`/`thumbsByKind`) are accounted separately so the UI can show previews
 *  distinctly from the full images they came from (spec 1014 FR-016). */
export async function storageByType(): Promise<{
  total: number;
  byKind: Record<Media['kind'], number>;
  thumbsTotal: number;
  thumbsByKind: Record<Media['kind'], number>;
}> {
  const media = await getAll<Media>('media');
  const zero = (): Record<Media['kind'], number> => ({ image: 0, video: 0, file: 0, voice: 0, audio: 0 });
  const byKind = zero();
  const thumbsByKind = zero();
  let total = 0;
  let thumbsTotal = 0;
  for (const m of media) {
    const orig = originalBytes(m);
    const thumbs = tierBytes(m);
    byKind[m.kind] += orig;
    total += orig;
    thumbsByKind[m.kind] += thumbs;
    thumbsTotal += thumbs;
  }
  return { total, byKind, thumbsTotal, thumbsByKind };
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
/** The global default disappearing-message timer (privacy.messageTimer) in ms, or
 *  null when off. Applied to NEW 1:1 chats so they start with disappearing on — the
 *  expiry then rides inside each sent message's sealed payload (stampExpiry), so the
 *  messages you send self-destruct for everyone. Existing chats are never touched. */
async function defaultTimerMs(): Promise<number | null> {
  const DAY = 24 * 60 * 60 * 1000;
  switch (await getSetting<string>('privacy.messageTimer', 'off')) {
    case '24h': return DAY;
    case '7d': return 7 * DAY;
    case '90d': return 90 * DAY;
    default: return null;
  }
}

export async function startDirectChat(contact: Contact): Promise<string> {
  const chats = await getAll<Chat>('chats');
  // NEVER resolve to a hidden chat (spec 1019): starting a chat from the contact must
  // not open a PIN-locked hidden conversation — that would reveal it without the PIN.
  // A hidden chat coexists with a normal one; this path only ever uses/creates the
  // normal (non-hidden) chat, creating a fresh one when the sole match is hidden.
  const hiddenSet = await ensureHiddenLoaded();
  const matches = chats.filter(
    (c) =>
      !c.isGroup &&
      c.participantIds.length === 1 &&
      c.participantIds[0] === contact.id &&
      !hiddenSet.has(c.id),
  );
  // Prefer a real (visible) chat over an unaccepted-request placeholder.
  const visible = matches.find((c) => !c.pending);
  if (visible) return visible.id;
  const placeholder = matches[0];
  if (placeholder) {
    // Opening a chat with an already-accepted friend → make it visible.
    if (placeholder.pending && (await isPeerConnected(contact.id))) {
      placeholder.pending = false;
      placeholder.updatedAt = now();
      await put('chats', placeholder);
    }
    return placeholder.id;
  }
  const ts = now();
  const id = uid();
  const ttl = await defaultTimerMs();
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
    ...(ttl ? { defaultTtlMs: ttl } : {}),
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
  // Connect to every co-member named in the card (incl. the sender), so we can fetch
  // their bundles to fan out group messages under the connect-request gate.
  linkGroupMembers([from, ...card.members.map((m) => m.id)]);

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
    if (card.createdBy) existing.createdBy = card.createdBy; // owner, for @everyone validation (spec 1020)
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
      createdBy: card.createdBy, // owner, for @everyone validation (spec 1020)
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

  // "Block unknown account messages" (privacy.blockUnknown): when on, drop a message
  // from someone who is neither already a contact nor an accepted connection — a
  // stranger must connect with you first. Connection REQUESTS travel over a separate
  // server channel (not this E2EE message path), so this never stops someone from
  // reaching out to connect; it only blocks unsolicited message content.
  if (await getSetting<boolean>('privacy.blockUnknown', false)) {
    if (!(await getContact(from)) && !(await isPeerConnected(from))) return;
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
  // Disappearing-messages control: adopt the peer's TTL (side effect, never shown).
  if (payload.ttl !== undefined) {
    if (payload.groupId) await ensureGroupChat(payload.groupId, from);
    await applyTtlControl(payload.groupId ?? chatId, payload.ttl);
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
  // Edits → rewrite the target message's text, never a stored message.
  if (payload.edit) {
    await handleEdit(from, payload.edit);
    if (remoteId) await markInboundSeen(remoteId);
    return;
  }
  // Author delete-for-everyone → tombstone or remove the target, never stored.
  if (payload.erase) {
    await handleErase(from, payload.erase);
    if (remoteId) await markInboundSeen(remoteId);
    return;
  }
  // Deferred link preview → attach to the target text message, never stored.
  if (payload.linkPreviewSig) {
    await handleLinkPreview(from, payload.linkPreviewSig);
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
          await applyThumbTiers(mediaId, await bubbleFromDataUrl(payload.mediaRef.poster)); // spec 1014
          // "Save to Photos": best-effort auto-save of freshly-received media to the
          // device when the app is in the foreground (chats.saveToPhotos). Fire-and-forget.
          void autoSaveIncomingMedia({
            blob,
            kind,
            mime: payload.mediaRef.mime,
            name: payload.mediaRef.name,
            sentAt: payload.timestamp ?? ts,
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
    linkPreview: payload.linkPreview, // present only on the rare fast-enough inline send
    mentions: payload.mentions, // @mentions (spec 1020): member ids tagged in this message
    mentionsEveryone: payload.mentionsEveryone, // honored only if the sender is the group owner (validated below)
    expiresAt: payload.expiresAt, // disappearing messages: same expiry as the sender's copy
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
  // @mentions (spec 1020): am I called out in this group message? Individual mention by
  // id, or an @everyone that the sender is actually the group OWNER of (re-validated on
  // receive so a non-owner can't forge a broadcast). Drives the unread-mention count + a
  // notification escalation. Self-sent messages never count (outgoing === false here).
  const selfId = getSelfUserId() ?? '';
  const selfMentioned =
    isGroupMsg &&
    (!!payload.mentions?.includes(selfId) ||
      (!!payload.mentionsEveryone && !!chat?.createdBy && from === chat.createdBy));
  if (chat) {
    // Group previews show the sender's first name (WhatsApp-style).
    chat.lastMessage = isGroupMsg ? `${contact.name.split(' ')[0]}: ${preview}` : preview;
    chat.lastKind = previewKind(kind, payload.albumName, payload.videoNote);
    chat.lastMessageTime = ts;
    chat.interactions = (chat.interactions ?? 0) + 1;
    // If the user is actively viewing this chat, the message is seen on arrival
    // (the open chat sends the read receipt), so don't grow the unread badge.
    const active = isChatActive(targetChatId);
    chat.unread = active ? 0 : (chat.unread ?? 0) + 1;
    if (selfMentioned && !active) chat.unreadMentions = (chat.unreadMentions ?? 0) + 1;
    // A new message pulls an archived chat back to the main list, UNLESS the user has
    // "Keep chats archived" on (chats.keepArchived). Locked chats stay put regardless.
    if (chat.archived && !chat.locked && !(await getSetting<boolean>('chats.keepArchived', false))) {
      delete chat.archived;
    }
    chat.updatedAt = now();
    await put('chats', chat);
  }

  // Surface the message: in-app banner/sound if focused on another tab, or an
  // OS notification if backgrounded, all gated by the user's notification
  // settings (see services/notify). Skipped for the chat being viewed.
  //
  // AWAITED (spec 1015 FR-005): the relay ack is sent by useSync only after
  // receiveIncoming resolves, so awaiting the notification dispatch here means an
  // incoming item is never acked/drained before it has been surfaced to the user
  // (the message is also already persisted above, so it is never lost either way).
  // A notify error must never block the ack/dedup that follow, so it's swallowed.
  await notifyIncoming({
    kind: 'message',
    chatId: targetChatId,
    name: chat?.isGroup ? chat.name : contact.name,
    // The notification spells out shared location / contact / poll (no icon to lean
    // on), unlike the terser `preview` used for the chats list above.
    body: isGroupMsg ? `${contact.name}: ${notifyPreview(payload)}` : notifyPreview(payload) || 'New message',
    // @mentions (spec 1020): a mention escalates past mute/quiet and names the mentioner.
    mention: selfMentioned,
    mentionName: contact.name,
    // A ring:drain push woke us to fetch this → bypass the post-unlock settle window
    // and let the SW (which already fired for that push) own the OS notification, so
    // a woken message is never swallowed AND never double-announced (spec 2010).
    pushWoken: pushWakeActive(),
  }).catch(() => {});

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
      m.mediaCleared = true; // leave a "removed to free space" placeholder
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
 *  stays, showing "media unavailable"). Returns bytes freed (originals + thumbnail tiers).
 *  The thumbnail tiers are FIELDS on the Media record, so remove() cascades them — no orphan
 *  tiers are possible (spec 1014 FR-017). */
async function deleteSelectedMedia(selected: Media[]): Promise<number> {
  if (!selected.length) return 0;
  const ids = new Set(selected.map((m) => m.id));
  const freed = selected.reduce((n, m) => n + originalBytes(m) + tierBytes(m), 0);
  for (const id of ids) await remove('media', id);
  const messages = await getAll<Message>('messages');
  for (const msg of messages) {
    if (msg.mediaId && ids.has(msg.mediaId)) {
      msg.mediaId = undefined;
      msg.mediaCleared = true; // leave a "removed to free space" placeholder
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

/** Delete ALL media for one chat (originals + tiers), leaving "media unavailable" placeholders.
 *  Per-chat cleanup entry point (spec 1014 FR-019); tiers cascade with the record (FR-017). */
export async function clearChatMedia(chatId: string): Promise<number> {
  return deleteSelectedMedia(await selectMedia({ chatId }));
}

/** "Free space but keep previews" (spec 1014 FR-018): drop the full-resolution original but KEEP the
 *  record, its mediaId, and the bubble/grid/strip tiers — so every list surface still renders the
 *  preview (it reads the tiers, not the original) while the large bytes are reclaimed. Only records
 *  that actually have a tier to fall back on are freed; `size` is zeroed so storage accounting reflects
 *  the reclaimed original. Optionally scoped to one chat. Returns bytes freed. */
export async function freeKeepingPreviews(opts: MediaSelector = {}): Promise<number> {
  const sel = (await selectMedia(opts)).filter((m) => m.blob && (m.posterBlob || m.posterGrid || m.posterStrip));
  let freed = 0;
  for (const m of sel) {
    freed += originalBytes(m);
    m.blob = undefined; // keep the record + mediaId + tiers; just release the original
    m.size = 0;
    m.updatedAt = now();
    await put<Media>('media', m);
  }
  return freed;
}

/** Preview a cleanup: bytes + count that WOULD be freed, without deleting. `bytes` is originals;
 *  `thumbBytes` is the tier bytes that the same delete would also reclaim (spec 1014 FR-016). */
export async function mediaCleanupPreview(
  opts: MediaSelector,
): Promise<{ bytes: number; thumbBytes: number; count: number }> {
  const sel = await selectMedia(opts);
  return {
    bytes: sel.reduce((n, m) => n + originalBytes(m), 0),
    thumbBytes: sel.reduce((n, m) => n + tierBytes(m), 0),
    count: sel.length,
  };
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
export async function markCallMissed(callId: string, outcome?: 'busy' | 'unavailable' | 'declined'): Promise<void> {
  const call = await get<Call>('calls', callId);
  if (!call) return;
  call.missed = call.direction === 'incoming';
  call.outcome = outcome; // busy/unavailable/declined → a clearer label than "No answer"
  call.durationSec = 0;
  call.seen = call.direction !== 'incoming'; // outgoing never pings the badge
  call.updatedAt = now();
  await put('calls', call);
}

/** Record a GROUP call in the Calls tab. Unlike 1:1 (createCall→finishCall), a group
 *  call is logged once at the end with a fresh id (the room id is reused across calls)
 *  and the set of participants that actually joined. */
export async function recordGroupCall(meta: {
  roomId: string;
  name: string;
  avatar: string;
  direction: 'incoming' | 'outgoing';
  video: boolean;
  durationSec: number;
  participants: string[];
  missed: boolean;
}): Promise<void> {
  const ts = now();
  await put<Call>('calls', {
    id: uid(),
    contactId: meta.roomId,
    name: meta.name,
    avatar: meta.avatar,
    direction: meta.direction,
    missed: meta.missed,
    video: meta.video,
    durationSec: meta.durationSec,
    seen: true,
    timestamp: ts,
    updatedAt: ts,
    isGroup: true,
    roomId: meta.roomId,
    participants: meta.participants,
  });
}

// callLogPreview lives in ./calllog (pure, unit-testable without the IndexedDB graph);
// re-exported here so existing importers of '@/db/queries' are unaffected (it's imported
// at the top of this module so logCallToChat can use it locally).
export { callLogPreview };

/** Insert a LOCAL-ONLY informational "call" row into a chat's history (each side logs
 *  its own; never sent to the peer), and update the chat's last-message preview. Works
 *  for a 1:1 chat (chatId = peer) and a group chat (chatId = room id). */
export async function logCallToChat(chatId: string, log: CallLog): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  const ts = now();
  const preview = callLogPreview(log);
  const message: Message = {
    id: uid(),
    chatId,
    senderId: 'me',
    senderName: 'You',
    body: preview,
    kind: 'call',
    timestamp: ts,
    outgoing: log.direction === 'outgoing',
    status: 'seen', // informational; never enqueued, no receipts
    callLog: log,
    updatedAt: ts,
  };
  await put('messages', message);
  chat.lastMessage = preview;
  chat.lastKind = 'call';
  chat.lastMessageTime = ts;
  chat.updatedAt = ts;
  await put('chats', chat);
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
