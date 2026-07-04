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
import { syncDirectory, importDirectoryUser, searchDirectory, publishOwnProfile, refetchContactProfile } from '@/services/directory';
import { previewPending } from '@/services/sw-inbox';
import { drainPersistPending, ackFrames } from '@/services/sw-drain';
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
  archiveAllChats as dbArchiveAllChats,
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
  getMedia as dbGetMedia,
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
  listCallGroups as dbListCallGroups,
  countUnread as dbCountUnread,
  setContactLocalProfile as dbSetContactLocalProfile,
  resetContactToRemote as dbResetContactToRemote,
  adoptContactProfile as dbAdoptContactProfile,
} from '@/db/queries';
import {
  enableHiddenPin as hcEnablePin,
  addHidden as hcAdd,
  removeHidden as hcRemove,
  getHiddenSet as hcGetSet,
} from '@/services/hidden-chats';
import { setCallCapsForTest } from '@/services/call/types';
import { startHiddenChat as hcStartChat } from '@/services/hidden-chats-start';
import { resetHiddenChats as hcReset } from '@/services/hidden-chats-reset';
import { canHide, canUnhide } from '@/services/hidden-pair';
import { hiddenIdsSync } from '@/services/hidden-state';
import { revealWithPin as hcReveal, relockHidden as hcRelock } from '@/composables/useHiddenChats';
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
import { notifyBanners, showActionBanner } from '@/services/notify';
import { recoverInterruptedPosts } from '@/services/pending-posts';
import { recordCues, recordedCues } from '@/services/sound';
import { syncContactEdges } from '@/services/directory';
import { audioTrack, audioCurId, audioPlaying } from '@/composables/useAudioPlayer';
import appRouter from '@/router';
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
import { initialsAvatar } from '@/db/avatars';
import { uid } from '@/utils/uid';
import { seedShowcase as runSeedShowcase } from '@/services/showcase-seed';
import type { Call, Chat, FriendRequest, Media, Message, Post, OutboxPost } from '@/db/types';
import {
  startDirectCall,
  startGroupCall,
  addPeople,
  mergeIncoming,
  callRemainingSlots,
  acceptCall,
  rejectCall,
  hangupCall,
  toggleMute,
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
  groupCallDiag,
  recallMember,
  cancelInvite,
  notJoining,
  busyMembers,
  activeSpeakers,
  localStream,
  callStats,
  videoTransceiverCount,
  inboundVideoFrames,
  acceptAndHold,
  swapCalls,
  endActive,
  endHeld,
  rejectSecond,
  canHoldIncoming,
  heldCall,
  remoteHeld,
  groupHeldPeers,
  resumeCountdown,
  peerResumeCountdown,
  remoteQueued,
  incomingSecond,
  recordConnect,
  connectMarksSnapshot,
  joinCuesShown,
  mergeGroupInvite,
  setGroupIdleMsForTest,
} from '@/composables/useCall';

/**
 * Mint a real, decodable H.264 mp4 entirely in-browser (WebCodecs + mp4-muxer, both
 * already app deps) for the spec-2007 video-quality tests. Frames carry moving
 * high-frequency detail so the encoder is bitrate-bound, not trivially compressible —
 * that way re-encoding to a lower resolution/bitrate yields a genuinely smaller file
 * and SD < HD < Original sizes are stable. Avoids a committed binary fixture and the
 * need for host ffmpeg. Throws if the browser can't encode H.264 (caller falls back).
 */
