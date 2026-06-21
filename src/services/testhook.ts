/**
 * DEV-ONLY test hook. Exposes a small imperative API on `window.__ringTest` so an
 * e2e harness (Playwright) can register accounts, pair them, and drive calls
 * headlessly, without scraping the UI for every step. It only calls the same
 * service functions the UI does, so it exercises the real code paths.
 *
 * Installed solely from main.ts under `import.meta.env.DEV`, so it is tree-shaken
 * out of production builds entirely.
 */
import { register, getSelfUserId, getSelfUsername } from '@/services/auth';
import { syncDirectory, importDirectoryUser, searchDirectory, publishOwnProfile } from '@/services/directory';
import { previewPending } from '@/services/sw-inbox';
import { disconnectTransport, nudgeReconnect, forceReconnect, sendDownloadedReceipts, sendSeenReceipts, applySeenPref } from '@/composables/useSync';
import {
  ensureIdentity,
  isUnlocked,
  isInitialized,
  attemptDeviceUnlock,
  enableLock,
  disableLock,
  hasDeviceUnlock,
  isLockEnabled,
  lock as lockIdentity,
} from '@/services/crypto/identity';
import {
  requestFriend as dbRequestFriend,
  acceptRequest as dbAcceptRequest,
  addPendingInvite,
  listContacts,
  createGroup as dbCreateGroup,
  addToGroup as dbAddToGroup,
  addMemberToGroup as dbAddMemberToGroup,
  inviteToGroup as dbInviteToGroup,
  acceptGroupInvite as dbAcceptGroupInvite,
  declineGroupInvite as dbDeclineGroupInvite,
  listGroupInvites as dbListGroupInvites,
  removeMember as dbRemoveMember,
  renameGroup as dbRenameGroup,
  setGroupAvatar as dbSetGroupAvatar,
  updateContactProfile as dbUpdateContactProfile,
  leaveGroup as dbLeaveGroup,
  sendMessage as dbSendMessage,
  editMessage as dbEditMessage,
  deleteMessageForEveryone as dbDeleteMessageForEveryone,
  reactToMessage as dbReactToMessage,
  quickReactEmojis as dbQuickReactEmojis,
  getMessage as dbGetMessage,
  firstMessageOnOrAfter as dbFirstMessageOnOrAfter,
  sendLocation as dbSendLocation,
  sendPoll as dbSendPoll,
  sendContact as dbSendContact,
  votePoll as dbVotePoll,
  sendMediaMessage as dbSendMediaMessage,
  setChatTtl as dbSetChatTtl,
  setChatNotifyPrefs as dbSetChatNotifyPrefs,
  type ChatNotifyPrefs,
  sweepExpiredMessages as dbSweepExpired,
  getChat as dbGetChat,
  deleteChat as dbDeleteChat,
  getContact as dbGetContact,
  startDirectChat as dbStartDirectChat,
  refreshContactStatuses as dbRefreshContactStatuses,
  refreshBlocks as dbRefreshBlocks,
  blockContact as dbBlockContact,
  unblockContact as dbUnblockContact,
  isPeerBlocked as dbIsPeerBlocked,
  deleteContact as dbDeleteContact,
  setSetting as dbSetSetting,
  storageByType as dbStorageByType,
  storageByChat as dbStorageByChat,
  deleteMediaByKind as dbDeleteMediaByKind,
  deleteMediaLargerThan as dbDeleteMediaLargerThan,
  freeKeepingPreviews as dbFreeKeepingPreviews,
  clearChatMedia as dbClearChatMedia,
  listMessages,
  listChats,
  listArchivedChats,
  toggleChatFavorite as dbToggleChatFavorite,
  setChatPinned as dbSetChatPinned,
  setChatArchived as dbSetChatArchived,
  markChatUnread as dbMarkChatUnread,
  markChatRead as dbMarkChatRead,
  createChatList as dbCreateChatList,
  setChatInList as dbSetChatInList,
  deleteChatList as dbDeleteChatList,
  setChatLocked as dbSetChatLocked,
  listChatLists,
  listLockedChats,
  getSetting,
  downloadMessageMedia as dbDownloadMessageMedia,
  createPost as dbCreatePost,
  syncPosts as dbSyncPosts,
  getPost as dbGetPost,
  listWallPosts as dbListWallPosts,
  reactToPost as dbReactToPost,
  syncEngagement as dbSyncEngagement,
  listPostReactions as dbListPostReactions,
  listPostComments as dbListPostComments,
  commentOnPost as dbCommentOnPost,
  deleteComment as dbDeleteComment,
  recordPostView as dbRecordPostView,
  listPostViews as dbListPostViews,
  setCloseFriend as dbSetCloseFriend,
  listCloseFriends as dbListCloseFriends,
  listFriends as dbListFriends,
} from '@/db/queries';
import { downloadBlob } from '@/services/media-transfer';
import {
  chatMatchesFilter,
  type FilterId,
} from '@/services/chat-filters';
import {
  createInvitation, deleteAccount, fetchPeerBundle,
  listConnections as apiListConnections,
} from '@/services/api';
import { runInviteSync } from '@/services/invites';
import { notifyBanners } from '@/services/notify';
import { syncContactEdges } from '@/services/directory';
import {
  requestConnect as storeRequestConnect, acceptConnect as storeAcceptConnect,
  rejectConnect as storeRejectConnect, withdrawConnect as storeWithdrawConnect,
  refreshConnections as storeRefreshConnections,
  incomingRequests as storeIncomingRequests,
  linkConnect as storeLinkConnect,
} from '@/services/connections';
import { subscribePresence, sendActivity } from '@/composables/useSync';
import { peerPresence } from '@/composables/usePresence';
import { activityFor } from '@/composables/useTyping';
import type { ActivityKind, ActivityState } from '@/services/transport';
import { setSecret } from '@/db/secrets';
import { get, getAll, put, bulkPut } from '@/db/idb';
import { uid } from '@/utils/uid';
import { seedShowcase as runSeedShowcase } from '@/services/showcase-seed';
import type { FriendRequest, Media, Message } from '@/db/types';
import {
  startDirectCall,
  startGroupCall,
  acceptCall,
  rejectCall,
  hangupCall,
  toggleVideoMode,
  setVideoQuality,
  type VideoQuality,
  acceptUpgrade,
  upgradeRequest,
  callState,
  callMeta,
  remoteStream,
  remoteStreams,
  groupStreamOwners,
  groupAudioLevels,
  activeSpeakers,
  localStream,
  callStats,
  videoTransceiverCount,
  inboundVideoFrames,
} from '@/composables/useCall';

