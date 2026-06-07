/**
 * Offline-first data model. Everything the app shows lives on-device in
 * IndexedDB; the UI never assumes a network. A future sync layer will write
 * incoming server updates into these same stores (see services/sync.ts).
 *
 * Sync-friendly fields present on every record:
 *  - `id`        stable identifier (also used as the server id later)
 *  - `updatedAt` last local modification (epoch ms), used for merge/ordering
 */

export interface Contact {
  id: string;
  name: string;
  // Immutable network-unique handle from the directory (without the leading '@').
  // Shown alongside the display name as the anti-impersonation anchor; absent for
  // legacy/local-only contacts created before the directory.
  username?: string;
  avatar: string; // data-URL, generated offline
  phone: string;
  about: string;
  // True once the peer's account has been terminated (deleted) server-side. The
  // contact is shown as "Ghosted" (tombstone avatar), past messages stay intact,
  // and sending/forwarding to them is blocked. Detected via POST /v1/status.
  ghosted?: boolean;
  // True while the local user has blocked this peer. Mirrors the server-side block
  // list; the durable source is the `blockedPeers` settings ledger. Drives the
  // read-only/blocked chat UI; inbound from them is dropped, outbound disabled.
  blocked?: boolean;
  updatedAt: number;
}

export interface Chat {
  id: string;
  name: string;
  avatar: string;
  isGroup: boolean;
  participantIds: string[];
  lastMessage: string;
  // Kind of the last message, so the chats list can show an Ionic icon (camera,
  // video, mic, …) instead of an emoji in front of the preview text.
  lastKind?:
    | 'text'
    | 'image'
    | 'video'
    | 'voice'
    | 'file'
    | 'album'
    | 'videonote'
    | 'reaction'
    | 'location'
    | 'poll'
    | 'contact'
    | 'audio';
  lastMessageTime: number; // epoch ms
  unread: number;
  interactions?: number; // messages sent/received, drives "Frequently contacted"
  updatedAt: number;
  // True while a 1:1 chat is an unaccepted friend request, hidden from the
  // chat list until the request is accepted on both sides.
  pending?: boolean;
  // Group only: version (epoch ms) of the last applied roster card, for
  // last-write-wins on membership/name changes.
  rosterAt?: number;
  // Group only: `name` is auto-derived from members (no custom name set), and
  // `avatar` is the default group icon (no custom photo set).
  autoName?: boolean;
  customAvatar?: boolean;
  // Group only: members who've been invited but haven't accepted yet. They are
  // NOT in `participantIds`, so fan-out never reaches them (no pre-join history);
  // an 'accept' card moves them into `participantIds`.
  invitedIds?: string[];
  // 1:1 only: the peer's account was terminated ("Ghosted"). Set so the chat stays
  // read-only (composer/forward disabled) even after the contact is removed from
  // the address book. The conversation is kept; deleting it is the user's choice.
  ghosted?: boolean;
  // Per-chat mute: suppress alerting (OS notification, in-app banner, sound) for this
  // chat until this epoch-ms time. A far-future value means "muted always". Local
  // only (the message still arrives + counts toward the badge); never synced.
  mutedUntil?: number;
  // Disappearing messages: when set, messages SENT in this chat are stamped to
  // self-destruct after this many ms (carried inside the sealed payload, so they
  // disappear for everyone). Kept in sync with the peer via a `ttl` control signal.
  defaultTtlMs?: number;
}

export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'file'
  | 'voice'
  | 'audio'
  | 'location'
  | 'poll'
  | 'contact';

/** Title/artist for a shared audio file (music). Read from the file's tags when
 *  possible, then confirmed/edited by the sender before sending. Cover art and
 *  duration live on the Media record (posterBlob / durationSec). */
export interface AudioMeta {
  title?: string;
  artist?: string;
}

/** A shared geographic point (current location share). Rendered as a map-pin
 *  card that opens the device's maps app externally. */
export interface GeoLocation {
  lat: number;
  lng: number;
  label?: string; // optional place name / coarse address
}

/** One vote on a poll: which option, by whom, when (last-write-wins per user). */
export interface PollVote {
  userId: string; // the voter's Ring user id (self uses getSelfUserId())
  option: number; // index into Poll.options
  at: number; // epoch ms
}

/** A poll carried inside a message; votes mutate in place as vote signals arrive
 *  (same side-effect pattern as reactions), so every participant converges. */
export interface Poll {
  question: string;
  options: string[];
  multi: boolean; // allow selecting more than one option
  votes: PollVote[];
}

/** A Ring contact shared into a chat (from the sender's own contacts); lets the
 *  recipient start a chat with that person without the device address book. */
export interface SharedContact {
  userId: string; // the shared contact's Ring user id
  name: string;
  avatar?: string; // data URL
}

/**
 * Delivery state of an outgoing message (WhatsApp-style).
 *  - compressing: media is being (re-)compressed in the background, not yet sealed
 *  - pending:     sealed + queued for relay, awaiting the server's 'sent' ack
 *  - sent:        the server accepted it (the real "sent" time → sentAt)
 *  - delivered / read: peer receipts
 *  - failed:      the background job failed its retry budget → shows a retry button
 */
export type MessageStatus = 'compressing' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Per-recipient receipt, drives group "Read by" / "Delivered to" info. */
export interface Receipt {
  contactId: string;
  deliveredAt?: number;
  readAt?: number;
}

/** A single user's emoji reaction to a message. One reaction per user (a new
 *  emoji replaces the prior one); `at` resolves out-of-order updates per user. */
