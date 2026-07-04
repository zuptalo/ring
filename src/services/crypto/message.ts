/**
 * Message payload sealing over a Double Ratchet session. A message's content
 * (body, kind, optional media reference) is JSON-serialized and encrypted with
 * the ratchet; the resulting header + envelope are what travel over the
 * transport. The media blob itself is handled separately (media-transfer.ts);
 * only the small reference (id + wrapped file key) rides inside the payload.
 */
import {
  ratchetEncrypt,
  ratchetDecrypt,
  ratchetDecryptPreview,
  type RatchetState,
  type Header,
} from './ratchet';
import { utf8ToBytes, bytesToUtf8, type Envelope } from './envelope';
import type { ReplyRef, GeoLocation, Poll, SharedContact, AudioMeta } from '@/db/types';

export interface MediaRef {
  blobId: string;
  fileKey: string; // b64url of the per-file key (wrapped for transport later)
  mime: string;
  size: number;
  name: string;
  durationSec?: number;
  width?: number; // video pixel dimensions (shown on the bubble both sides)
  height?: number;
  poster?: string; // small JPEG thumbnail (data URL) so the recipient can show
  // a video preview without downloading the full clip
  quality?: string; // 'sd' | 'hd' | 'original' (the send-quality badge)
}

/**
 * A link preview (title/description/thumbnail) for a URL shared in a text
 * message. The SENDER's device builds it once - it fetches the page bytes via
 * the server relay (POST /v1/unfurl, since CORS blocks a direct cross-origin
 * fetch), parses them locally, and downscales the og:image to a tiny inline JPEG
 * data URL (like MediaRef.poster). It then travels E2EE and is rendered by the
 * recipient WITHOUT any further fetch, so the recipient never touches the URL.
 */
export interface LinkPreview {
  url: string; // the previewed link (the first URL in the message body)
  domain: string; // hostname without a leading www.
  title?: string;
  description?: string;
  image?: string; // small JPEG thumbnail as a data URL (inline, no media blob)
  imageWidth?: number;
  imageHeight?: number;
}

/**
 * A deferred link-preview attach, carried E2EE inside a payload (like a reaction)
 * and applied as a side effect: it sets the target message's `linkPreview` in
 * place rather than appearing as its own chat message. The text message is sent
 * immediately; the preview (which takes a round-trip to generate) follows once
 * ready, so the recipient sees the bare link first, then the card pops in. Only
 * honored when it comes from the message's author (`senderId` match).
 */
export interface LinkPreviewSignal {
  messageId: string;
  preview: LinkPreview;
  at: number; // epoch ms, for last-write-wins
}

/**
 * A shared contact card (iMessage "Share Name & Photo"-style). Travels E2EE in
 * a payload but is handled as a side effect (update contact / create request /
 * unhide chat), never stored as a visible message.
 *   - request: initial friend request (the inviter's name+photo)
 *   - accept:  recipient accepted, returning their name+photo
 *   - profile: a later name/photo update to re-share
 *   - cancel:  the requester withdrew a still-pending request (name/photo unused)
 */
export interface ContactCard {
  t: 'request' | 'accept' | 'profile' | 'cancel';
  name: string;
  avatar: string; // data URL
}

/**
 * WebRTC call signalling, carried E2EE inside a payload (like `card`) and
 * handled as a side effect, never stored or shown as a chat message.
 *   - offer/answer: SDP session description
 *   - ice:          a trickled ICE candidate
 *   - key:          a group-call media key (epoch + raw key, b64url) for the SFU
 *                   path, distributed peer-to-peer so the server never sees it
 */
export interface CallSignal {
  callId: string;
  // 'hold'/'resume' (spec 0005): the sender paused/resumed this call. Carried sealed over an
  // EXISTING call frame (no new frame type) and dispatched on this inner `type` by the
  // receiver, so the relay can't tell a hold from any other sealed signal (FR-012a).
  // 'qos' (spec 0007): a per-pair connection-health report — the receiver tells this sender the
  // max quality it wants/can use. Same trick: sealed inside the existing call-ice frame, coarse
  // enums + a counter ONLY (never raw bitrate/IP/location — Principle IX, FR-011), so the server
  // still only relays opaque ciphertext and can't tell it from any other sealed call signal.
  // 'joinroom' (spec 1028): promote/merge — tell this peer to join a mesh room (carries only the
  // opaque `roomId` + `kind` below). Same sealed-inside-call-ice trick as hold/resume/qos, so no
  // new frame type reaches the server; it can't tell a promotion from any other sealed signal.
  type: 'offer' | 'answer' | 'ice' | 'key' | 'streamid' | 'hold' | 'resume' | 'qos' | 'joinroom';
  kind?: 'audio' | 'video'; // on offer
  sdp?: string; // offer/answer
  sdpType?: RTCSdpType; // offer/answer
  candidate?: RTCIceCandidateInit; // ice
  roomId?: string; // group calls
  epoch?: number; // group media key
  key?: string; // group media key (b64url of 32 raw bytes)
  // group calls: the sender's outgoing MediaStream id, announced peer-to-peer so each
  // member can map an incoming (otherwise anonymous) stream to its owner for the
  // name/avatar label. Carried E2EE like the key; the server never reads it.
  streamId?: string;
  qos?: QosReport; // on 'qos' (spec 0007)
}

