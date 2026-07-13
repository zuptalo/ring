/**
 * Call-signalling transport helpers. 1:1 SDP/ICE is E2EE'd peer-to-peer by
 * reusing the exact Double Ratchet path chat messages use (sealForChat /
 * openPacket), then sent live over the WebSocket, never through the durable
 * outbox, since real-time signalling that can't be delivered now is useless.
 */
import { sealForChat, openPacket, clearSession } from '@/services/messaging';
import { getContact, sessionChatIdForPeer } from '@/db/queries';
import type { CallSignal, QosReport } from '@/services/crypto/message';
import { sendLive } from '@/composables/useSync';
import type { CallAnswerFrame, CallIceFrame, CallOfferFrame, CallKind } from '@/services/transport';

export type { CallSignal };

/** Resolve the 1:1 ratchet chat id for a peer (creating the chat if needed).
 *  Uses the session-carrier resolver, NOT startDirectChat: the session may live
 *  under a HIDDEN 1:1 (spec 1027 knock-knock — calls ride it without
 *  resurrecting a visible chat or forking the ratchet). */
export async function chatIdForPeer(peerUserId: string): Promise<string | null> {
  const contact = await getContact(peerUserId);
  if (!contact) return null;
  return sessionChatIdForPeer(contact);
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
  if (contact) return sessionChatIdForPeer(contact); // may be a hidden 1:1 — see chatIdForPeer
  return CALL_SESSION_PREFIX + peerUserId;
}

/** Tear down the ephemeral call-scoped session for a peer (no-op for a real contact, whose
 *  id never carries the prefix). Called as each mesh leg closes so nothing outlives the call. */
export async function clearCallSession(peerUserId: string): Promise<void> {
  await clearSession(CALL_SESSION_PREFIX + peerUserId);
}

// NOTE: the SFU-era sealed group-key (call-key) and stream-id (call-streamid) senders were
// removed with the SFU (spec 0004 US6). The mesh needs neither: each leg is a known peer over
// native DTLS-SRTP, so there is no per-frame media key to distribute and the stream↔member
// binding is local (one PeerConnection per peer).

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

/**
 * Send a sealed "join this room" control signal (spec 1028). Tells a 1:1 peer to
 * follow us into a mesh room — promoting the 1:1 into a group, or merging an
 * incoming caller into our current call. Carried inside an EXISTING `call-ice`
 * frame (the hold/resume trick): no new transport frame, no server change, and
 * the relay can't tell it from any other sealed call signal. The payload is only
 * the opaque `roomId` + `kind` (FR-017). Sent over the pair's 1:1 session, so the
 * frame itself has no roomId (it's not a mesh leg).
 */
export function sendJoinRoom(
  chatId: string,
  peerUserId: string,
  callId: string,
  roomId: string,
  kind: CallKind,
): Promise<boolean> {
  return sendSealedSignal('call-ice', chatId, peerUserId, callId, {
    callId,
    type: 'joinroom',
    roomId,
    kind,
  });
}

/**
 * The consent-gated merge (spec 1041): ask the party behind a waiting or held
 * call to JOIN our ongoing call instead — they answer with accept or reject,
 * and an outstanding request is withdrawn with 'joinreq-cancel' when the
 * ongoing call ends. Same sealed-inside-`call-ice` trick as joinroom: no new
 * transport frame, no server change, indistinguishable from an ICE candidate
 * on the wire. `callId` is the RECIPIENT's attempt/held-call id (their prompt
 * matches on it); `kind` is the ONGOING call's kind (for the prompt copy —
 * the accepter still joins with their own attempt's media, clarification A).
 */
export function sendJoinRequest(
  chatId: string,
  peerUserId: string,
  callId: string,
  roomId: string,
  kind: CallKind,
): Promise<boolean> {
  return sendSealedSignal('call-ice', chatId, peerUserId, callId, { callId, type: 'joinreq', roomId, kind });
}

/** The waiting/held party's answer to a join request. */
export function sendJoinRequestReply(
  verdict: 'joinreq-accept' | 'joinreq-reject',
  chatId: string,
  peerUserId: string,
  callId: string,
  roomId: string,
): Promise<boolean> {
  return sendSealedSignal('call-ice', chatId, peerUserId, callId, { callId, type: verdict, roomId });
}

