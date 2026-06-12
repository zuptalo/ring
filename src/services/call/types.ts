/** Call state machine + metadata shared across the call modules. */
import type { CallKind } from '@/services/transport';

export type { CallKind };

/**
 * Call lifecycle:
 *   outgoing: idle → dialing → remote-ringing → connecting → connected → ended
 *   incoming: idle → incoming → connecting → connected → ended
 * `ended` is terminal and resets to `idle` after teardown.
 */
export type CallState =
  | 'idle'
  | 'dialing' // we placed the call, sent the offer, awaiting the callee's device
  | 'remote-ringing' // the callee's device acknowledged and is ringing
  | 'incoming' // we received an offer and are ringing locally
  | 'connecting' // answer exchanged, ICE/DTLS in progress
  | 'connected' // media flowing
  | 'ended';

export type EndReason =
  | 'hangup'
  | 'declined'
  | 'busy'
  | 'timeout'
  | 'failed'
  | 'unavailable'
  | 'answered-elsewhere'
  | 'remote';

export interface CallMeta {
  callId: string;
  isGroup: boolean;
  kind: CallKind;
  direction: 'incoming' | 'outgoing';
  // peer (1:1)
  peerUserId?: string;
  chatId?: string; // ratchet session key for seal/open
  // group
  roomId?: string;
  roster: string[];
  // Everyone this call was started with (initiator) or that we were told about (callee),
  // INCLUDING those who haven't joined the room yet. Drives the "ringing" placeholder tiles
  // for people still being rung. Distinct from `roster`, which is only those actually in
  // the room (and what the mesh opens legs to).
  invited?: string[];
  // display
  name: string;
  avatar: string;
  // timing
  startedAt?: number; // set when 'connected'
  endedReason?: EndReason;
  // internal: set the moment teardown begins so a call is torn down + logged exactly
  // once even if several end-signals race (a fresh CallMeta object per call resets it).
  tornDown?: boolean;
}