export function installTestHook(): void {
  const api = {
    /** Register with an invite code + username. Tests may omit the username; a
     *  valid, unique handle is derived from the (single-use) invite code. */
    register: (code: string, username?: string) =>
      register(code, username ?? `u_${code}`.toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 28)),
    /** Mint a fresh single-use invite code from the dev-only server endpoint, so a
     *  test (or a Playwright retry) can register with a code that is always fresh
     *  rather than re-consuming a fixed seed code. Dev/test only. */
    freshCode: async (): Promise<string> => {
      const res = await fetch('/v1/dev/invite', { method: 'POST' });
      if (!res.ok) throw new Error(`dev invite mint failed: ${res.status}`);
      return ((await res.json()) as { code: string }).code;
    },
    /** Create the keystore identity under a PIN (mirrors the create-PIN screen). */
    createPin: (pin: string) => ensureIdentity(pin),
    /** Passwordless identity create (device-key auto-unlock). Tolerant of an
     *  identity already created (e.g. by the KeyGuard auto-create race). */
    createAuto: async (): Promise<void> => {
      try {
        await ensureIdentity();
      } catch (e) {
        if (!(e instanceof Error) || !/already exists/i.test(e.message)) throw e;
      }
    },
    /** Auto-unlock via the device key (returns true if unlocked). */
    attemptDeviceUnlock: () => attemptDeviceUnlock(),
    /** Service-worker background decrypt: read-only previews of queued messages
     *  (returns [{title,body,url}]). Does not persist or ack. */
    previewPending: () => previewPending().then((r) => r.notes),
    /** Full background-preview result (notes + pending + suppressed + silenced), so a
     *  test can assert the closed-app SW decision (spec 1015 badge-only / web-push-off). */
    previewPendingFull: () => previewPending(),
    /** Drop the WebSocket so the server queues messages (simulate app closed). */
    disconnect: () => disconnectTransport(),
    /** Reconnect the WebSocket (drains the queue for real). */
    reconnect: () => nudgeReconnect(),
    forceReconnect: () => forceReconnect(),
    /** Lock memory (to test re-unlock on reload). */
    lockNow: () => lockIdentity(),
    /** Whether this device auto-unlocks (no passcode lock). */
    hasDeviceUnlock: () => hasDeviceUnlock(),
    /** Whether a passcode lock is enabled. */
    isLockEnabled: () => isLockEnabled(),
    /** Opt into a passcode lock (removes device auto-unlock). */
    enableLock: (pin: string) => enableLock(pin),
    /** Opt out of the passcode lock (restores device auto-unlock). */
    disableLock: (pin: string) => disableLock(pin),
    selfId: () => getSelfUserId(),
    isUnlocked: () => isUnlocked.value,
    isInitialized: () => isInitialized.value,

    /** Send a friend request to a peer Ring id. */
    requestFriend: (peerId: string) => dbRequestFriend(peerId),
    /** Accept an incoming friend request (id == requester's Ring id). */
    acceptRequest: (id: string) => dbAcceptRequest(id),

    /** Set this account's profile (name + avatar) so it's "complete". Also pushes
     *  to the directory (like the real ProfilePage), so peers see the name. */
    setProfile: async (name: string, avatar: string): Promise<void> => {
      await setSecret('profileName', name);
      await setSecret('profileAvatar', avatar);
      await publishOwnProfile();
    },
    /** Create an invite code with a label; returns the code. */
    createInvite: async (label: string): Promise<string> => {
      const { code } = await createInvitation();
      await addPendingInvite(code, label);
      return code;
    },
    /** Force an invitation auto-connect sweep (poll redemptions / connect inviter). */
    syncInvites: () => runInviteSync(),
    /** Current in-app notification banners (kind/name/body) for asserting alerting. */
    notices: (): { kind: string; name: string; body: string }[] =>
      notifyBanners.value.map((b) => ({ kind: b.kind, name: b.name, body: b.body })),
    /** Ids of current (non-pending) contacts. */
    contactIds: async (): Promise<string[]> => (await listContacts()).map((c) => c.id),
    /** Set a known contact's display name (the name you'd have saved locally). */
    setContactName: (id: string, name: string) => dbUpdateContactProfile(id, name, ''),

    /* ---- group chat ---- */
    createGroup: (name: string, memberIds: string[]) => dbCreateGroup(name, memberIds),
    addToGroup: (chatId: string, memberId: string) => dbAddToGroup(chatId, memberId),
    addMemberToGroup: (chatId: string, memberId: string) => dbAddMemberToGroup(chatId, memberId),
    inviteToGroup: (chatId: string, memberId: string) => dbInviteToGroup(chatId, memberId),
    acceptGroupInvite: (groupId: string) => dbAcceptGroupInvite(groupId),
    declineGroupInvite: (groupId: string) => dbDeclineGroupInvite(groupId),
    groupInviteIds: async (): Promise<string[]> =>
      (await dbListGroupInvites()).map((r) => r.groupId ?? '').filter(Boolean),
    removeMember: (chatId: string, memberId: string) => dbRemoveMember(chatId, memberId),
    renameGroup: (chatId: string, name: string) => dbRenameGroup(chatId, name),
    setGroupAvatar: (chatId: string, dataUrl: string) => dbSetGroupAvatar(chatId, dataUrl),
    leaveGroup: (chatId: string) => dbLeaveGroup(chatId),
    sendChatMessage: (chatId: string, body: string) => dbSendMessage(chatId, body),
    editChatMessage: (messageId: string, body: string) => dbEditMessage(messageId, body),
    deleteForEveryone: (messageId: string, trace: boolean) => dbDeleteMessageForEveryone(messageId, trace),
    setChatTtl: (chatId: string, ms: number | null) => dbSetChatTtl(chatId, ms),
    /** Set per-chat notification controls (spec 1015): { webPush?, inApp?, content? }. */
    setChatNotify: (chatId: string, patch: Partial<ChatNotifyPrefs>) => dbSetChatNotifyPrefs(chatId, patch),
    /** Write a global setting (e.g. notifications.inapp.enabled) for assertions. */
    setGlobalSetting: (key: string, value: unknown) => dbSetSetting(key, value),
    sweepExpired: () => dbSweepExpired(),
    chatTtl: async (chatId: string) => (await dbGetChat(chatId))?.defaultTtlMs ?? null,
    /** Delete a chat (removes messages + the ratchet session). */
    deleteChat: (chatId: string) => dbDeleteChat(chatId),
    /** Delete a contact (keeps the conversation for a ghosted peer). */
    deleteContact: (id: string) => dbDeleteContact(id),
    /** Start (or reuse) a 1:1 chat with a known contact; returns the chat id. */
    startChat: async (peerId: string): Promise<string> => {
      const c = await dbGetContact(peerId);
      return c ? dbStartDirectChat(c) : '';
    },
    /** The 1:1 chat id for a peer (incl. a still-pending one), or '' if none. */
    chatWith: async (peerId: string): Promise<string> => {
      const all = await getAll<{ id: string; isGroup: boolean; participantIds: string[] }>('chats');
      return all.find((c) => !c.isGroup && c.participantIds[0] === peerId)?.id ?? '';
    },
    /** The VISIBLE (non-pending) 1:1 chat id for a peer, or '' if hidden/none. */
    visibleChatWith: async (peerId: string): Promise<string> =>
      (await listChats()).find((c) => !c.isGroup && c.participantIds[0] === peerId)?.id ?? '',

    /* ---- account lifecycle: termination ("Ghosted") + blocking ---- */
    /** Terminate THIS account server-side (drives the peer's ghost detection). */
    deleteAccount: () => deleteAccount(),
    /** Poll the server + ghost any terminated contacts. */
    refreshContactStatuses: () => dbRefreshContactStatuses(),
    /** Reconcile the local block ledger with the server. */
    refreshBlocks: () => dbRefreshBlocks(),
    /** Whether a contact is flagged "Ghosted" (terminated). */
    contactGhosted: async (id: string): Promise<boolean> => (await dbGetContact(id))?.ghosted === true,
    /** Block / unblock a peer (server + local). */
    blockContact: (id: string) => dbBlockContact(id),
    unblockContact: (id: string) => dbUnblockContact(id),
    /** Whether a peer is in our local block ledger. */
    isPeerBlocked: (id: string) => dbIsPeerBlocked(id),
    /** Whether the server still hands us a peer's key bundle (false once they
     *  terminate, or once they've blocked us → can't re-add). */
    peerBundleExists: async (id: string): Promise<boolean> => (await fetchPeerBundle(id)) !== null,
    /** Messages in a chat, as {id, body, senderId, outgoing, reactions, replyTo, albumId}. */
    messages: async (chatId: string) =>
      (await listMessages(chatId)).map((m) => ({
        id: m.id,
        body: m.body,
        kind: m.kind,
        status: m.status,
        hasPoster: !!m.posterData, // spec 1014: the bubble-tier preview rode the sealed envelope
        seenReportedAt: m.seenReportedAt ?? null, // spec 1013: this device reported it Seen
        senderId: m.senderId,
        outgoing: m.outgoing,
        reactions: m.reactions ?? [],
        replyTo: m.replyTo ?? null,
        albumId: m.albumId ?? null,
        deleted: !!m.deleted,
        editedAt: m.editedAt ?? null,
        location: m.location ?? null,
        poll: m.poll ?? null,
        contact: m.contact ?? null,
        audio: m.audio ?? null,
      })),
    /* ---- media blob lifecycle (server cleanup tests) ---- */
    /** A message's media state: whether the bytes are on-device (mediaId), still pending,
     *  and the server blob id the SENDER kept for cleanup (undefined once it deletes it). */
    mediaInfo: async (messageId: string) => {
      const m = await dbGetMessage(messageId);
      return {
        hasMedia: !!m?.mediaId,
        pending: !!m?.pendingMedia,
        sentBlobId: m?.sentBlobId ?? null,
      };
    },
    /** Download an incoming message's media (as the UI does on tap / auto-download). */
    downloadMedia: (messageId: string): Promise<void> => dbDownloadMessageMedia(messageId),
    /** Whether a blob still exists on the server (200 vs 404). */
    blobExists: async (blobId: string): Promise<boolean> => (await downloadBlob(blobId)) !== null,
    /** Confirm to senders that this chat's downloaded media is on-device (the 'downloaded'
     *  receipt the UI sends on view), so they delete the server blob now rather than at the tick. */
    confirmDownloads: (chatId: string): Promise<void> => sendDownloadedReceipts(chatId),

    /** The oldest message id in a chat (for the jump-to-older seek test, spec 1011). */
    firstMessageId: (chatId: string): Promise<string | null> => dbFirstMessageOnOrAfter(chatId, 0),

    /** Send `body` as a reply quoting the message `quotedId`. */
    sendReply: async (chatId: string, body: string, quotedId: string): Promise<void> => {
      const m = await dbGetMessage(quotedId);
      if (!m) return;
      const self = getSelfUserId() ?? '';
      await dbSendMessage(chatId, body, {
        id: m.id,
        senderId: m.outgoing ? self : m.senderId,
        preview: m.body || m.kind,
      });
    },
    /* ---- seen receipts (spec 1010) ---- */
    /** Send 'seen' receipts for a chat's incoming messages (what the UI does when the
     *  chat is viewed). A no-op when the "Seen receipts" privacy toggle is off. */
    markSeen: (chatId: string) => sendSeenReceipts(chatId),
    /** Re-read the privacy.seenReceipts toggle into the emit gate (deterministic
     *  alternative to waiting for the settings-change reaction in tests). */
    applySeenPref: () => applySeenPref(),
    /** A message's per-member receipts roster {contactId, deliveredAt, seenAt,
     *  downloadedAt}, for asserting "Seen X/N" group progress + the info-page lists. */
    messageReceipts: async (messageId: string) => (await dbGetMessage(messageId))?.receipts ?? [],

    /** Add/toggle the local user's emoji reaction on a message. */
    reactToMessage: (messageId: string, emoji: string) => dbReactToMessage(messageId, emoji),
    /** The most-used-first quick-react set (the menu's emoji row order). Lets e2e
     *  assert usage-based reordering (spec 1004 FR-006). */
    quickReactEmojis: (limit?: number) => dbQuickReactEmojis(limit),

    /* ---- location / poll / contact ---- */
    sendLocation: (chatId: string, lat: number, lng: number, label?: string) =>
      dbSendLocation(chatId, { lat, lng, label }),
    sendPoll: (chatId: string, question: string, options: string[], multi = false) =>
      dbSendPoll(chatId, question, options, multi),
    sendContact: (chatId: string, userId: string, name: string, avatar?: string) =>
      dbSendContact(chatId, { userId, name, avatar }),
    votePoll: (messageId: string, option: number) => dbVotePoll(messageId, option),
    sendAudio: (chatId: string, name: string, title: string, artist: string) =>
      dbSendMediaMessage(chatId, 'audio', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' }), name, 12, {
        audio: { title, artist },
      }),
    /** Send a round video-note ("video message"). */
    sendVideoNote: (chatId: string, name: string) =>
      dbSendMediaMessage(chatId, 'video', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/mp4' }), name, 8, {
        videoNote: true,
      }),
    /** Send a photo/video at a quality → exercises the background compression job. */
    sendMediaQuality: (chatId: string, kind: 'image' | 'video', name: string, quality: 'sd' | 'hd' | 'original') =>
      dbSendMediaMessage(
        chatId,
        kind,
        new Blob([new Uint8Array([1, 2, 3, 4])], { type: kind === 'image' ? 'image/png' : 'video/mp4' }),
        name,
        undefined,
        { quality },
      ),
    /** Send a REAL, decodable image of the given pixel dimensions (a gradient, so JPEG
     *  downscales produce genuinely different-sized tiers) at original quality — used to
     *  exercise the spec-1014 bubble/grid/strip thumbnail tiers end-to-end. */
    sendImage: async (chatId: string, w = 1024, h = 768, name = 'photo.png'): Promise<void> => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cx = c.getContext('2d')!;
      const g = cx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#1e3a8a');
      g.addColorStop(1, '#f59e0b');
      cx.fillStyle = g;
      cx.fillRect(0, 0, w, h);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
      await dbSendMediaMessage(chatId, 'image', blob, name, undefined, { quality: 'original' });
    },
    /** Seed a REAL, decodable image as a Media record with NO thumbnail tiers (mimicking media
     *  that predates spec 1014) so the on-open backfill (T011) can be exercised. */
    seedLegacyImage: async (chatId: string, w = 1024, h = 768): Promise<string> => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cx = c.getContext('2d')!;
      const g = cx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#0f766e');
      g.addColorStop(1, '#f43f5e');
      cx.fillStyle = g;
      cx.fillRect(0, 0, w, h);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
      const id = uid();
      await put<Media>('media', {
        id,
        kind: 'image',
        mime: 'image/png',
        name: 'legacy.png',
        size: blob.size,
        blob, // no posterBlob/posterGrid/posterStrip → the backfill must derive them
        updatedAt: Date.now(),
      });
      const msgId = uid();
      await put<Message>('messages', {
        id: msgId,
        chatId,
        senderId: 'me',
        senderName: 'You',
        body: '',
        kind: 'image',
        mediaId: id,
        timestamp: Date.now(),
        outgoing: true,
        status: 'sent',
        updatedAt: Date.now(),
      });
      return msgId;
    },
    /** Send `count` real images sharing one albumId → they render as a single grouped album
     *  bubble. Used to exercise "Go to message" on a non-first album photo (spec 1014 follow-up). */
    sendAlbum: async (chatId: string, count = 3): Promise<void> => {
      const albumId = uid();
      for (let i = 0; i < count; i++) {
        const c = document.createElement('canvas');
        c.width = 800;
        c.height = 600;
        const cx = c.getContext('2d')!;
        const g = cx.createLinearGradient(0, 0, 800, 600);
        g.addColorStop(0, i % 2 ? '#0ea5e9' : '#7c3aed');
        g.addColorStop(1, '#f59e0b');
        cx.fillStyle = g;
        cx.fillRect(0, 0, 800, 600);
        const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
        await dbSendMediaMessage(chatId, 'image', blob, `album-${i}.png`, undefined, {
          quality: 'original',
          albumId,
          albumName: 'Album',
        });
      }
    },
    /** Pixel dimensions of each persisted thumbnail tier for a message's media (null if the
     *  tier or media is absent), so e2e can assert each tier is right-sized (spec 1014). */
    mediaTierDims: async (
      messageId: string,
    ): Promise<{
      full: { w: number; h: number } | null;
      bubble: { w: number; h: number } | null;
      grid: { w: number; h: number } | null;
      strip: { w: number; h: number } | null;
    }> => {
      const m = await dbGetMessage(messageId);
      const md = m?.mediaId ? await get<Media>('media', m.mediaId) : undefined;
      const dims = async (b?: Blob): Promise<{ w: number; h: number } | null> => {
        if (!b) return null;
        try {
          const bmp = await createImageBitmap(b);
          const out = { w: bmp.width, h: bmp.height };
          bmp.close?.();
          return out;
        } catch {
          return null;
        }
      };
      return {
        full: await dims(md?.blob),
        bubble: await dims(md?.posterBlob),
        grid: await dims(md?.posterGrid),
        strip: await dims(md?.posterStrip),
      };
    },
    /** A poll's per-option vote counts, for assertions. */
    pollCounts: async (messageId: string): Promise<number[]> => {
      const m = await dbGetMessage(messageId);
      const poll = m?.poll;
      if (!poll) return [];
      return poll.options.map((_, i) => poll.votes.filter((v) => v.option === i).length);
    },
    /** A message's reactions grouped by emoji: [{ emoji, count }]. */
    getReactions: async (messageId: string): Promise<Array<{ emoji: string; count: number }>> => {
      const all = await getAll<{ id: string; reactions?: Array<{ emoji: string }> }>('messages');
      const m = all.find((x) => x.id === messageId);
      const counts = new Map<string, number>();
      for (const r of m?.reactions ?? []) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
      return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }));
    },
    /** Visible group chats, as {id, name, members}. */
    groupChats: async () =>
      (await listChats()).filter((c) => c.isGroup).map((c) => ({ id: c.id, name: c.name, members: c.participantIds })),

    /* ---- Chats-tab organisation (filter chips / lists / per-chat ops) ---- */
    favoriteChat: (id: string) => dbToggleChatFavorite(id),
    pinChat: (id: string, pinned: boolean) => dbSetChatPinned(id, pinned),
    archiveChat: (id: string, archived: boolean) => dbSetChatArchived(id, archived),
    markChatUnread: (id: string) => dbMarkChatUnread(id),
    markChatRead: (id: string) => dbMarkChatRead(id),
    createList: (name: string, chatIds: string[]) => dbCreateChatList(name, chatIds),
    addToList: (listId: string, chatId: string) => dbSetChatInList(listId, chatId, true),
    deleteList: (id: string) => dbDeleteChatList(id),
    listIds: async (): Promise<string[]> => (await listChatLists()).map((l) => l.id),
    /** Ids of the main (non-archived) chats, in display order (pinned first). */
    chatOrder: async (): Promise<string[]> => (await listChats()).map((c) => c.id),
    /** Ids of archived chats. */
    archivedChatIds: async (): Promise<string[]> => (await listArchivedChats()).map((c) => c.id),
    lockChat: (id: string, locked: boolean) => dbSetChatLocked(id, locked),
    /** Ids of locked chats (the auth-gated view's contents). */
    lockedChatIds: async (): Promise<string[]> => (await listLockedChats()).map((c) => c.id),
    /** Ids of chats matching a filter chip (over the main list), for assertions. */
    chatsMatching: async (filter: string): Promise<string[]> => {
      const lists = new Map((await listChatLists()).map((l) => [l.id, l]));
      return (await listChats())
        .filter((c) => chatMatchesFilter(c, filter as FilterId, lists))
        .map((c) => c.id);
    },
    /** Persist / read the tab-filter chip order (synced preference). */
    setTabFilters: (ids: string[]) => dbSetSetting('chats.tabFilters', ids),
    getTabFilters: () => getSetting<string[]>('chats.tabFilters', []),
    /** A contact's display name (to verify profiles propagated), or '' if none.
     *  Reads the contact record directly (listContacts hides ghosted ones). */
    contactName: async (id: string): Promise<string> => (await dbGetContact(id))?.name ?? '',
    /** Ids of incoming pending friend requests (to accept). */
    pendingRequestIds: async (): Promise<string[]> => {
      const reqs = await getAll<FriendRequest>('requests');
      return reqs
        .filter((r) => r.direction === 'incoming' && r.status === 'pending' && r.kind !== 'group-invite')
        .map((r) => r.id);
    },

    /* ---- directory ---- */
    /** This account's immutable username. */
    selfUsername: () => getSelfUsername(),
    /** Pull the in-network directory into local contacts. */
    syncDirectory: () => syncDirectory(),
    /** Fetch + mirror one directory member by id; returns the contact id or null. */
    importDirectoryUser: (id: string) => importDirectoryUser(id),
    /** Push our contact edges to the server (presence audience). */
    syncContactEdges: () => syncContactEdges(),

    /* ---- presence ---- */
    /** Set a setting (e.g. privacy.online / privacy.lastSeen). */
    setSetting: (key: string, value: unknown) => dbSetSetting(key, value),
    /** Subscribe to presence for ids (directory browse path). */
    subscribePresence: (ids: string[]) => subscribePresence(ids),
    /** A peer's known online state (reactive presence map), or null if unknown. */
    peerOnline: (id: string): boolean | null => {
      const p = peerPresence(id);
      return p ? p.online : null;
    },

    /* ---- activity indicators (spec 1009) ---- */
    /** Emit an ephemeral activity signal to a peer (drives the real seal+relay path).
     *  Pass `conversationId` to scope it to a shared group id (1:1 omits it). */
    emitActivity: (peerId: string, kind: ActivityKind, state: ActivityState, conversationId?: string) =>
      sendActivity({ peerUserId: peerId, conversationId, kind, state }),
    /** A peer's current activity kind in a conversation (1:1 keyed by peer id), or null. */
    peerActivity: (conversationKey: string): ActivityKind | null => {
      const list = activityFor(conversationKey);
      return list.length ? list[0].kind : null;
    },
    /** Number of distinct active senders in a conversation (for group coalescing tests). */
    activityCount: (conversationKey: string): number => activityFor(conversationKey).length,

    /* ---- media storage cleanup ---- */
    /** Seed a fake media blob + a message linking it (for storage tests). */
    seedMedia: async (chatId: string, kind: Media['kind'], bytes: number): Promise<void> => {
      const id = uid();
      await put<Media>('media', {
        id,
        kind,
        mime: 'application/octet-stream',
        name: `seed.${kind}`,
        size: bytes,
        blob: new Blob([new Uint8Array(Math.min(bytes, 1024))]),
        updatedAt: Date.now(),
      });
      await put<Message>('messages', {
        id: uid(),
        chatId,
        senderId: 'me',
        senderName: 'You',
        body: '',
        kind: kind === 'voice' ? 'voice' : kind,
        mediaId: id,
        timestamp: Date.now(),
        outgoing: true,
        status: 'sent',
        updatedAt: Date.now(),
      });
    },

    /** Bulk-seed `n` messages into a chat in ONE transaction (spec 1011, research D9).
     *  A 5,000-message scroll test through the real send pipeline is impractical
     *  (minutes/run, hits crypto/relay); this writes spread-timestamp rows with a single
     *  bulkPut so the smoothness assertions run instantly + deterministically.
     *  - `fromIds` rotates senders (group histories); defaults to self + one peer.
     *  - `mediaEvery` makes every Nth row an image (height variety + media-LRU pressure).
     *  Dev-only — stripped from prod with the rest of __ringTest. */
    seedMessages: async (
      chatId: string,
      n: number,
      opts: { fromIds?: string[]; mediaEvery?: number; unseen?: boolean } = {},
    ): Promise<void> => {
      const self = getSelfUserId() ?? 'me';
      const senders = opts.fromIds && opts.fromIds.length ? opts.fromIds : [self, 'seed-peer-1'];
      const mediaEvery = opts.mediaEvery && opts.mediaEvery > 0 ? Math.floor(opts.mediaEvery) : 0;
      const step = 60_000; // 1 min apart → realistic day-divider variety over a long chat
      const base = Date.now() - n * step;
      // A 1×1 PNG — the same tiny decodable image the e2e paste flow uses.
      const pngB64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const pngBytes = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0));

      const media: Media[] = [];
      const rows: Message[] = [];
      for (let i = 0; i < n; i++) {
        const senderId = senders[i % senders.length];
        const outgoing = senderId === self || senderId === 'me';
        const ts = base + i * step;
        const isMedia = mediaEvery > 0 && (i + 1) % mediaEvery === 0;
        let mediaId: string | undefined;
        if (isMedia) {
          mediaId = uid();
          media.push({
            id: mediaId,
            kind: 'image',
            mime: 'image/png',
            name: `seed-${i}.png`,
            size: pngBytes.byteLength,
            blob: new Blob([pngBytes], { type: 'image/png' }),
            updatedAt: ts,
          });
        }
        rows.push({
          id: uid(),
          chatId,
          senderId,
          senderName: outgoing ? 'You' : senderId,
          body: isMedia ? '' : `Seeded message ${i + 1} of ${n}`,
          kind: isMedia ? 'image' : 'text',
          mediaId,
          timestamp: ts,
          outgoing,
          status: outgoing ? 'seen' : 'seen',
          // Spec 1013: seeded incoming messages are historical → already seen-reported, so the
          // not-yet-Seen pill starts at 0 (matches the upgrade backfill). `opts.unseen` seeds an
          // unseen backlog for the visibility-driven Seen tests.
          seenReportedAt: outgoing || opts.unseen ? undefined : ts,
          updatedAt: ts,
        });
      }
      if (media.length) await bulkPut<Media>('media', media);
      await bulkPut<Message>('messages', rows); // ONE write for all messages
    },

    /** Inject the curated showcase demo dataset (contacts, chats, messages, media,
     *  call log) for the screenshot harness. See services/showcase-seed.ts. */
    seedShowcase: (): Promise<void> => runSeedShowcase(),
    /** Total on-device media bytes by kind (originals + thumbnail tiers, distinct). Spec 1014. */
    storageByType: () => dbStorageByType(),
    /** Per-chat media footprint incl. thumbnail-tier bytes (spec 1014 FR-016). */
    storageByChat: () => dbStorageByChat(),
    deleteMediaByKind: (kinds: Media['kind'][], chatId?: string) => dbDeleteMediaByKind(kinds, chatId),
    deleteMediaLargerThan: (bytes: number, chatId?: string) => dbDeleteMediaLargerThan(bytes, chatId),
    /** Spec 1014 FR-018: free originals but keep the bubble/grid/strip previews (optionally per chat). */
    freeKeepingPreviews: (chatId?: string) => dbFreeKeepingPreviews(chatId ? { chatId } : {}),
    /** Spec 1014 FR-019: delete all media in one chat (originals + tiers). */
    clearChatMedia: (chatId: string) => dbClearChatMedia(chatId),
    /** Server-side directory search → [{id, username, displayName}]. */
    // Drive the real client store actions (import + mark-connected + reconcile),
    // not the raw API, so e2e exercises the actual friend-request behavior.
    connectRequest: (target: string) => storeRequestConnect(target),
    connectLink: (target: string) => storeLinkConnect(target),
    connectAccept: (requester: string) => storeAcceptConnect(requester),
    connectReject: (requester: string, block: boolean) => storeRejectConnect(requester, block),
    connectWithdraw: (target: string) => storeWithdrawConnect(target),
    connections: () => apiListConnections(),
    // Reconcile the reactive connections store from the server — the same thing
    // useSync does on (re)connect. Lets e2e assert the badge deterministically
    // instead of racing the best-effort live connect-req push.
    syncConnections: () => storeRefreshConnections(),
    // The Contacts-tab badge counts exactly these (useBadges → incomingRequests),
    // so asserting on the store is asserting the badge's source of truth without
    // having to drive the full auth UI into the tab bar.
    incomingRequestIds: (): string[] => storeIncomingRequests.value.map((r) => r.userId),
    searchDirectory: async (q: string) =>
      (await searchDirectory(q)).map((u) => ({ id: u.id, username: u.username, displayName: u.displayName })),

    /* ---- Wall (spec 0003): drive the real queries.ts orchestration so e2e exercises
       the actual encrypt → upload → fan-out → receive/open path, not a shortcut. ---- */
    /** Compose + share a post. Returns the new post id. */
    post: async (opts: { body?: string; audience?: 'friends' | 'close'; lifetime?: '1h' | '24h' | '72h' }): Promise<string> => {
      const p = await dbCreatePost({ body: opts.body, audience: opts.audience ?? 'friends', lifetime: opts.lifetime ?? '24h' });
      return p.id;
    },
    /** Pull posts addressed to us (and apply revocations). */
    syncPosts: () => dbSyncPosts(),
    /** Ids of the non-expired, non-hidden posts on this device (feed order). */
    wallPostIds: async (): Promise<string[]> => (await dbListWallPosts()).map((p) => p.id),
    /** A single post as a lean view, or null if we don't have it. */
    getPost: async (id: string) => {
      const p = await dbGetPost(id);
      return p ? { id: p.id, kind: p.kind, body: p.body, author: p.author, audience: p.audience, outgoing: p.outgoing } : null;
    },
    /** React to a post; returns the action ('added' | 'removed' | 'limit' | ...). */
    reactToPost: (postId: string, emoji: string) => dbReactToPost(postId, emoji),
    /** Pull a post's engagement (reactions/comments/views) from the server. */
    syncEngagement: (postId: string) => dbSyncEngagement(postId),
    /** A post's reactions as { actor, emoji } pairs. */
    postReactions: async (postId: string): Promise<{ actor: string; emoji: string }[]> =>
      (await dbListPostReactions(postId)).map((r) => ({ actor: r.actor, emoji: r.emoji ?? '' })),
    /** Add a comment to a post. */
    commentOnPost: (postId: string, text: string) => dbCommentOnPost(postId, text),
    /** A post's comments as { id, actor, text, deleted } (excludes nothing, so a
     *  tombstoned comment shows deleted=true). */
    postComments: async (postId: string): Promise<{ id: string; actor: string; text: string; deleted: boolean }[]> =>
      (await dbListPostComments(postId)).map((c) => ({ id: c.id, actor: c.actor, text: c.text ?? '', deleted: !!c.deleted })),
    /** Delete one of our own comments (or any comment if we authored the post). */
    deletePostComment: (postId: string, commentId: string) => dbDeleteComment(postId, commentId),
    /** Record that we viewed a post (gated by the seen-receipts setting). */
    recordPostView: (postId: string) => dbRecordPostView(postId),
    /** A post's viewer ids (author-only server-side). */
    postViews: (postId: string): Promise<string[]> => dbListPostViews(postId),
    /** Toggle a contact's close-friend flag (demoting revokes close-only posts). */
    setCloseFriend: (id: string, value: boolean) => dbSetCloseFriend(id, value),
    /** Ids of the current close friends. */
    closeFriendIds: async (): Promise<string[]> => (await dbListCloseFriends()).map((c) => c.id),
    /** Ids of all accepted friends (the "all friends" audience source). */
    friendIds: async (): Promise<string[]> => (await dbListFriends()).map((c) => c.id),

    /** Place a 1:1 call. */
    startCall: (peerId: string, kind: 'audio' | 'video') => startDirectCall(peerId, kind),
    /** Join a group call room (shared roomId across participants). */
    startGroup: (roomId: string, kind: 'audio' | 'video') =>
      startGroupCall(roomId, kind, 'Group call', ''),
    accept: () => acceptCall(),
    reject: () => rejectCall(),
    hangup: () => hangupCall(),
    /** Toggle video: 1:1 audio->video sends a consent request; group is immediate. */
    toggleVideo: () => toggleVideoMode(),
    /** Set the outgoing-video quality tier (auto/medium/low). */
    setVideoQuality: (q: VideoQuality) => setVideoQuality(q),
    /** Whether a 1:1 video-upgrade request is currently prompting us. */
    upgradeRequested: () => upgradeRequest.value,
    /** Accept an incoming 1:1 video-upgrade request. */
    acceptVideoUpgrade: () => acceptUpgrade(),

    /** Call introspection for assertions. */
    callState: () => callState.value,
    callMeta: () => callMeta.value,
    stats: () => callStats.value,
    remoteTracks: () =>
      (remoteStream.value?.getTracks().length ?? 0) +
      remoteStreams.value.reduce((n, s) => n + s.getTracks().length, 0),
    remoteStreamCount: () => remoteStreams.value.length,
    /** Group calls: the ids of the remote streams (one per remote participant). */
    remoteStreamIds: () => remoteStreams.value.map((s) => s.id),
    /** Group calls: the streamId→userId map a tile uses to label each remote feed with
     *  its owner. Keys must match remoteStreamIds (proves the publisher's stream id
     *  survives SFU forwarding - the assumption the tile labelling rests on). */
    groupStreamOwners: () => ({ ...groupStreamOwners.value }),
    /** Group calls: latest per-tile audio RMS (proves the active-speaker metering
     *  reads decoded audio, incl. E2EE remote feeds), and the speaking tile keys. */
    groupAudioLevels: () => groupAudioLevels(),
    activeSpeakers: () => [...activeSpeakers.value],
    remoteVideoTracks: () =>
      (remoteStream.value?.getVideoTracks().length ?? 0) +
      remoteStreams.value.reduce((n, s) => n + s.getVideoTracks().length, 0),
    /** Number of 1:1 video transceivers (1 = healthy; 2 = the duplicate-m-line bug a
     *  re-upgrade after a downgrade used to create, which stranded the live video). */
    videoTransceivers: () => videoTransceiverCount(),
    /** Cumulative inbound video frames decoded: a real media-flow signal, independent
     *  of the receiver track's muted attribute (unreliable in headless Chromium). */
    inboundVideoFrames: () => inboundVideoFrames(),
    localTracks: () => localStream.value?.getTracks().length ?? 0,
  };
  (window as unknown as { __ringTest: typeof api }).__ringTest = api;
}
