/** Call state machine + metadata shared across the call modules. */
import type { CallKind } from '@/services/transport';

export type { CallKind };

// Participant caps (spec 0004 US3), mirrored on the server (call.VideoMax/AudioMax). A video
// group call holds at most VIDEO_MAX, an audio one at most AUDIO_MAX; the audio→video upgrade
// is blocked once a call has more than VIDEO_MAX participants. The client enforces these
// pre-emptively (picker + upgrade gate); the server enforces them authoritatively at join.
export const VIDEO_MAX = 4;
export const AUDIO_MAX = 8;

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