async function makeTestVideo(w: number, h: number, seconds: number, bitrate = 12_000_000, fps = 30): Promise<Blob> {
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    fastStart: 'in-memory',
    video: { codec: 'avc', width: w, height: h },
  });
  // Level must cover the resolution: High@5.1 / Main@4.0 handle up to 4K / 1080p; pick
  // the first VideoEncoder accepts for this size (High@5.1 first so 2160p is encodable).
  const candidates = ['avc1.640033', 'avc1.4d0028', 'avc1.42e028', 'avc1.640028', 'avc1.42001f'];
  let codec = '';
  for (const c of candidates) {
    const cfg = { codec: c, width: w, height: h, bitrate, framerate: fps };
    const sup = (VideoEncoder as unknown as { isConfigSupported?: (x: unknown) => Promise<{ supported?: boolean }> }).isConfigSupported;
    if (!sup || (await sup(cfg)).supported) { codec = c; break; }
  }
  if (!codec) throw new Error('no H.264 encoder available to mint a test video');

  const errs: unknown[] = [];
  const encoder = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => errs.push(e) });
  encoder.configure({ codec, width: w, height: h, bitrate, framerate: fps });

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const total = Math.max(1, Math.round(seconds * fps));
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = `hsl(${(i * 9) % 360}, 70%, 45%)`;
    ctx.fillRect(0, 0, w, h);
    // ~200 moving tiles of varied colour → high-frequency detail the codec must spend bits on.
    for (let k = 0; k < 200; k++) {
      ctx.fillStyle = `hsl(${(i * 13 + k * 31) % 360}, 90%, ${30 + ((k * 7) % 50)}%)`;
      const x = (i * 17 + k * 53) % w;
      const y = (i * 23 + k * 97) % h;
      ctx.fillRect(x, y, w / 20, h / 20);
    }
    const frame = new VideoFrame(canvas, { timestamp: (i / fps) * 1e6, duration: (1 / fps) * 1e6 });
    encoder.encode(frame, { keyFrame: i % 30 === 0 });
    frame.close();
  }
  await encoder.flush();
  muxer.finalize();
  if (errs.length) throw errs[0];
  return new Blob([(muxer.target as InstanceType<typeof ArrayBufferTarget>).buffer], { type: 'video/mp4' });
}

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
    /** Spec 1032: the SW AUTHORITATIVE drain (sw.fullPersist) — decrypt + persist +
     *  ack eligible queued frames, exactly the module the push handler runs. Returns
     *  the drain result plus whether the ack landed, so e2e can assert commit-before-
     *  ack, exactly-once, and every degrade reason. Enable with
     *  `setSetting('sw.fullPersist', true)` and `disconnect()` first. */
    drainPending: async () => {
      const r = await drainPersistPending();
      const ackOk = r.mode === 'applied' ? await ackFrames(r.ackIds) : false;
      return { ...r, ackOk };
    },
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
    /** Surface a sample app-update "action" banner (spec 2004) for visual checks — the
     *  same shared overlay the real update prompt uses, via the app's notify instance. */
    showUpdateBanner: (body = 'Ring 0.3.0 is ready to install.', whatsNewCount = 3): void =>
      showActionBanner({
        name: 'Update available',
        body,
        actions: [
          ...(whatsNewCount > 0 ? [{ text: `What's new (${whatsNewCount})`, handler: () => {} }] : []),
          { text: 'Update', handler: () => {} },
          { text: 'Later' as const, role: 'cancel' as const, handler: () => {} },
        ],
      }),
    /** Ids of current (non-pending) contacts. */
    contactIds: async (): Promise<string[]> => (await listContacts()).map((c) => c.id),
    /** Set a known contact's display name (the name you'd have saved locally). */
    setContactName: (id: string, name: string) => dbSetContactLocalProfile(id, { name }),

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
    // Send with a per-message disappearing override (exercises the composer-timer plumbing).
    sendChatMessageTtl: (chatId: string, body: string, ttlMs: number | null) =>
      dbSendMessage(chatId, body, undefined, undefined, undefined, ttlMs),
    /** Send a group message that @mentions the given member ids (spec 1020). */
    sendWithMentions: (chatId: string, body: string, mentions: string[], everyone = false) =>
      dbSendMessage(chatId, body, undefined, mentions, everyone),
    /** A chat's unread-MENTIONS count (separate from unread). */
    unreadMentions: async (chatId: string): Promise<number> => (await dbGetChat(chatId))?.unreadMentions ?? 0,
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
    /** ALL conversation ids with a peer — plain 1:1s AND pair conversations —
     *  for the spec-1027 per-person invariant asserts (no duplicate threads). */
    chatsWith: async (peerId: string): Promise<{ id: string; isGroup: boolean }[]> => {
      const all = await getAll<{ id: string; isGroup: boolean; participantIds: string[] }>('chats');
      return all
        .filter((c) => c.participantIds.length === 1 && c.participantIds[0] === peerId)
        .map((c) => ({ id: c.id, isGroup: c.isGroup }));
    },
    /** The VISIBLE (non-pending) 1:1 chat id for a peer, or '' if hidden/none. */
    visibleChatWith: async (peerId: string): Promise<string> =>
      (await listChats()).find((c) => !c.isGroup && c.participantIds[0] === peerId)?.id ?? '',

    /* ---- hidden chats (spec 1019) ---- */
    /** Set/replace the dedicated Hidden Chats PIN. */
    hiddenSetPin: (pin: string) => hcEnablePin(pin),
    /** Hide / unhide a conversation by id. */
    hiddenAdd: (chatId: string) => hcAdd(chatId),
    hiddenRemove: (chatId: string) => hcRemove(chatId),
    /** The hidden-set ids on this device. */
    hiddenIds: async (): Promise<string[]> => [...(await hcGetSet())],
    /** Start a distinct hidden chat with a contact; returns the new chat id. */
    hiddenStartChat: (contactId: string) => hcStartChat(contactId),
    /** The per-person pair-invariant verdicts the actions sheet uses (spec 1027). */
    hiddenCanHide: async (chatId: string) =>
      canHide(await getAll<Chat>('chats'), hiddenIdsSync(), chatId),
    hiddenCanUnhide: async (chatId: string) =>
      canUnhide(await getAll<Chat>('chats'), hiddenIdsSync(), chatId),
    /** The Calls-tab rows' contact ids (what listCallGroups shows) — for the
     *  spec-1027 knock-knock asserts: hidden peers never appear while relocked. */
    callHistoryContactIds: async (): Promise<string[]> =>
      (await dbListCallGroups()).map((g) => g.contactId),
    /** Reveal (verify PIN → start session). Returns whether the PIN was correct. */
    hiddenReveal: (pin: string) => hcReveal(pin),
    /** End the reveal session. */
    hiddenRelock: () => {
      hcRelock();
    },
    /** Reset: wipe hidden chats locally + block re-sync. Returns the wiped ids. */
    hiddenReset: () => hcReset(),
    /** Visible chat ids right now (what `listChats` returns) — for exclusion asserts. */
    visibleChatIds: async (): Promise<string[]> => (await listChats()).map((c) => c.id),
    /** The unread badge total (countUnread) — for hidden-chat badge-mode asserts. */
    unreadBadge: (): Promise<number> => dbCountUnread(),

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
        expiresAt: m.expiresAt ?? null, // disappearing messages: when this self-destructs
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
      // The on-device stored copy's byte size (spec 2007): after a compressed send the
      // sender keeps the SENT (smaller) blob, not the full original, so storedBytes
      // should equal mediaSize.
      const media = m?.mediaId ? await get<Media>('media', m.mediaId) : undefined;
      return {
        hasMedia: !!m?.mediaId,
        pending: !!m?.pendingMedia,
        sentBlobId: m?.sentBlobId ?? null,
        // spec 2007: the ACHIEVED quality + the transmitted facts, so tests can assert
        // the badge never claims a tier the bytes aren't, and that HD/SD really shrink.
        status: m?.status ?? null,
        mediaQuality: m?.mediaQuality ?? null,
        mediaSize: m?.mediaSize ?? null,
        mediaWidth: m?.mediaWidth ?? null,
        mediaHeight: m?.mediaHeight ?? null,
        storedBytes: media?.size ?? null,
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
    /** Pin a fake "now playing" track on the global player (no real audio element), so
     *  tests can exercise the hovering controller (spec 1007) — including its hide-while-
     *  in-the-owning-chat behavior — without a decodable blob that would 'end' instantly.
     *  Pass the owning chatId so the controller hides while that chat is on screen. */
    playAudioTest: (chatId: string, title = 'Demo Track'): void => {
      audioCurId.value = `test-audio:${chatId}`;
      audioTrack.value = { id: `test-audio:${chatId}`, url: '', title, subtitle: 'Ring', isVoice: false, chatId };
      audioPlaying.value = true;
    },
    /** SPA navigation via the app router (preserves in-memory state, unlike a full
     *  page reload) — e.g. to leave a chat without tearing down the global audio. */
    navigate: (path: string): Promise<unknown> => appRouter.push(path),
    /** Send a round video-note ("video message"). */
    sendVideoNote: (chatId: string, name: string) =>
      dbSendMediaMessage(chatId, 'video', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/mp4' }), name, 8, {
        videoNote: true,
      }),
    /** Send a photo/video at a quality → exercises the background compression job. */
    sendMediaQuality: (chatId: string, kind: 'image' | 'video', name: string, quality: 'sd' | 'hd' | 'fhd' | 'original') =>
      dbSendMediaMessage(
        chatId,
        kind,
        new Blob([new Uint8Array([1, 2, 3, 4])], { type: kind === 'image' ? 'image/png' : 'video/mp4' }),
        name,
        undefined,
        { quality },
      ),
    /** Generate a REAL, decodable H.264 mp4 of the given pixel size + duration (animated
     *  high-frequency content so re-encoding to a smaller resolution genuinely shrinks the
     *  bytes) and send it at the chosen quality. Drives the real transcode end-to-end
     *  without a committed binary fixture (spec 2007). Returns the source byte size. */
    sendRealVideoQuality: async (
      chatId: string,
      quality: 'sd' | 'hd' | 'fhd' | 'original',
      w = 1920,
      h = 1080,
      seconds = 2,
      bitrate = 12_000_000,
      name = 'clip.mp4',
    ): Promise<{ messageId: string; sourceSize: number }> => {
      const blob = await makeTestVideo(w, h, seconds, bitrate);
      const messageId = await dbSendMediaMessage(chatId, 'video', blob, name, seconds, { quality });
      return { messageId, sourceSize: blob.size };
    },
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
    /** Send a raw image (base64 bytes + MIME) through the real send pipeline — used to
     *  exercise GIF / animated-WebP handling, which the canvas helpers above can't make.
     *  Pass a non-'original' quality to prove animated formats survive compression. */
    sendImageData: async (
      chatId: string,
      base64: string,
      mime: string,
      name: string,
      quality: 'sd' | 'hd' | 'fhd' | 'original' = 'hd',
    ): Promise<void> => {
      const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      const blob = new Blob([bytes], { type: mime });
      await dbSendMediaMessage(chatId, 'image', blob, name, undefined, { quality });
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
    archiveAllChats: () => dbArchiveAllChats(),
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
    /** Set a LOCAL name/avatar override for a contact. */
    setContactLocalProfile: (id: string, name?: string, avatar?: string) => dbSetContactLocalProfile(id, { name, avatar }),
    /** Reset a contact to the peer's CURRENT name/photo (revert + re-pull from directory). */
    resetContactProfile: async (id: string): Promise<void> => {
      await dbResetContactToRemote(id);
      await refetchContactProfile(id);
    },
    /** Adopt a staged remote name/avatar change. */
    adoptContactProfile: (id: string) => dbAdoptContactProfile(id),
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

    /** Spec 1025 (US6): seed a completed call-log record so the Calls tab can be checked (ISO
     *  dates, usage totals). Dev-only. */
    seedCall: async (opts: { video: boolean; durationSec: number; bytes?: number; ts: number; contactId?: string }): Promise<void> => {
      await put<Call>('calls', {
        id: uid(),
        contactId: opts.contactId ?? 'seed-peer',
        name: 'Seed Peer',
        avatar: initialsAvatar('Seed Peer'),
        direction: 'outgoing',
        missed: false,
        video: opts.video,
        durationSec: opts.durationSec,
        bytes: opts.bytes,
        timestamp: opts.ts,
        updatedAt: opts.ts,
      });
    },

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

    /** Bulk-seed `n` plain 1:1 chats (one bulkPut) so the chat list is long enough to
     *  scroll behind the tab bar — for visual/layout checks. Dev-only. */
    seedManyChats: async (n: number): Promise<void> => {
      const now = Date.now();
      const chats: Chat[] = [];
      for (let i = 0; i < n; i++) {
        const id = `fake-${i}`;
        const name = `Fake Chat ${i + 1}`;
        chats.push({
          id,
          name,
          avatar: initialsAvatar(name),
          isGroup: false,
          participantIds: [id],
          lastMessage: `Preview of conversation ${i + 1}`,
          lastKind: 'text',
          lastMessageTime: now - i * 60_000,
          unread: 0,
          updatedAt: now - i * 60_000,
        });
      }
      await bulkPut<Chat>('chats', chats);
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
    /** Spec 1024 (US2): seed a FAILED pending post straight into the outbox so the Wall renders the
     *  "Couldn't post" card with Retry/Cancel. Text-only (no cached blobs needed for the UI check). */
    seedFailedPendingPost: async (body = 'Stuck post'): Promise<string> => {
      const now = Date.now();
      const id = `pp-${now}`;
      await put<OutboxPost>('pendingPosts', {
        id,
        target: 'wall',
        body,
        audience: 'friends',
        lifetime: '72h',
        items: [],
        status: 'failed',
        error: 'Upload failed. Tap Retry to try again.',
        attempts: 1,
        createdLocally: now,
        updatedAt: now,
      });
      return id;
    },
    /** Count outbox records (any status) — lets a test assert a Cancel actually cleared one. */
    pendingPostCount: async (): Promise<number> => (await getAll<OutboxPost>('pendingPosts')).length,
    /** Run (and await) cold-start recovery — lets a test order itself AFTER recovery so a freshly
     *  seeded in-session failure isn't swept into a draft by the once-per-load recovery pass. */
    recoverPending: () => recoverInterruptedPosts(),
    /** Spec 1024 (US2): seed an INTERRUPTED draft (app closed mid-post) with a caption + a voice note,
     *  so the Wall renders the "Post didn't finish" card and Finish restores it in the composer. */
    seedInterruptedPost: async (body = 'Recovered draft', withVoice = true): Promise<string> => {
      const now = Date.now();
      const id = `pp-int-${now}`;
      await put<OutboxPost>('pendingPosts', {
        id,
        target: 'wall',
        body,
        audience: 'friends',
        lifetime: '72h',
        // A photo (inline bytes) plus, optionally, a voice clip — so a test can confirm both survive
        // the restart and come back staged in the composer.
        items: [
          {
            localId: `img-${now}`,
            bytes: Uint8Array.from(
              atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
              (c) => c.charCodeAt(0),
            ).buffer,
            kind: 'image',
            name: 'photo.png',
            mime: 'image/png',
            progress: 0,
          },
          ...(withVoice
            ? [{
                localId: `v-${now}`,
                bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer,
                kind: 'voice' as const,
                name: 'voice.webm',
                mime: 'audio/webm',
                durationSec: 3,
                progress: 0,
              }]
            : []),
        ],
        status: 'interrupted',
        attempts: 0,
        createdLocally: now,
        updatedAt: now,
      });
      return id;
    },
    /** Seed one own IMAGE post that has ONLY a poster tier and no full blob — i.e. a
     *  received post whose full media hasn't downloaded yet. The feed must still show the
     *  poster instantly (US1: no blank tile), which is what the thumbnail test asserts. */
    seedWallPosterOnlyImage: async (): Promise<string> => {
      const self = getSelfUserId() ?? 'me';
      const now = Date.now();
      const png = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
        (c) => c.charCodeAt(0),
      );
      const mediaId = `imgseed-${now}`;
      const postId = `postimg-${now}`;
      await put<Media>('media', {
        id: mediaId,
        kind: 'image',
        mime: 'image/png',
        name: 'photo.png',
        size: 0, // full blob freed/not-downloaded
        posterBlob: new Blob([png], { type: 'image/png' }), // the only tier we have locally
        updatedAt: now,
      });
      await put<Post>('posts', {
        id: postId,
        author: self,
        kind: 'image',
        mediaId,
        mediaW: 1,
        mediaH: 1,
        audience: 'friends',
        createdAt: now,
        outgoing: true,
        updatedAt: now,
      });
      return postId;
    },
    /** Seed `n` own VIDEO posts straight into IndexedDB (no real encrypt/transcode), so the
     *  Wall feed renders `n` tall <video> cards for the autoplay-on-visible test. The stub
     *  bytes don't decode, but the autoplay directive observes the element regardless, so the
     *  visibility coordination is exercised deterministically + instantly. Newest first. */
    seedWallVideoPosts: async (n: number): Promise<string[]> => {
      const self = getSelfUserId() ?? 'me';
      const now = Date.now();
      const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]); // ftyp/isom-ish
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const mediaId = `vidseed-${now}-${i}`;
        const postId = `postseed-${now}-${i}`;
        await put<Media>('media', {
          id: mediaId,
          kind: 'video',
          mime: 'video/mp4',
          name: `clip-${i}.mp4`,
          size: bytes.length,
          blob: new Blob([bytes], { type: 'video/mp4' }),
          updatedAt: now,
        });
        await put<Post>('posts', {
          id: postId,
          author: self,
          kind: 'video',
          mediaId,
          mediaW: 720,
          mediaH: 1280, // portrait → each card fills the viewport, so one plays at a time
          audience: 'friends',
          createdAt: now - i * 1000, // index 0 newest (top of feed)
          outgoing: true,
          updatedAt: now,
        });
        ids.push(postId);
      }
      return ids;
    },
    /** Compose + share an ALBUM post of `n` tiny images through the REAL createPost path
     *  (compress → seal N refs → upload → register), so e2e exercises album round-trip. */
    postAlbum: async (n: number, body?: string): Promise<string> => {
      const png = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
        (c) => c.charCodeAt(0),
      );
      const media = Array.from({ length: n }, (_, i) => ({
        blob: new Blob([png], { type: 'image/png' }),
        kind: 'image' as const,
        name: `album-${i}.png`,
      }));
      const p = await dbCreatePost({ body, audience: 'friends', lifetime: '24h', media });
      return p.id;
    },
    /** Share an album of MIXED aspect ratios (portrait, square, landscape) so the gallery's
     *  fixed-frame + blurred-fill presentation can be checked visually. */
    postMixedAlbum: async (): Promise<string> => {
      const make = async (w: number, h: number, color: string, label: string): Promise<Blob> => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        // A thick white border on all four edges: if the whole image is shown (contain) the
        // border is fully visible; if it's cover-cropped, the top/bottom (or sides) are cut off.
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.round(Math.min(w, h) / 12);
        ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = `${Math.round(Math.min(w, h) / 7)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, w / 2, h / 2);
        return await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
      };
      const media = [
        { blob: await make(600, 800, '#3b82f6', 'PORTRAIT'), kind: 'image' as const, name: 'p.png' },
        { blob: await make(800, 800, '#10b981', 'SQUARE'), kind: 'image' as const, name: 's.png' },
        { blob: await make(1280, 720, '#f59e0b', 'LANDSCAPE'), kind: 'image' as const, name: 'l.png' },
      ];
      const p = await dbCreatePost({ audience: 'friends', lifetime: '24h', media });
      return p.id;
    },
    /** Share a post with a REAL (decodable) H.264 video, through the actual createPost path —
     *  so we can verify the video post gets a poster thumbnail and autoplays in the feed. */
    postVideo: async (): Promise<string> => {
      const blob = await makeTestVideo(640, 360, 2);
      const p = await dbCreatePost({
        audience: 'friends',
        lifetime: '24h',
        media: { blob, kind: 'video', name: 'clip.mp4' },
      });
      return p.id;
    },
    /** Post an album of 2 real videos + 2 images through createPost, timing each progress
     *  phase, to reproduce the "stuck while processing" report. Returns elapsed ms + last
     *  progress seen (so a hang shows up as a never-resolving promise / frozen last phase). */
    postVideoAlbumTimed: async (): Promise<{ ms: number; id: string }> => {
      const png = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
        (c) => c.charCodeAt(0),
      );
      const v1 = await makeTestVideo(480, 360, 1);
      const v2 = await makeTestVideo(480, 360, 1);
      const media = [
        { blob: v1, kind: 'video' as const, name: 'a.mp4' },
        { blob: v2, kind: 'video' as const, name: 'b.mp4' },
        { blob: new Blob([png], { type: 'image/png' }), kind: 'image' as const, name: 'c.png' },
        { blob: new Blob([png], { type: 'image/png' }), kind: 'image' as const, name: 'd.png' },
      ];
      const t0 = performance.now();
      const p = await dbCreatePost({
        audience: 'friends',
        lifetime: '24h',
        media,
        onProgress: (pr) => console.log('[post-progress]', pr.phase, pr.index + 1, '/', pr.total, Math.round(pr.value * 100) + '%'),
      });
      return { ms: Math.round(performance.now() - t0), id: p.id };
    },
    /** Does a post's cover Media have a poster thumbnail stored? (sender-side thumbnail check) */
    postHasPoster: async (id: string): Promise<boolean> => {
      const p = await dbGetPost(id);
      const md = p?.mediaId ? await dbGetMedia(p.mediaId) : null;
      return !!(md?.posterBlob || md?.posterGrid);
    },
    /** The latest own post's cover media as base64 + mime — to inspect what was actually
     *  stored (e.g. ffprobe the transcoded video off-device to check the audio track). */
    lastPostMediaB64: async (): Promise<{ b64: string; mime: string; bytes: number } | null> => {
      const posts = await dbListWallPosts();
      const self = getSelfUserId() ?? '';
      const own = posts.find((p) => p.author === self && p.mediaId);
      const md = own?.mediaId ? await dbGetMedia(own.mediaId) : null;
      if (!md?.blob) return null;
      const buf = new Uint8Array(await md.blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
      return { b64: btoa(s), mime: md.mime, bytes: buf.length };
    },
    /** How many media a post carries locally (album size; 1 for single; 0 for text). */
    postMediaCount: async (id: string): Promise<number> => {
      const p = await dbGetPost(id);
      return p?.mediaIds?.length ?? (p?.mediaId ? 1 : 0);
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
    /** Join a group call room (shared roomId across participants). With `members`, act as the
     *  INITIATOR — ring those members (so they get an incoming invite to accept); without,
     *  just join an existing room. */
    startGroup: (roomId: string, kind: 'audio' | 'video', members: string[] = []) =>
      startGroupCall(roomId, kind, 'Group call', '', members),
    accept: () => acceptCall(),
    reject: () => rejectCall(),
    hangup: () => hangupCall(),
    /** Add people to the ACTIVE call (spec 1028, US2): promote a 1:1 if needed, ring them in. */
    addPeople: (ids: string[]) => addPeople(ids),
    /** Merge the pending second incoming DIRECT caller into the current call (spec 1028, US1). */
    mergeIncoming: () => mergeIncoming(),
    /** Fold the pending second incoming GROUP INVITE into the current call (spec 1030, US3). */
    mergeGroupInvite: () => mergeGroupInvite(),
    /** The userIds announced as "{name} joined the call" this call (spec 1030, US2). */
    joinCues: () => joinCuesShown(),
    /** Free participant slots left in the active call (for cap-gate asserts). */
    callRemainingSlots: () => callRemainingSlots(),
    /** Dev/e2e: shrink the CLIENT caps so the pre-emptive add gate can be tested
     *  without a real 8-person call (mirrors the server's call-config override). */
    setCallCaps: (video?: number, audio?: number) => setCallCapsForTest(video, audio),
    /** Dev/e2e: shrink the lone-in-the-room timeout so the promotion-timeout path
     *  (spec 1030, US5) runs in seconds instead of 60s. */
    setGroupIdleMs: (ms: number) => setGroupIdleMsForTest(ms),
    /** The active call's roster (who's actually in the room) + invited (ringing). */
    callRoster: () => callMeta.value?.roster ?? [],
    callInvited: () => callMeta.value?.invited ?? [],
    /** Toggle the mic (drives the mute/unmute cues). */
    toggleMute: () => toggleMute(),
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
    /** Group calls: total inbound video frames decoded across ALL mesh legs + each leg's
     *  adaptive tier. inboundVideoFrames() is 1:1-only (reads `pc`); this sees the mesh. */
    groupCallDiag: () => groupCallDiag(),
    /** Call-cue recording (spec 0004 US5): start/stop capturing which audio cues fire, and
     *  read them back, so a test can assert cues across state transitions + the "Call sounds"
     *  silence gate. A recorded cue means it passed the gate + de-dup and would have played. */
    recordCues: (on: boolean) => recordCues(on),
    cuesFired: () => recordedCues(),
    // Connect-milestone instrumentation (spec 2008): toggle recording, then read the current
    // call's timestamps to assert the connect ordering/overlap invariants + time-to-first-media.
    recordConnect: (on: boolean) => recordConnect(on),
    connectMarks: () => connectMarksSnapshot(),
    /** Group calls (caller side): re-ring / remove a not-yet-joined invitee, and read the
     *  per-invitee tile state (no-answer set + busy set) for asserting recall behaviour. */
    recall: (memberId: string) => recallMember(memberId),
    removeInvitee: (memberId: string) => cancelInvite(memberId),
    /** Call waiting (spec 0005): accept the pending second incoming call, holding the
     *  current one; introspection for the held call + on-hold state. */
    acceptAndHold: () => acceptAndHold(),
    swapCalls: () => swapCalls(),
    endActive: () => endActive(),
    endHeld: () => endHeld(),
    rejectSecond: () => rejectSecond(),
    canHoldIncoming: () => canHoldIncoming(),
    hasSecondIncoming: () => incomingSecond.value != null,
    heldCallId: () => heldCall.value?.callId ?? null,
    isRemoteHeld: () => remoteHeld.value,
    groupHeldPeers: () => [...groupHeldPeers.value],
    resumeCountdown: () => resumeCountdown.value,
    peerResumeCountdown: () => peerResumeCountdown.value,
    isRemoteQueued: () => remoteQueued.value,
    notJoiningIds: () => [...notJoining.value],
    busyMemberIds: () => [...busyMembers.value],
    invitedIds: () => callMeta.value?.invited ?? [],
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
    /** Local VIDEO tracks only — asserts the no-auto-camera invariant (spec 1030, US1). */
    localVideoTracks: () => localStream.value?.getVideoTracks().length ?? 0,
  };
  (window as unknown as { __ringTest: typeof api }).__ringTest = api;
}