/** Spec 0007 connection-health report (sealed; never seen by the server). Coarse enums + a
 *  monotonic counter ONLY — deliberately no raw bandwidth, IP, or location (data minimization,
 *  FR-011). `requestedTier` is a hard ceiling the receiver asks this sender to honor;
 *  `downlinkClass` is the receiver's coarse self-assessment of its own downlink; `seq` is
 *  monotonic per sender→peer so the newest report wins and stale/reordered ones are dropped. */
export interface QosReport {
  requestedTier: 'off' | 'low' | 'medium' | 'high' | 'hd';
  downlinkClass: 'off' | 'low' | 'medium' | 'high' | 'hd';
  seq: number;
}

/**
 * Group membership control, carried E2EE inside a 1:1 payload (like `card`) and
 * applied as a side effect, never shown as a message. `members` is the full
 * roster (including the sender); `at` is a version stamp for last-write-wins.
 *   - create: a new group you've been added to (name + roster)
 *   - update: roster/name change (member added, renamed)
 *   - leave:  the sender is leaving the group
 */
/** One member in a group roster: id + display name (so co-members render names
 *  even when they aren't your contacts; avatar falls back to initials). */
export interface GroupMember {
  id: string;
  name: string;
}

export interface GroupCard {
  // create/update/leave drive immediate membership; invite/accept/decline are the
  // accept-first flow for adding someone AFTER creation:
  //  - invite  → inviter asks a member to join (invitee must accept before they
  //              receive any messages; the group chat isn't created on their device
  //              until they accept, so pre-join history never reaches them)
  //  - accept  → invitee confirms; the inviter moves them into the live roster and
  //              broadcasts an 'update' so everyone converges
  //  - decline → invitee declines; the inviter just drops them from the pending set
  t: 'create' | 'update' | 'leave' | 'invite' | 'accept' | 'decline';
  groupId: string;
  name: string; // group name
  avatar?: string; // group photo (data URL), optional
  members: GroupMember[]; // full roster (incl. the sender)
  at: number; // version (epoch ms) for last-write-wins
  inviter?: string; // 'invite' only: the inviter's user id (for the invitee's UI)
  createdBy?: string; // group owner (creator) — v1 "admin" for @everyone gating (spec 1020)
}

/**
 * An emoji reaction to an existing message, carried E2EE inside a payload (like
 * `card`) and applied as a side effect: it mutates the target message's
 * reactions rather than appearing as its own chat message. `messageId` is shared
 * by both sides of a 1:1 (and every member's copy of a group message), so it
 * targets the right message everywhere. `remove` undoes the sender's reaction.
 */
export interface ReactionSignal {
  messageId: string;
  emoji: string;
  remove?: boolean;
  at: number; // epoch ms, for last-write-wins per user
}

/**
 * A poll vote, carried E2EE inside a payload (like a reaction) and applied as a
 * side effect: it mutates the target poll message's votes rather than appearing
 * as its own chat message. `option` indexes into the poll's options; `remove`
 * un-votes it (toggling, or switching choice in a single-choice poll).
 */
export interface PollVoteSignal {
  messageId: string;
  option: number;
  remove?: boolean;
  at: number; // epoch ms, for last-write-wins
}

/**
 * An edit to an existing message's text, carried E2EE inside a payload (like a
 * reaction) and applied as a side effect: it rewrites the target message's body
 * in place rather than appearing as its own chat message. Only honored when it
 * comes from the message's author, and only while the receiver hasn't deleted
 * their copy ("editable as long as it isn't deleted on either side").
 */
export interface EditSignal {
  messageId: string;
  body: string; // the full replacement text
  at: number; // epoch ms → editedAt on both sides
}

/**
 * The author deleting their message for everyone, carried E2EE inside a payload
 * (like a reaction) and applied as a side effect. With `trace` (the default UX)
 * the receiver keeps a "This message was deleted" placeholder; without it the
 * row is removed outright, leaving no trace in the conversation. Only honored
 * when it comes from the message's author.
 */
export interface EraseSignal {
  messageId: string;
  trace?: boolean;
  at: number; // epoch ms
}

/**
 * A new in-chat game (spec 0008), kind === 'game'. The whole start is just the
 * registry id: the initial board is derived on both ends from the module's
 * createInitialState(), and roles come from message direction (sender = player
 * 0, moves first) — nothing else needs to cross the wire. `gameType` is frozen
 * once shipped (see contracts/game-payload.md §3).
 */
