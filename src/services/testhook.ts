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
import { disconnectTransport, nudgeReconnect } from '@/composables/useSync';
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
  reactToMessage as dbReactToMessage,
  getMessage as dbGetMessage,
  sendLocation as dbSendLocation,
  sendPoll as dbSendPoll,
  sendContact as dbSendContact,
  votePoll as dbVotePoll,
  sendMediaMessage as dbSendMediaMessage,
  setChatTtl as dbSetChatTtl,
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
  deleteMediaByKind as dbDeleteMediaByKind,
  deleteMediaLargerThan as dbDeleteMediaLargerThan,
  listMessages,
  listChats,
} from '@/db/queries';
import {
  createInvitation, deleteAccount, fetchPeerBundle,
  connectRequest as apiConnectRequest, connectAccept as apiConnectAccept,
  connectReject as apiConnectReject, listConnections as apiListConnections,
  connectLink as apiConnectLink,
} from '@/services/api';
import { runInviteSync } from '@/services/invites';
import { syncContactEdges } from '@/services/directory';
import { subscribePresence } from '@/composables/useSync';
import { peerPresence } from '@/composables/usePresence';
import { setSecret } from '@/db/secrets';
import { getAll, put } from '@/db/idb';
import { uid } from '@/utils/uid';
import type { FriendRequest, Media, Message } from '@/db/types';
import {
  startDirectCall,
  startGroupCall,
  acceptCall,
  rejectCall,
  hangupCall,
  toggleVideoMode,
  acceptUpgrade,
  upgradeRequest,
  callState,
  callMeta,
  remoteStream,
  remoteStreams,
  groupStreamOwners,
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
    /** Drop the WebSocket so the server queues messages (simulate app closed). */
    disconnect: () => disconnectTransport(),
    /** Reconnect the WebSocket (drains the queue for real). */
    reconnect: () => nudgeReconnect(),
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
    /** Ids of current (non-pending) contacts. */
    contactIds: async (): Promise<string[]> => (await listContacts()).map((c) => c.id),
    /** Set a known contact's display name (the name you'd have saved locally). */
    setContactName: (id: string, name: string) => dbUpdateContactProfile(id, name, ''),

    /* ---- group chat ---- */
    createGroup: (name: string, memberIds: string[]) => dbCreateGroup(name, memberIds),
    addToGroup: (chatId: string, memberId: string) => dbAddToGroup(chatId, memberId),
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
    setChatTtl: (chatId: string, ms: number | null) => dbSetChatTtl(chatId, ms),
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
        senderId: m.senderId,
        outgoing: m.outgoing,
        reactions: m.reactions ?? [],
        replyTo: m.replyTo ?? null,
        albumId: m.albumId ?? null,
        location: m.location ?? null,
        poll: m.poll ?? null,
        contact: m.contact ?? null,
        audio: m.audio ?? null,
      })),
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
    /** Add/toggle the local user's emoji reaction on a message. */
    reactToMessage: (messageId: string, emoji: string) => dbReactToMessage(messageId, emoji),

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
    /** Total on-device media bytes by kind. */
    storageByType: () => dbStorageByType(),
    deleteMediaByKind: (kinds: Media['kind'][], chatId?: string) => dbDeleteMediaByKind(kinds, chatId),
    deleteMediaLargerThan: (bytes: number, chatId?: string) => dbDeleteMediaLargerThan(bytes, chatId),
    /** Server-side directory search → [{id, username, displayName}]. */
    connectRequest: (target: string) => apiConnectRequest(target),
    connectLink: (target: string) => apiConnectLink(target),
    connectAccept: (requester: string) => apiConnectAccept(requester),
    connectReject: (requester: string, block: boolean) => apiConnectReject(requester, block),
    connections: () => apiListConnections(),
    searchDirectory: async (q: string) =>
      (await searchDirectory(q)).map((u) => ({ id: u.id, username: u.username, displayName: u.displayName })),

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
