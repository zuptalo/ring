/**
 * Call-signalling transport helpers. 1:1 SDP/ICE is E2EE'd peer-to-peer by
 * reusing the exact Double Ratchet path chat messages use (sealForChat /
 * openPacket), then sent live over the WebSocket, never through the durable
 * outbox, since real-time signalling that can't be delivered now is useless.
 */
import { sealForChat, openPacket, clearSession } from '@/services/messaging';
import { getContact, startDirectChat } from '@/db/queries';
import type { CallSignal } from '@/services/crypto/message';
import { sendLive } from '@/composables/useSync';
import type { CallAnswerFrame, CallIceFrame, CallOfferFrame } from '@/services/transport';

export type { CallSignal };

/** Resolve the 1:1 ratchet chat id for a peer (creating the chat if needed). */
export async function chatIdForPeer(peerUserId: string): Promise<string | null> {
  const contact = await getContact(peerUserId);
  if (!contact) return null;
  return startDirectChat(contact);
}

// An ad-hoc group call meshes between EVERY pair of participants, but the initiator's
// co-invitees aren't necessarily each other's contacts, so two of them may share no 1:1
// ratchet to seal their leg's SDP/ICE over. The prefix below namespaces an EPHEMERAL,
// call-scoped Double-Ratchet container for such a pair: no contact row, no chat-list
// entry, and torn down when the call ends (clearCallSession). It bootstraps X3DH like any
// 1:1 session — the only thing it relies on is being able to fetch the peer's prekey
// bundle, which the server permits for the duration of a shared call room (same-room gate
// on GET /v1/keys), so no persistent connection is created. The act of joining the call is
// the consent; nobody silently lands in anyone's contacts.
const CALL_SESSION_PREFIX = 'callsess:';

/** The ratchet container used to seal mesh signalling to a call peer: a real contact's
 *  established 1:1 session, or an ephemeral call-scoped one for a non-contact co-member. */
export async function meshSessionChatId(peerUserId: string): Promise<string> {
  const contact = await getContact(peerUserId);
  if (contact) return startDirectChat(contact);
  return CALL_SESSION_PREFIX + peerUserId;
}

/** Tear down the ephemeral call-scoped session for a peer (no-op for a real contact, whose
 *  id never carries the prefix). Called as each mesh leg closes so nothing outlives the call. */
export async function clearCallSession(peerUserId: string): Promise<void> {
  await clearSession(CALL_SESSION_PREFIX + peerUserId);
}

/**
 * Seal the group media key for one member and send it as a live `call-key`
 * frame. Distributed peer-to-peer over the member's 1:1 ratchet, so the server
 * never sees the key. Returns false if no 1:1 session exists with the member.
 */
export async function sendSealedKey(
  peerUserId: string,
  roomId: string,
  epoch: number,
  keyB64: string,
): Promise<boolean> {
  const chatId = await chatIdForPeer(peerUserId);
  if (!chatId) return false;
  const sealed = await sealForChat(chatId, peerUserId, false, {
    body: '',
    kind: 'call',
    timestamp: Date.now(),
    call: { callId: roomId, type: 'key', roomId, epoch, key: keyB64 },
  });
  if (!sealed) return false;
  return sendLive({ t: 'call-key', to: sealed.to, roomId, ciphertext: sealed.packet });
}

/**
 * Seal our outgoing stream id for one member and send it as a live `call-streamid`
 * frame. Distributed peer-to-peer over the member's 1:1 ratchet, so the server never
 * learns the stream↔member binding (it can derive it at the SFU, but we don't hand it
 * over on the wire). Returns false if no 1:1 session exists with the member.
 */
export async function sendSealedStreamId(
  peerUserId: string,
  roomId: string,
  streamId: string,
): Promise<boolean> {
  const chatId = await chatIdForPeer(peerUserId);
  if (!chatId) return false;
  const sealed = await sealForChat(chatId, peerUserId, false, {
    body: '',
    kind: 'call',
    timestamp: Date.now(),
    call: { callId: roomId, type: 'streamid', roomId, streamId },
  });
  if (!sealed) return false;
  return sendLive({ t: 'call-streamid', to: sealed.to, roomId, ciphertext: sealed.packet });
}

/**
 * Seal a CallSignal for the peer and send it as the given 1:1 call frame.
 * Returns false if it couldn't be sealed (no session/account) or sent (offline).
 */
export async function sendSealedSignal(
  frameType: 'call-offer' | 'call-answer' | 'call-ice',
  chatId: string,
  peerUserId: string,
  callId: string,
  signal: CallSignal,
  roomId?: string, // set for a mesh group-call leg; omit for 1:1 (unchanged behavior)
): Promise<boolean> {
  const sealed = await sealForChat(chatId, peerUserId, false, {
    body: '',
    kind: 'call',
    timestamp: Date.now(),
    call: signal,
  });
  if (!sealed) return false;
  const frame: CallOfferFrame | CallAnswerFrame | CallIceFrame =
    frameType === 'call-offer'
      ? { t: 'call-offer', to: sealed.to, callId, kind: signal.kind, roomId, ciphertext: sealed.packet }
      : { t: frameType, to: sealed.to, callId, roomId, ciphertext: sealed.packet };
  return sendLive(frame);
}

/** Decrypt an inbound 1:1 call signal from a sealed packet. Returns null if the
 *  packet doesn't carry a call payload or can't be opened. */
export async function openSealedSignal(
  chatId: string,
  ciphertext: unknown,
): Promise<CallSignal | null> {
  try {
    const payload = await openPacket(chatId, ciphertext);
    return payload.call ?? null;
  } catch (e) {
    console.warn('[call] failed to open signal', e);
    return null;
  }
}

/** Send a payload-free 1:1 control frame (ringing/accept/reject/cancel/busy/end, and
 *  the consent-gated audio<->video upgrade request/accept/reject). */
export function sendControl(
  frameType:
    | 'call-ringing'
    | 'call-accept'
    | 'call-reject'
    | 'call-cancel'
    | 'call-busy'
    | 'call-end'
    | 'call-upgrade-request'
    | 'call-upgrade-accept'
    | 'call-upgrade-reject',
  to: string,
  callId: string,
  extra?: { reason?: string; duration?: number },
): Promise<boolean> {
  return sendLive({ t: frameType, to, callId, ...extra });
}