export interface Reaction {
  userId: string; // the reactor's Ring user id (self uses getSelfUserId())
  emoji: string;
  at: number; // epoch ms
}

/** A snapshot of the message being replied to, stored on (and sent with) the
 *  reply so the quote renders even if the original is gone. The author name is
 *  resolved per-viewer from `senderId` ("You" for self), so it reads correctly
 *  on both sides. */
export interface ReplyRef {
  id: string; // the quoted message's id (to scroll to it)
  senderId: string; // its author's Ring user id (self uses getSelfUserId())
  preview: string; // short text snapshot (body, or a media label)
  thumb?: string; // small image/video thumbnail (data URL) for the quote
  kind?: MessageKind; // quoted message's kind → drives the quote's media icon
  videoNote?: boolean; // quoted message was a round video note
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string; // 'me' for the local user
  senderName: string;
  body: string; // text, caption, or file/voice label
  kind: MessageKind;
  mediaId?: string; // -> Media store, for image/file/voice
  durationSec?: number; // for voice
  timestamp: number; // epoch ms (when composed; drives ordering)
  outgoing: boolean;
  status: MessageStatus;
  sentAt?: number; // when the server actually accepted it (shown as the send time)
  compressQuality?: 'sd' | 'hd'; // the quality to (re)compress at, drives resume
  jobAttempts?: number; // background-job (compress + seal/upload) failure count
  failReason?: 'too-large'; // why a send failed permanently (drives a specific toast)
  deliveredAt?: number; // 1:1: when the peer's device confirmed delivery
  readAt?: number; // 1:1: when the peer opened/read it
  receipts?: Receipt[]; // group messages only
  reactions?: Reaction[]; // emoji reactions, by user
  replyTo?: ReplyRef; // the message this one is a reply to
  albumId?: string; // media sent together share an id → grouped as an album
  albumName?: string; // optional album title (defaults to the date)
  favorite?: boolean; // starred by the local user
  videoNote?: boolean; // a round, hold-to-record video note (kind === 'video')
  // Sent-media facts shown on the bubble (same on both sides): pixel dimensions
  // and the transmitted (compressed) byte size. Duration is durationSec above.
  mediaWidth?: number;
  mediaHeight?: number;
  mediaSize?: number;
  mediaQuality?: 'sd' | 'hd' | 'original'; // send quality → HD/SD/Original badge
  posterData?: string; // video thumbnail (data URL) sent by the sender → shown
  // before/without downloading the full clip
  // Set on a received media message that hasn't been downloaded yet (auto-download
  // off / deferred): the encrypted reference used to fetch it on demand.
  pendingMedia?: import('@/services/crypto/message').MediaRef;
  mediaCleared?: boolean; // media blob removed locally to free space → shows a
  // "Photo/Video/... removed to free space" placeholder (distinct from `deleted`,
  // the sender deleting the message, and `pendingMedia`, not-yet-downloaded)
  deleted?: boolean; // soft-deleted → shows a "deleted" placeholder
  expiresAt?: number; // disappearing messages: epoch ms when this self-destructs
  location?: GeoLocation; // kind === 'location'
  poll?: Poll; // kind === 'poll'
  contact?: SharedContact; // kind === 'contact'
  audio?: AudioMeta; // kind === 'audio' (shared music file: title/artist)
  updatedAt: number;
}

export interface Call {
  id: string;
  contactId: string;
  name: string;
  avatar: string;
  direction: 'incoming' | 'outgoing';
  missed: boolean;
  video: boolean;
  durationSec?: number; // call length (0/undefined for missed)
  bytes?: number; // total data sent + received over the call (0 for missed)
  seen?: boolean; // a missed call counts toward the badge until seen
  timestamp: number; // epoch ms
  updatedAt: number;
}

/** A friend request. `direction` distinguishes an incoming request (someone
 *  asked to connect, actionable: accept/reject, drives the Contacts badge) from
 *  an outgoing one we sent (informational: shown under "Requested" until they
 *  accept). Absent `direction` is treated as incoming (legacy rows). */
export interface FriendRequest {
  id: string;
  name: string;
  avatar: string;
  phone?: string;
  createdAt: number;
  status: 'pending' | 'accepted' | 'rejected';
  direction?: 'incoming' | 'outgoing';
  // 'group-invite' rows reuse this store to drive the Contacts "Invitations" list.
  // Absent (or 'friend') = a 1:1 friend request. Group invites set:
  //  - id = `ginv:<groupId>` (unique; coalesces duplicate invites to one row)
  //  - groupId / inviter / memberPreview for the invitation card
  //  - roster: the snapshot to build the group chat from on accept
  kind?: 'friend' | 'group-invite';
  groupId?: string;
  inviter?: string;
  memberPreview?: string;
  roster?: import('@/services/crypto/message').GroupMember[];
}

/** A "needs attention" item in the You tab, drives its badge. */
export interface Alert {
  id: string;
  section: 'account' | 'privacy' | 'notifications' | 'storage';
  title: string;
  body: string;
  resolved: boolean;
  createdAt: number;
}

/** Binary media/files kept on-device as Blobs. */
export interface Media {
  id: string;
  kind: 'image' | 'video' | 'file' | 'voice' | 'audio';
  mime: string;
  name: string;
  size: number;
  blob: Blob;
  posterBlob?: Blob; // video thumbnail
  durationSec?: number; // audio/video length
  updatedAt: number;
}

export interface Setting<T = unknown> {
  key: string;
  value: T;
}