export interface GameStart {
  gameType: string;
}

/**
 * A game move or resignation, carried E2EE inside a payload (like a poll vote)
 * and applied as a side effect: it appends to the target game bubble's move
 * log rather than appearing as its own chat message. The wire carries MOVES,
 * never board state — each device validates and replays locally, so a
 * tampering peer can only force a labeled out-of-sync state (spec FR-004).
 */
export interface GameMoveSignal {
  messageId: string;
  seq: number; // 1-based, strictly increasing per game session
  action: 'move' | 'resign';
  move?: unknown; // game-specific shape (tictactoe: { cell: 0-8 }); absent for resign
  at: number; // epoch ms, display only — never used for ordering
}

export interface MessagePayload {
  body: string;
  kind: string;
  timestamp: number;
  mediaRef?: MediaRef;
  card?: ContactCard;
  call?: CallSignal;
  // Group chat: when set, this message belongs to the group with this id (routed
  // to the group chat on receipt instead of the 1:1 sender chat).
  groupId?: string;
  group?: GroupCard;
  reaction?: ReactionSignal;
  edit?: EditSignal; // rewrite of an earlier message's text (side effect)
  erase?: EraseSignal; // author's delete-for-everyone of an earlier message (side effect)
  reply?: ReplyRef; // the quoted message (rendered above this one)
  albumId?: string; // media sent together → grouped as an album on receipt
  albumName?: string; // optional album title
  videoNote?: boolean; // round hold-to-record video note
  location?: GeoLocation; // kind === 'location'
  poll?: Poll; // kind === 'poll' (votes start empty; vote signals fill them)
  pollVote?: PollVoteSignal; // a vote on an existing poll message (side effect)
  game?: GameStart; // kind === 'game' (moves start empty; move signals fill them)
  gameMove?: GameMoveSignal; // a move/resign on an existing game message (side effect)
  contact?: SharedContact; // kind === 'contact' (a shared Ring contact)
  audio?: AudioMeta; // kind === 'audio' (shared music file: title/artist)
  linkPreview?: LinkPreview; // inline preview on first send (rare: only if fast enough)
  linkPreviewSig?: LinkPreviewSignal; // deferred preview attach for a sent text (side effect)
  // Session-reset control (like `card`): sent when the peer received a message it
  // could not decrypt (e.g. we deleted the chat, tearing down our ratchet). It rides
  // in a fresh X3DH prekey packet so the peer re-establishes the session, and on
  // receipt triggers a resend of our still-undelivered messages. Never shown.
  rekey?: boolean;
  // Disappearing messages: epoch ms when this message self-destructs on both sides
  // (a swept message is removed). Set by the sender from the chat's default TTL.
  expiresAt?: number;
  // Disappearing-messages CONTROL (like `card`): the chat's new default TTL in ms
  // (0/null = off). Applied as a side effect so the peer adopts the same setting;
  // never shown as a message.
  ttl?: number | null;
  // @mentions (spec 1020, group chats): the member user-ids this message tags, and an
  // admin/owner-only broadcast flag. Carried INSIDE the sealed payload — the server
  // never learns who is mentioned. The recipient decrypts, checks if it (or a validated
  // @everyone) is mentioned, and escalates the notification locally.
  mentions?: string[];
  mentionsEveryone?: boolean;
}

export interface WireMessage {
  header: Header;
  env: Envelope;
}

/** Encrypt a message payload for transport; mutates `state` (advances the ratchet). */
export function sealMessage(
  state: RatchetState,
  payload: MessagePayload,
  ad: Uint8Array = new Uint8Array(0),
): WireMessage {
  return ratchetEncrypt(state, utf8ToBytes(JSON.stringify(payload)), ad);
}

/** Decrypt a wire message; mutates `state`. Throws if it doesn't authenticate. */
export function openMessage(
  state: RatchetState,
  wire: WireMessage,
  ad: Uint8Array = new Uint8Array(0),
): MessagePayload {
  const pt = ratchetDecrypt(state, wire.header, wire.env, ad);
  return JSON.parse(bytesToUtf8(pt)) as MessagePayload;
}

/**
 * Decrypt a wire message for the service-worker PREVIEW path (spec 2015): advances
 * `state` the same way but leaves the read message's own key in the skipped-key
 * cache, so persisting this advance can't make the message undecryptable for the
 * page's later authoritative openMessage. Throws if it doesn't authenticate.
 */
export function openMessagePreview(
  state: RatchetState,
  wire: WireMessage,
  ad: Uint8Array = new Uint8Array(0),
): { payload: MessagePayload; advancedDh: boolean } {
  const { plaintext, advancedDh } = ratchetDecryptPreview(state, wire.header, wire.env, ad);
  return { payload: JSON.parse(bytesToUtf8(plaintext)) as MessagePayload, advancedDh };
}