/** Withdraw an outstanding join request (the ongoing call ended, FR-014). */
export function sendJoinRequestCancel(
  chatId: string,
  peerUserId: string,
  callId: string,
  roomId: string,
): Promise<boolean> {
  return sendSealedSignal('call-ice', chatId, peerUserId, callId, { callId, type: 'joinreq-cancel', roomId });
}

/**
 * Send a sealed hold/resume control signal for a call (spec 0005). Carried over an EXISTING
 * `call-ice` frame so there is NO new transport frame and NO server change — the relay
 * forwards opaque ciphertext exactly as for offer/answer/ICE, and the receiver dispatches on
 * the inner `CallSignal.type` (it can't tell a hold from any other sealed signal — FR-012a).
 * 1:1: omit `roomId`; mesh: pass the leg's `roomId` (one per leg).
 */
export function sendHoldResume(
  signalType: 'hold' | 'resume',
  chatId: string,
  peerUserId: string,
  callId: string,
  roomId?: string,
): Promise<boolean> {
  return sendSealedSignal('call-ice', chatId, peerUserId, callId, { callId, type: signalType, roomId }, roomId);
}

/**
 * Send a sealed camera-state signal (spec 2029). Identical transport to hold/resume: sealed
 * inside an EXISTING `call-ice` frame — no new frame type, no server change, and the relay
 * can't tell a camera toggle from any other sealed call signal. The receiver swaps the
 * sender's tile to their avatar (camoff) or back to live video (camon) deterministically,
 * instead of waiting on the browser's unreliable gone-dark track reporting.
 * 1:1: omit `roomId`; mesh: pass the leg's `roomId` (one per leg).
 */
export function sendCameraState(
  on: boolean,
  chatId: string,
  peerUserId: string,
  callId: string,
  roomId?: string,
): Promise<boolean> {
  return sendSealedSignal('call-ice', chatId, peerUserId, callId, { callId, type: on ? 'camon' : 'camoff', roomId }, roomId);
}

/**
 * Send a sealed per-pair connection-health report (spec 0007 `qos`). Identical transport to
 * hold/resume: sealed inside an EXISTING `call-ice` frame, so no new frame, no server change —
 * the relay forwards opaque ciphertext and can't tell it from any other call signal. The payload
 * is coarse enums + a counter only (no raw bitrate/IP/location — FR-011). 1:1: omit `roomId`;
 * mesh: pass the leg's `roomId`.
 */
export function sendHealth(
  chatId: string,
  peerUserId: string,
  callId: string,
  qos: QosReport,
  roomId?: string,
): Promise<boolean> {
  return sendSealedSignal('call-ice', chatId, peerUserId, callId, { callId, type: 'qos', qos, roomId }, roomId);
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

/** Caller → server: re-ring (recall) one group invitee who hasn't joined yet. The server
 *  re-sends the invite and restarts that member's reminder rounds. */
export function sendRecall(
  memberId: string,
  roomId: string,
  kind: CallKind,
  members: string[],
): Promise<boolean> {
  return sendLive({ t: 'call-ring', to: memberId, roomId, kind, members });
}

/** Caller → server: stop ringing AND remove one not-yet-joined group invitee. The server
 *  halts their reminders and relays the cancel so their ringing device dismisses it. */
export function sendGroupInviteeCancel(memberId: string, roomId: string): Promise<boolean> {
  return sendLive({ t: 'call-cancel', to: memberId, roomId, reason: 'declined' });
}

/** Invitee → server: decline/dismiss a group invite (or leave the room) so the server stops
 *  re-ringing us. Without this a dismissed group ring keeps coming back every reminder round
 *  until the rounds run out (spec 0004 US1). Sent on decline of an invite we never accepted;
 *  a joined call already sends call-leave via the mesh teardown. */
export function sendGroupLeave(roomId: string): Promise<boolean> {
  return sendLive({ t: 'call-leave', roomId });
}

/** Busy invitee → caller: we can't take this group call (already in another call). The server
 *  relays it so the caller resolves our tile to "unavailable" instead of ringing us forever,
 *  and stops re-ringing us (spec 0004 US2). No callId — group busy is keyed by roomId. */
export function sendGroupBusy(to: string, roomId: string): Promise<boolean> {
  return sendLive({ t: 'call-busy', to, roomId });
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
