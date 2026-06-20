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
    | 'audio'
    | 'call';
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
  // ---- Per-chat notification controls (spec 1015). Device-local like mutedUntil:
  // they ride in the encrypted own-data sync blob (sealed under the master key) but
  // NEVER reach the server in plaintext, and enforcement is entirely client-side.
  // Absent = default (the pre-1015 behaviour), so existing chats are unchanged. ----
  // Web push for this chat: when false, suppress the system/web-push notification
  // (and, per FR-022a, the chat's call rings) while the app is closed. The badge
  // still updates. Default: true.
  notifyWebPush?: boolean;
  // In-app banner for this chat: when false, suppress the in-app banner while the
  // app is open (independent of the global in-app master switch). Default: true.
  notifyInApp?: boolean;
  // How much a notification for this chat reveals: 'full' = decrypted sender+text,
  // 'generic' = a content-free placeholder ("New message"), 'none' = badge-only
  // (no banner / system text anywhere). Default: 'full'.
  notifyContent?: 'full' | 'generic' | 'none';
  // Disappearing messages: when set, messages SENT in this chat are stamped to
  // self-destruct after this many ms (carried inside the sealed payload, so they
  // disappear for everyone). Kept in sync with the peer via a `ttl` control signal.
  defaultTtlMs?: number;
  // ---- Chats-tab organisation (all synced via own-data sync, LWW on updatedAt) ----
  // Marked a Favorite (drives the Favorites filter chip).
  favorite?: boolean;
  // Pinned to the top of the chat list (sorted before unpinned, capped per device).
  pinned?: boolean;
  // Archived: hidden from the main list into the Archived view.
  archived?: boolean;
  // Locked: hidden from the main list behind the app's auth gate (Locked chats).
  locked?: boolean;
  // Manually marked unread by the user (when there were no unread messages). Shows
  // the unread affordance and matches the Unread filter; cleared when the chat is
  // opened or a message is sent.
  manualUnread?: boolean;
}

/** A user-defined chat filter list (e.g. "Stockholmian"): a named set of chats.
 *  Synced via own-data sync (in ownsync SYNCED), LWW on updatedAt; membership is
 *  filtered to still-existing chats at read time. */
export interface ChatList {
  id: string;
  name: string;
  chatIds: string[];
  updatedAt: number;
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
  | 'contact'
  // A local-only, centered informational row logging a call's outcome (never sent to
  // the peer; each side logs its own). The `call` field carries the details.
  | 'call';

/** Call-log details carried on a kind === 'call' informational message row. */
export interface CallLog {
  direction: 'incoming' | 'outgoing';
  video: boolean;
  missed: boolean; // unanswered / declined / nobody joined
  durationSec?: number; // connected calls only
  isGroup?: boolean;
  participants?: string[]; // group: display names of who actually joined (excl. self)
}

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
 *  - delivered / seen: peer receipts
 *  - failed:      the background job failed its retry budget → shows a retry button
 */
export type MessageStatus = 'compressing' | 'pending' | 'sent' | 'delivered' | 'seen' | 'failed';

/** Per-recipient receipt, drives group "Seen by" / "Delivered to" info. */
export interface Receipt {
  contactId: string;
  deliveredAt?: number;
  seenAt?: number;
  downloadedAt?: number; // when this member confirmed it has the media bytes (blob cleanup)
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
  seenAt?: number; // 1:1: when the peer opened/saw it
  // Spec 1013: when THIS device sent a 'seen' receipt for this INCOMING message (epoch ms).
  // undefined = not yet reported. Distinct from seenAt (the SENDER-side receipt time). Client-
  // local only — never sent on the wire, never own-data-synced; drives the visibility-driven
  // "Seen" trigger's once-only dedup and the not-yet-Seen pill count.
  seenReportedAt?: number;
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
  // Sender side: the server blob id we uploaded for this message's media, kept so we can
  // DELETE it once every recipient has downloaded the bytes (and on chat delete). Cleared
  // to undefined once the blob is deleted, so we never try twice.
  sentBlobId?: string;
  downloadedBy?: string[]; // 1:1: set once the peer confirms the media is downloaded
  mediaCleared?: boolean; // media blob removed locally to free space → shows a
  // "Photo/Video/... removed to free space" placeholder (distinct from `deleted`,
  // the sender deleting the message, and `pendingMedia`, not-yet-downloaded)
  deleted?: boolean; // soft-deleted → shows a "deleted" placeholder
  editedAt?: number; // text rewritten by its author after sending → "edited" tag
  expiresAt?: number; // disappearing messages: epoch ms when this self-destructs
  location?: GeoLocation; // kind === 'location'
  poll?: Poll; // kind === 'poll'
  contact?: SharedContact; // kind === 'contact'
  audio?: AudioMeta; // kind === 'audio' (shared music file: title/artist)
  callLog?: CallLog; // kind === 'call' (call-outcome informational row)
  // kind === 'text' with a URL: a generated preview card (built sender-side,
  // delivered E2EE). Absent until the deferred attach lands; the UI falls back to
  // a fetch-free domain-only card in the meantime.
  linkPreview?: import('@/services/crypto/message').LinkPreview;
  updatedAt: number;
}

export interface Call {
  id: string;
  contactId: string; // 1:1: the peer; group: the group chat (room) id
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
  // Group calls: recorded too (id is a fresh uid, not the reused room id), with the
  // participants that actually joined (excl. self) for the Calls-tab detail.
  isGroup?: boolean;
  roomId?: string;
  participants?: string[];
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
  // The full-resolution original. Optional because "free space, keep previews" (spec 1014 FR-018)
  // drops the original while retaining the thumbnail tiers below — the record (and its mediaId) stays
  // so the bubble/grid/strip previews keep rendering. `size` is zeroed when the blob is freed.
  blob?: Blob;
  // Spec 1014 thumbnail tiers. posterBlob is the LARGE/bubble tier (the existing video poster, and
  // now the 512px image bubble thumbnail received via MediaRef.poster) — used by the chat bubble.
  // posterGrid (320) and posterStrip (128) are derived locally from posterBlob and used by the
  // all-media grid and the full-screen viewer's bottom strip respectively. Additive optional Blobs:
  // legacy rows simply lack them until the background backfill fills them in.
  posterBlob?: Blob;
  posterGrid?: Blob;
  posterStrip?: Blob;
  durationSec?: number; // audio/video length
  updatedAt: number;
}

export interface Setting<T = unknown> {
  key: string;
  value: T;
}
