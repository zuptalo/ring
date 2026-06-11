/**
 * Call-signalling transport helpers. 1:1 SDP/ICE is E2EE'd peer-to-peer by
 * reusing the exact Double Ratchet path chat messages use (sealForChat /
 * openPacket), then sent live over the WebSocket, never through the durable
 * outbox, since real-time signalling that can't be delivered now is useless.
 */
import { sealForChat, openPacket } from '@/services/messaging';
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
