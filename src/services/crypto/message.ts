/**
 * Message payload sealing over a Double Ratchet session. A message's content
 * (body, kind, optional media reference) is JSON-serialized and encrypted with
 * the ratchet; the resulting header + envelope are what travel over the
 * transport. The media blob itself is handled separately (media-transfer.ts);
 * only the small reference (id + wrapped file key) rides inside the payload.
 */
import { ratchetEncrypt, ratchetDecrypt, type RatchetState, type Header } from './ratchet';
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
  type: 'offer' | 'answer' | 'ice' | 'key' | 'streamid';
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
  reply?: ReplyRef; // the quoted message (rendered above this one)
  albumId?: string; // media sent together → grouped as an album on receipt
  albumName?: string; // optional album title
  videoNote?: boolean; // round hold-to-record video note
  location?: GeoLocation; // kind === 'location'
  poll?: Poll; // kind === 'poll' (votes start empty; vote signals fill them)
  pollVote?: PollVoteSignal; // a vote on an existing poll message (side effect)
  contact?: SharedContact; // kind === 'contact' (a shared Ring contact)
  audio?: AudioMeta; // kind === 'audio' (shared music file: title/artist)
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
