/**
 * 1:1 WebRTC call engine + reactive call store (singleton).
 *
 * Signalling rides the WebSocket as live-only `call-*` frames; SDP/ICE are
 * E2EE'd peer-to-peer over the existing Double Ratchet (services/call/signalling).
 * Media is a direct DTLS-SRTP PeerConnection (natively end-to-end encrypted),
 * relayed through the server's TURN only when a direct path is blocked
 * (iceTransportPolicy 'relay', forced by the 443-only deployment).
 *
 * Group calls are a peer-to-peer mesh layered on separately (services/call/mesh.ts);
 * this file owns the 1:1 path and the shared reactive state/UI surface.
 */
import { ref, computed, watch } from 'vue';
import { appToast } from '@/services/toast';
import { describeMediaError } from '@/services/media-errors';
import router from '@/router';
import { uid } from '@/utils/uid';
import {
  getContact,
  getChat,
  addContactWithId,
  sessionChatIdForPeer,
  createCall,
  finishCall,
  markCallMissed,
  deleteCalls,
  recordGroupCall,
  logCallToChat,
  sendMessage,
  getSetting,
  sendCallEvent,
  markGroupRingSeenLive,
} from '@/db/queries';
import { buildRingEvent, buildEndedEvent } from '@/services/call-events';
import { groupAvatar } from '@/db/avatars';

// Pre-answer identity for a call whose conversation is hidden (spec 1019, FR-019):
// the incoming surface must reveal nothing identifying. A neutral name + avatar.
import { getSelfUserId } from '@/services/auth';
import { isUnlockedNow, isUnlocked } from '@/services/crypto/identity';
import { getTurnConfig, warmTurnConfig, rtcConfig } from '@/services/call/turn';
import {
  sendSealedSignal, openSealedSignal, sendControl, meshSessionChatId, sendRecall, sendGroupInviteeCancel,
  sendGroupLeave, sendGroupBusy, sendHoldResume, sendHealth, sendJoinRoom,
  sendJoinRequest, sendJoinRequestReply, sendJoinRequestCancel,
} from '@/services/call/signalling';
import {
  createJoinRequests, canRequest as jrCanRequest, request as jrRequest, reject as jrReject,
  accept as jrAccept, clearParty as jrClearParty, drainPending as jrDrainPending,
  type JoinRequestState,
} from '@/services/call/join-request';
import { MeshSession } from '@/services/call/mesh';
import { syncState } from '@/composables/useSync';
import { startLoopTone, stopLoopTone, playTone, cue, type ToneName } from '@/services/sound';
import type { CallState, CallMeta, CallKind, EndReason } from '@/services/call/types';
import type { CallSignal } from '@/services/crypto/message';
import { VIDEO_MAX } from '@/services/call/types';
import { remainingSlots, canAdd } from '@/services/call/capacity';
import { glareRole, yieldMode } from '@/services/call/glare';
import { planInvite } from '@/services/call/invite-plan';
import { newJoiners } from '@/services/call/join-cue';
import {
  type Tier,
  type ControllerState,
  TIERS,
  tierEncoding,
  initialController,
  nextTier,
  snapshotFromReport,
  clampForPin,
  downlinkClassFrom,
  requestedTierOf,
  tileTarget,
} from '@/services/call/quality';
import { setDiagSnapshot } from '@/services/call/diag';
import { activeDurationSec, bankActive, startActive } from '@/services/call/duration';
import type { CallFrame } from '@/services/transport';

/* ---- reactive state (read by the call UI) ---- */

export const callState = ref<CallState>('idle');
export const callMeta = ref<CallMeta | null>(null);
export const localStream = ref<MediaStream | null>(null);
export const remoteStream = ref<MediaStream | null>(null);
export const muted = ref(false);
export const cameraOff = ref(false);
// Which camera the local video track is using, and whether we're sharing the screen
// (in which case the outgoing video track is the display, not the camera).
export const cameraFacing = ref<'user' | 'environment'>('user');
export const screenSharing = ref(false);
// Whether this device has more than one camera, so the UI only offers the flip control
// when it can actually do something. Resolved once the call connects (labels/devices
// need the in-call media permission to enumerate).
export const hasMultipleCameras = ref(false);
// Outgoing-video quality tier the user picked for THIS call (resets per call). 'auto'
// lets WebRTC's bandwidth estimator decide; the lower tiers cap the bitrate (and scale
// the resolution/framerate down) to consume less data while still sending video.
export type VideoQuality = 'auto' | 'medium' | 'low';
export const videoQuality = ref<VideoQuality>('auto');
// 1:1 audio->video upgrade consent: `upgradePending` = we asked and are waiting for
// the peer's accept/reject; `upgradeRequest` = the peer asked us and a prompt shows.
export const upgradePending = ref(false);
export const upgradeRequest = ref(false);
// Traffic is reported in KILOBYTES per second (KB/s), not kilobits: bytes are the
// unit people read throughput in, and the numbers are friendlier (a plain audio
// call is ~2.5 KB/s rather than ~20 kbps). One decimal place.
export const callStats = ref({ durationSec: 0, kBpsUp: 0, kBpsDown: 0 });
// Group calls: the remote participants' streams (one per peer) for the tile grid.
export const remoteStreams = ref<MediaStream[]>([]);
// Group calls: maps a remote stream id → the userId that owns it, so a tile can show
// that participant's name/avatar. Announced peer-to-peer (sealed); see GroupSession.
export const groupStreamOwners = ref<Record<string, string>>({});
// Group calls: tile keys (remote stream ids, or the self sentinel) currently speaking,
// for the active-speaker highlight. Driven by GroupSession's audio metering.
export const activeSpeakers = ref<string[]>([]);
// A transient status shown during the call when the connection is degraded
// ('Reconnecting…' while ICE is down, 'Connection unstable' on high packet loss).
export const connectionWarning = ref<string | null>(null);

/* ---- call waiting (spec 0005): hold / swap / drop a second call ---- */
// The parked (held) call's meta, or null when only one call is in progress. Drives the
// tap-to-swap "On hold" bar. The active call stays in the singleton refs above; the held
// call's connection objects live in `heldSlot` (below).
export const heldCall = ref<CallMeta | null>(null);
// True when the OTHER side has put the ACTIVE call on hold (we render "on hold" and our
// outgoing to them is paused until they resume). Distinct from heldCall (which WE hold).
export const remoteHeld = ref(false);
// Group calls: peers who have put us on hold, so their tile shows "on hold" (mesh-reported).
export const groupHeldPeers = ref<string[]>([]);
// When the other side resumes a call they'd put us on hold, we don't snap our camera/mic back
// on instantly — we count down (5→1) with a cue first, so the person isn't caught off-guard
// becoming visible/audible again. null = not counting down (spec 0005).
export const resumeCountdown = ref<number | null>(null);
// (spec 2013) The MIRROR countdown shown to the party who RESUMED a held video call (the swapper):
// "{peer}'s video resumes in N…", synced to the peer's own "You'll be on camera" heads-up so the
// resumer isn't left staring at a frozen frame. null = not counting down; video calls only.
export const peerResumeCountdown = ref<number | null>(null);
// Caller side: the person we're calling is already in a call but CAN take a second one — they got
// a call-waiting prompt (their device acked with reason 'call-waiting'). We show "in their queue"
// instead of plain "Ringing…" so the caller knows they've been notified and may be picked up.
export const remoteQueued = ref(false);
// A second incoming call arriving while we're in one (and a held slot is free): shown over
// the active call as an Accept-&-hold / Decline prompt, separate from the active call's state.
export const incomingSecond = ref<{
  kind: 'direct' | 'group';
  callId: string;
  from?: string;
  chatId?: string;
  roomId?: string;
  name: string;
  avatar: string;
  callKind: CallKind;
  offer?: { sdp: string; sdpType: RTCSdpType };
  members?: string[];
} | null>(null);

/* ---- audio output routing (earpiece / loudspeaker / Bluetooth) ---- */
// We model three logical routes the user understands, EARPIECE (held to the ear),
// SPEAKER (loudspeaker) and BLUETOOTH, on top of the one web primitive available:
// HTMLMediaElement.setSinkId + enumerateDevices('audiooutput'). That genuinely works
// on Chromium (desktop) and macOS Safari 18.4+, which enumerate real output sinks.
//
// CAPABILITY IS PROVEN BY ENUMERATED DEVICES, NOT BY THE setSinkId PROPERTY. iOS 18.4
// started exposing the setSinkId *property* on iPhones even though it only functions on
// macOS, so a property-presence check (supportsAudioOutput) reports "supported" on iOS
// and showed a route button that flipped its icon while changing nothing. availableRoutes
// therefore gates on a real enumerated audiooutput device and never offers a picker on
// iOS — where the OS owns the route (proximity + Control Center + auto-Bluetooth) and the
// only web lever is the audio-session category bias (see setIosSpeakerphone). On Android
// Chrome there is no output API at all and only a 'default' sink enumerates, so no picker
// appears there either.
export type AudioRoute = 'earpiece' | 'speaker' | 'bluetooth';

export const audioOutputs = ref<MediaDeviceInfo[]>([]);
export const audioOutputId = ref<string>(''); // resolved sink id ('' = system default)
export const audioRoute = ref<AudioRoute>('earpiece'); // current logical route

/** Whether this browser lets us pick the audio output device. */
export function supportsAudioOutput(): boolean {
  return (
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype &&
    !!navigator.mediaDevices?.enumerateDevices
  );
}

/** iOS (incl. iPadOS posing as Mac). iOS has NO web API to pick earpiece vs
 *  loudspeaker (no setSinkId; navigator.audioSession only biases), so the call UI
 *  offers no manual route toggle there; the OS owns it (proximity + Control Center +
 *  auto-Bluetooth). We just bias toward the earpiece via the play-and-record session
 *  category and play remote audio through a single <audio> element. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
}

const BT_RE = /(bluetooth|airpod|\bbt\b|hands[-\s]?free|a2dp|\ble audio\b|wh-|wf-|buds|beats|headset)/i;
const SPK_RE = /(speakerphone|speaker|loud|external)/i;
const EAR_RE = /(earpiece|earphone|receiver|handset|internal|built[-\s]?in)/i;

/** Classify one enumerated output into a logical route (null = unknown/default). */
function classifyDevice(d: MediaDeviceInfo): AudioRoute | null {
  const l = (d.label || '').toLowerCase();
  if (BT_RE.test(l)) return 'bluetooth';
  if (SPK_RE.test(l)) return 'speaker';
  if (EAR_RE.test(l)) return 'earpiece';
  return null;
}

/** Best concrete device for each logical route (a route absent here resolves to
 *  the system default sink). */
function devicesByRoute(): Partial<Record<AudioRoute, MediaDeviceInfo>> {
  const out: Partial<Record<AudioRoute, MediaDeviceInfo>> = {};
  for (const d of audioOutputs.value) {
    if (!d.deviceId) continue;
    const r = classifyDevice(d);
    if (r && !out[r]) out[r] = d;
  }
  // Phones expose a 'communications'/'default' sink the OS routes to the earpiece
  // during a call; treat it as the earpiece anchor when nothing self-identified.
  if (!out.earpiece) {
    out.earpiece =
      audioOutputs.value.find((d) => d.deviceId === 'communications') ??
      audioOutputs.value.find((d) => d.deviceId === 'default');
  }
  return out;
}

/** Logical routes offerable right now. Earpiece+Speaker are always offered where
 *  output selection is supported (the OS may or may not honor the split, but the
 *  user still gets the toggle); Bluetooth appears only while a BT sink exists. */
export const availableRoutes = computed<AudioRoute[]>(() => {
  // Gate on PROOF, not the API's presence: iOS 18.4 exposes setSinkId (macOS-only in
  // practice) yet enumerates NO audiooutput device, so a property check falsely passed
  // and produced a do-nothing button. Offer a picker only where setSinkId works AND at
  // least one real output sink enumerated, and never on iOS (the OS owns the route there;
  // its speaker toggle goes through setIosSpeakerphone instead).
  if (isIOS() || !supportsAudioOutput()) return [];
  const hasRealSink = audioOutputs.value.some((d) => d.deviceId && d.deviceId !== 'default');
  if (!hasRealSink) return [];
  const routes: AudioRoute[] = ['earpiece', 'speaker'];
  if (devicesByRoute().bluetooth) routes.unshift('bluetooth');
  return routes;
});

/** Re-enumerate the available audio output devices (labels need mic permission,
 *  which an active call already has). */
export async function refreshAudioOutputs(): Promise<void> {
  if (!supportsAudioOutput()) {
    audioOutputs.value = [];
    return;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    audioOutputs.value = devices.filter((d) => d.kind === 'audiooutput');
  } catch {
    audioOutputs.value = [];
  }
}

let lastManualRouteAt = 0;

/** Switch to a logical route: resolve it to a concrete sink id (or '' = system
 *  default when the platform can't physically split it) so the call UI re-applies
 *  it to every media element. `manual` records a user choice so a Bluetooth device
 *  that (re)appears moments later doesn't immediately yank them off it. */
export async function setRoute(route: AudioRoute, opts?: { manual?: boolean }): Promise<void> {
  audioRoute.value = route;
  if (opts?.manual) lastManualRouteAt = Date.now();
  const dev = devicesByRoute()[route];
  audioOutputId.value = dev?.deviceId && dev.deviceId !== 'default' ? dev.deviceId : '';
}

// React to devices being added/removed: a Bluetooth headset connecting mid-call
// becomes the route automatically (per spec); disconnecting falls back to the
// kind-appropriate default (earpiece for audio, speaker for video).
const MANUAL_OVERRIDE_MS = 6000;
let deviceChangeTimer: ReturnType<typeof setTimeout> | null = null;
if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener?.('devicechange', () => {
    if (deviceChangeTimer) clearTimeout(deviceChangeTimer);
    deviceChangeTimer = setTimeout(() => void onDeviceChange(), 300); // debounce BT handoff churn
  });
}

async function onDeviceChange(): Promise<void> {
  const hadBt = audioRoute.value === 'bluetooth';
  await refreshAudioOutputs();
  if (callState.value !== 'connected' && callState.value !== 'connecting') return;
  const byRoute = devicesByRoute();
  const recentlyManual = Date.now() - lastManualRouteAt < MANUAL_OVERRIDE_MS;
  if (byRoute.bluetooth && audioRoute.value !== 'bluetooth' && !recentlyManual) {
    await setRoute('bluetooth'); // BT connected → auto-select (spec #2)
  } else if (hadBt && !byRoute.bluetooth) {
    const video = callMeta.value?.kind === 'video';
    await setRoute(video ? 'speaker' : 'earpiece'); // BT gone → kind default (spec #3)
  }
}

let routeInitialized = false;

/** Enumerate outputs once a call is connected (mic perm grants labels) and pick the
 *  starting route: Bluetooth if present (spec #2), else speaker for video / earpiece
 *  for audio (spec #3). Runs once per call so an ICE-recovery reconnect can't clobber
 *  a route the user changed mid-call. */
async function initAudioRoute(): Promise<void> {
  await refreshAudioOutputs();
  if (routeInitialized) return;
  routeInitialized = true;
  if (devicesByRoute().bluetooth) {
    await setRoute('bluetooth');
  } else {
    await setRoute(callMeta.value?.kind === 'video' ? 'speaker' : 'earpiece');
  }
}

/* ---- non-reactive engine state ---- */

let pc: RTCPeerConnection | null = null;
let groupSession: MeshSession | null = null;

// Call waiting (spec 0005): the parked (held) call's live connection objects + media. The
// ACTIVE call uses the singleton refs above; when a second call is taken, the current call is
// paused and moved here (and restored on swap/drop). At most one held slot (two-call cap).
interface HeldSlot {
  meta: CallMeta;
  pc: RTCPeerConnection | null;
  groupSession: MeshSession | null;
  remoteStream: MediaStream | null;
  remoteStreams: MediaStream[];
  owners: Record<string, string>;
}
let heldSlot: HeldSlot | null = null;
// ICE candidates for the pending second incoming call, buffered until Accept & hold creates
// its pc (drained in connectSecondDirect) — keeps the second call fast to connect.
let secondIce: RTCIceCandidateInit[] = [];

/** Attach (or, with `stream === null`, detach) the 1:1 sender tracks on `target`, matched by
 *  the transceiver's media kind so a nulled sender is still found (renegotiation-free — call
 *  waiting, spec 0005). Detach pauses outgoing; attach restores it from the shared stream. */
async function set1to1Senders(target: RTCPeerConnection, stream: MediaStream | null): Promise<void> {
  const a = stream?.getAudioTracks()[0] ?? null;
  const v = stream?.getVideoTracks()[0] ?? null;
  for (const tx of target.getTransceivers()) {
    const kind = tx.receiver?.track?.kind ?? tx.sender.track?.kind;
    if (kind === 'audio') await tx.sender.replaceTrack(a).catch(() => {});
    else if (kind === 'video') await tx.sender.replaceTrack(v).catch(() => {});
  }
}

const RESUME_COUNTDOWN_SEC = 5;

/** Cancel any in-flight resume countdown (call ended, re-held, or swapped away). */
function cancelResumeCountdown(): void {
  if (resumeCountdownTimer) clearInterval(resumeCountdownTimer);
  resumeCountdownTimer = null;
  resumeCountdown.value = null;
}

/** Cancel the peer-video resume countdown (spec 2013). */
function cancelPeerResumeCountdown(): void {
  if (peerResumeCountdownTimer) clearInterval(peerResumeCountdownTimer);
  peerResumeCountdownTimer = null;
  peerResumeCountdown.value = null;
}

/** (spec 2013) The MIRROR of beginResumeCountdown, shown to the party who RESUMED a held VIDEO call
 *  (the swapper): the other side runs its own "You'll be on camera…" heads-up before its camera goes
 *  live, so for ~5s the resumer just sees the peer's frozen frame. Show them a synchronized
 *  "{peer}'s video resumes in N…" countdown so the brief wait is understood. Informational only — it
 *  never gates media; the remote video appears when the peer's camera actually goes live. Audio calls
 *  have no video to wait for, so no countdown (consistent with spec 2012). */
function beginPeerResumeCountdown(kind: CallKind): void {
  cancelPeerResumeCountdown();
  if (kind !== 'video') return;
  let n = RESUME_COUNTDOWN_SEC;
  peerResumeCountdown.value = n;
  peerResumeCountdownTimer = setInterval(() => {
    n -= 1;
    if (n > 0) {
      peerResumeCountdown.value = n;
      return;
    }
    cancelPeerResumeCountdown();
  }, 1000);
}

/** The far side resumed a call they'd put us on hold. Their media unfreezes right away, but give
 *  US a 5s heads-up (visible countdown + a cue) before our camera/mic go live again, so we're not
 *  caught by surprise. Restores outgoing on `target` when the countdown hits zero — unless the
 *  call moved on (torn down, re-held, or swapped) in the meantime. */
function beginResumeCountdown(target: RTCPeerConnection): void {
  cancelResumeCountdown();
  // (spec 2012) The countdown is a heads-up before our CAMERA goes back live ("You'll be on
  // camera…"). On an audio call there is no camera, so the countdown is meaningless — resume the
  // (audio) outgoing immediately with no countdown. Video calls keep the heads-up.
  if (callMeta.value?.kind !== 'video') {
    if (pc === target && !remoteHeld.value && localStream.value) {
      void set1to1Senders(target, localStream.value);
    }
    return;
  }
  let n = RESUME_COUNTDOWN_SEC;
  resumeCountdown.value = n;
  callCue('resuming'); // audible "you're about to be back" notification
  resumeCountdownTimer = setInterval(() => {
    n -= 1;
    if (n > 0) {
      resumeCountdown.value = n;
      if (n === 2) callCue('resuming'); // sound again near the end so it re-grabs attention
      return;
    }
    cancelResumeCountdown();
    // Only actually go live if this is still the active, not-held call.
    if (pc === target && !remoteHeld.value && localStream.value) {
      void set1to1Senders(target, localStream.value);
    }
  }, 1000);
}

/** Whether the active call can be put on hold to take another (we're in a call and nothing is
 *  parked yet). NOTE: this is also `acceptAndHold`'s guard, so it MUST stay true while a second
 *  call is *being accepted* (incomingSecond set) — the "only one waiter" cap (spec 2009) is
 *  enforced at the prompt-raising site (`canRaiseSecondIncoming`), not here. */
export function canHoldIncoming(): boolean {
  return callState.value !== 'idle' && callState.value !== 'ended' && heldSlot === null;
}

/** Whether a NEW incoming call may be raised as the call-waiting prompt: there's room to hold the
 *  active call AND no other caller is already occupying the waiting slot. Once a second call is
 *  ringing/waiting (prompt shown, not yet accepted), a further caller falls through to the busy
 *  reply instead of stealing the pending prompt — at most one waiter at a time (spec 2009). */
function canRaiseSecondIncoming(): boolean {
  return canHoldIncoming() && incomingSecond.value === null;
}

/** Latest per-tile audio RMS for the active group call (tile key → level). Empty when
 *  not in a group call. Exposed for the e2e test hook to verify metering end-to-end. */
export function groupAudioLevels(): Record<string, number> {
  return groupSession?.audioLevels() ?? {};
}

/** Test/diagnostic: group-call video flow + per-leg tiers across the whole mesh (the 1:1
 *  inboundVideoFrames() can't see a mesh's per-peer connections). Empty when not in a group. */
export function groupCallDiag(): Promise<{
  inboundVideoFrames: number;
  tiers: Record<string, string>;
  legs: Record<string, { tier: string; requestedByPeer?: string; downlink: string; limitation?: string }>;
}> {
  return groupSession?.meshDiag() ?? Promise.resolve({ inboundVideoFrames: 0, tiers: {}, legs: {} });
}

let pendingOffer: { sdp: string; sdpType: RTCSdpType } | null = null;
const pendingIce: RTCIceCandidateInit[] = [];

/* ---- mutual-call (glare) resolution, spec 1039 ----
 * startDirectCall runs through several awaits (capture, PC build, offer send) before the
 * call state leaves 'idle'. A crossing offer from the SAME contact landing inside that
 * window is a mutual attempt and is resolved by handleOffer (services/call/glare) — which
 * repurposes the call slot. The in-flight startDirectCall must then stop touching shared
 * state, or it stamps 'dialing' (tones, navigation) over the call that replaced it and
 * both sides end up stranded on "Calling…". The token identifies the attempt that still
 * owns the slot; startDirectCall re-checks it after every await. */
let outgoingAttemptId: string | null = null;
// The current outgoing attempt's in-flight camera/mic capture. Kept so a glare yield can
// hand the ALREADY-CAPTURED stream to the auto-accept path instead of running a second
// concurrent getUserMedia (a documented WebKit mute trigger, bug 179363).
let pendingCapture: Promise<MediaStream> | null = null;
// callIds retired by glare resolution — the crossing offer we ignored (winner side) and
// our own yielded attempt. The relay retains sealed offers for recovery redelivery
// (spec 2012), so a late copy of these must be dropped, never rung. Session-scoped,
// size-capped (a stale entry is only ever a re-drop, never a lost call).
const glareDroppedCallIds = new Set<string>();
function rememberGlareDrop(callId: string): void {
  glareDroppedCallIds.add(callId);
  if (glareDroppedCallIds.size > 32) {
    const oldest = glareDroppedCallIds.values().next().value;
    if (oldest) glareDroppedCallIds.delete(oldest);
  }
}

/* ---- connect-milestone instrumentation (spec 2008, dev/test-only) -------------------------
 * Records ephemeral timestamps for the 1:1 connect path so the Playwright harness can assert the
 * ordering/overlap invariants (TURN warmed off the critical path; setup not serialized behind
 * media capture) and measure time-to-first-media. OFF (null) by default → a complete no-op in
 * production; the dev test hook flips it on. Holds only timestamps — never SDP/ICE/keys/media/
 * peer ids — and is never sent anywhere (FR-011). */
let connectMarks: Record<string, number> | null = null;
let connectRecording = false;
/** Dev hook: turn connect-milestone recording on/off (clears any in-progress record). */
export function recordConnect(on: boolean): void {
  connectRecording = on;
  connectMarks = on ? {} : null;
}
/** Dev hook: snapshot the current call's milestones (empty if not recording). */
export function connectMarksSnapshot(): Record<string, number> {
  return connectMarks ? { ...connectMarks } : {};
}
/** Begin a fresh milestone record for a new call leg (caller intent / incoming ring). No-op
 *  unless recording is enabled. */
function resetConnectMarks(): void {
  if (connectRecording) connectMarks = {};
}
/** Stamp a milestone once (write-once per call). No-op unless recording is enabled. */
function markConnect(name: string): void {
  if (connectRecording && connectMarks && connectMarks[name] === undefined) {
    connectMarks[name] = Date.now();
  }
}
let noAnswerTimer: ReturnType<typeof setTimeout> | null = null;
let dialTimer: ReturnType<typeof setTimeout> | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let durationTimer: ReturnType<typeof setInterval> | null = null;
let resumeCountdownTimer: ReturnType<typeof setInterval> | null = null;
let peerResumeCountdownTimer: ReturnType<typeof setInterval> | null = null; // spec 2013
let lastBytes = { up: 0, down: 0, ts: 0 };
let lastLoss = { lost: 0, recv: 0 };
// After a swap/resume the active connection changes, so the cumulative byte counters jump to a
// different PC's totals. Re-baseline on the next poll (emit no rate that tick) so we don't report
// the whole-call total as one second's "usage" (the spike the user saw after a resume).
let reprimeBytes = false;
let returnPath = '/tabs/calls';

const RING_TIMEOUT_MS = 60_000; // callee: auto-decline if unanswered (matches the ~60s push window)
const DIAL_TIMEOUT_MS = 60_000; // caller: give up if NO sign of reachability (~60s push window)
// Once the callee is confirmed reachable (call-ringing, e.g. its push was acked), give
// it a longer answer window so the caller doesn't hang up while the callee is still
// cold-starting the app from the push (which cancelled the ring the instant it opened).
const ANSWER_TIMEOUT_MS = 60_000;
const GRACE_MS = 18_000; // mid-call: tolerate a blip/handoff before ending (matches the server grace)

// Group calls: the set of OTHER participants that actually joined during the call
// (accumulated from call-roster frames), for the call log + Calls-tab record.
const groupJoined = new Set<string>();

// (spec 1030 US2) Join-cue bookkeeping: everyone already announced as "joined the
// call" this call, and whether the FIRST roster snapshot was consumed. Members in
// that first snapshot were here before us (or are us) — people we walked in on,
// not joiners — so they seed `announcedJoiners` silently; every LATER update cues
// each not-yet-announced member exactly once. A reconnect doesn't change room
// membership and a re-broadcast is deduped by the set, so neither re-fires
// (INV-4). Reset per call (enterGroupCall). joinCueLog is dev/e2e introspection.
const announcedJoiners = new Set<string>();
let joinCuePrimed = false;
const joinCueLog: string[] = [];

/** Dev/e2e: the userIds announced as "joined the call" this call, in order. */
export function joinCuesShown(): string[] {
  return [...joinCueLog];
}

/** "{name} joined the call" (spec 1030 US2): the name comes from the local
 *  contacts store, "Someone" for a non-contact — resolved on-device only (the
 *  server never sees a name; zero-knowledge). */
async function announceJoinCue(id: string): Promise<void> {
  let name = '';
  try {
    name = (await getContact(id))?.name ?? '';
  } catch {
    /* contact lookup failing must never break the roster update */
  }
  await toast(`${name || 'Someone'} joined the call`);
}

// Group calls (caller side): invitees we've stopped ringing — the ~30s reminder window
// elapsed without them joining. Their tile then offers recall (ring again) / remove. A
// per-member timer arms when we start ringing them and re-arms on a recall; it's cleared
// the moment they join. Caller-only (callees don't ring anyone).
export const notJoining = ref<Set<string>>(new Set());
// Group calls (caller side): invitees who replied "busy" — they're in another call and can't
// take ours. Their tile shows "Unavailable" (distinct from a silent non-joiner). Cleared if
// they later join (a free device picks up). Spec 0004 US2.
export const busyMembers = ref<Set<string>>(new Set());
const memberRingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MEMBER_RING_WINDOW_MS = 60_000; // matches the server's reminder window (groupRing*)

function markNotJoining(memberId: string, on: boolean): void {
  if (on === notJoining.value.has(memberId)) return;
  const next = new Set(notJoining.value);
  if (on) next.add(memberId);
  else next.delete(memberId);
  notJoining.value = next;
}
// Mark/unmark a member "busy" (non-overriding: cleared the moment they actually join, so a
// user busy on one device but answering on another still goes live).
function markMemberBusy(memberId: string, on: boolean): void {
  if (on === busyMembers.value.has(memberId)) return;
  const next = new Set(busyMembers.value);
  if (on) next.add(memberId);
  else next.delete(memberId);
  busyMembers.value = next;
}
function armMemberRingTimer(memberId: string): void {
  clearMemberRingTimer(memberId);
  memberRingTimers.set(
    memberId,
    setTimeout(() => {
      memberRingTimers.delete(memberId);
      const meta = callMeta.value;
      // Still invited and still not in the room → they're a non-joiner now.
      if (meta?.isGroup && (meta.invited ?? []).includes(memberId) && !meta.roster.includes(memberId)) {
        markNotJoining(memberId, true);
      }
    }, MEMBER_RING_WINDOW_MS),
  );
}
function clearMemberRingTimer(memberId: string): void {
  const t = memberRingTimers.get(memberId);
  if (t) clearTimeout(t);
  memberRingTimers.delete(memberId);
}
function clearAllMemberRingTimers(): void {
  for (const t of memberRingTimers.values()) clearTimeout(t);
  memberRingTimers.clear();
  if (notJoining.value.size) notJoining.value = new Set();
  if (busyMembers.value.size) busyMembers.value = new Set();
}


/* ---- helpers ---- */

function setState(s: CallState): void {
  const prev = callState.value;
  callState.value = s;
  // Audio cues for the meaningful state transitions (spec 0004 US5). 'ended' is cued from
  // teardown instead (so a silent/internal teardown stays silent).
  if (s !== prev) {
    if (s === 'connecting') callCue('connecting');
    else if (s === 'connected') callCue('connected');
  }
}

// After a call ends, the state lingers on 'ended' for a short display dwell (400ms, or 2s
// for the "Busy on another call" screen) before settling to 'idle'. That dwell is NOT being
// busy — so a user who hangs up and immediately places another call shouldn't be told
// "You're already in a call". Pre-empt the dwell here so starting a call from 'ended' just
// works. Returns true if there's a genuinely active call in the way (caller should bail).
function callBusyForNewOutgoing(): boolean {
  if (callState.value === 'ended') {
    setState('idle');
    callMeta.value = null;
  }
  return callState.value !== 'idle';
}

// In-call audio cues honour the "In-app sounds" / "Call sounds" preference, read once per
// call (default on). callCue is the gated, rate-limited entry the call flow uses.
let callSoundsOn = true;
export function callCue(name: ToneName): void {
  if (callSoundsOn) cue(name);
}
/** Read the per-call audio preferences (data-saver floor + call-sounds) once at call start. */
async function loadCallPrefs(): Promise<void> {
  const [lessData, sounds] = await Promise.all([
    getSetting<boolean>('storage.lessDataCalls', false),
    getSetting<boolean>('notifications.callSounds', true),
  ]);
  lessDataCalls = lessData;
  callSoundsOn = sounds;
}
// Camera mute recovery (iOS, esp. iPhone 8). On iOS a live camera track can briefly MUTE on an
// orientation/format reconfiguration; when it unmutes, the self-preview + encoder don't always pick
// the frames back up. (The iPhone 8's PERMANENT mute is prevented in the view by the always-rendered
// keep-alive <video> — WebKit bug 252465 / Apple Forums 667453.) We do NOT re-acquire on a stuck
// mute: a second getUserMedia is itself a documented mute trigger (WebKit bug 179363). So we only
// re-kick the preview + sender when the track unmutes.
let watchedCamTrack: MediaStreamTrack | null = null;

/** Hand the self-preview a FRESH MediaStream object so its <video> re-attaches + re-plays. iOS
 *  Safari doesn't reliably render a track that resumed after a mute, so reassigning the ref is the
 *  reliable kick. */
function forceSelfPreviewReattach(): void {
  const ls = localStream.value;
  if (ls) localStream.value = new MediaStream(ls.getTracks());
}

/** After a camera mute resolves, the iOS sender can stay idle — re-assert the (live) video track on
 *  the outgoing sender(s) to restart the encoder, without a second getUserMedia. */
async function reassertOutgoingVideo(): Promise<void> {
  const v = localStream.value?.getVideoTracks()[0];
  if (v && v.readyState === 'live' && !v.muted) await replaceOutgoingVideo(v).catch(() => {});
}

/** Reset the camera watcher for a fresh call (called from teardown). */
function resetCameraWatchdog(): void {
  watchedCamTrack = null;
}

/** Watch one local camera track: on unmute, kick the self-preview + sender so iOS resumes frames.
 *  Idempotent per track. */
function instrumentCamTrack(v: MediaStreamTrack): void {
  if (v === watchedCamTrack) return;
  watchedCamTrack = v;
  v.addEventListener('unmute', () => {
    // iOS resumed the track but the self-preview + encoder may not pick the frames back up — kick both.
    forceSelfPreviewReattach();
    void reassertOutgoingVideo();
  });
}

watch(localStream, (s) => {
  const v = s?.getVideoTracks()[0] ?? null;
  if (v) instrumentCamTrack(v);
});

// Cue "reconnecting" whenever the call enters the reconnecting state, from any of the
// several places that set the warning (1:1 ICE blip, group leg failure). The cue's own
// rate-limiter de-dupes if more than one fires at once.
watch(connectionWarning, (w, prev) => {
  if (w === 'Reconnecting…' && prev !== 'Reconnecting…') callCue('reconnecting');
});

// Call-waiting alert: a second call arriving while we're in one is easy to miss, so keep the cue
// going (every CALL_WAITING_REPEAT_MS) the whole time the prompt is up — not just once — and stop
// it however the prompt clears (accepted, declined, the caller gives up, or it times out). Gated
// by callCue, so it stays silent when "Call sounds" is off.
const CALL_WAITING_REPEAT_MS = 5000;
let callWaitingCueTimer: ReturnType<typeof setInterval> | null = null;
watch(incomingSecond, (inc) => {
  if (callWaitingCueTimer) {
    clearInterval(callWaitingCueTimer);
    callWaitingCueTimer = null;
  }
  if (inc) {
    callCue('callwaiting');
    callWaitingCueTimer = setInterval(() => callCue('callwaiting'), CALL_WAITING_REPEAT_MS);
  }
});

// The WebSocket came back (network restored, Wi-Fi↔cellular handoff). If we're in a live
// call, re-communicate with the backend right away so it cancels its grace eviction and the
// others reconnect smoothly: a group call re-affirms its room membership + re-gathers ICE; a
// 1:1 caller fires an ICE-restart offer. If the outage outlasted the grace window the call
// has already ended (server-side eviction + client grace), and we do NOT auto-redial.
watch(syncState, (s, prev) => {
  if (s !== 'online' || prev === 'online') return;
  if (callState.value !== 'connected' && callState.value !== 'connecting') return;
  if (groupSession) void groupSession.rejoin();
  else if (pc) void onIceFailed();
});

async function toast(message: string): Promise<void> {
  // Call-state notices ("Alice left the call", "This call is full", …) report something
  // that just happened and may name a person, so give them a little longer on screen than
  // a bare confirmation toast.
  await appToast({ message, duration: 3500 });
}

/** Camera constraints for every in-call getUserMedia (initial capture, camera flip, and
 *  the screen-share/hold restores — one helper so they can't drift apart, spec 2025).
 *
 *  iOS: DO NOT impose a resolution/orientation. On the A11/iOS-16.7 iPhone 8, naming any
 *  width/height makes WebKit start at the requested orientation, then flip to the
 *  perpendicular one and MUTE the track in the same instant — permanently (≈1fps, frozen
 *  self-view, black tile to the peer). It always flips AWAY from whatever we ask, so there
 *  is no "right" resolution to request; the only escape is to impose none and let WebKit
 *  open the sensor in its native format (which is also why iOS is NOT stuck at VGA). We
 *  still pin a frameRate ideal (cheap, doesn't drive the orientation flip).
 *
 *  Everywhere else: ask for 1280×720 `ideal` (spec 2025 FR-003). Chromium's unconstrained
 *  default is 640×480 — the single biggest reason Ring video read soft next to native
 *  apps on Android/desktop. `ideal` (never `exact`) so cameras without 720p still open. */
function videoConstraints(facing: 'user' | 'environment' = 'user'): MediaTrackConstraints {
  const base: MediaTrackConstraints = { facingMode: { ideal: facing }, frameRate: { ideal: 30 } };
  if (isIOS()) return base;
  return { ...base, width: { ideal: 1280 }, height: { ideal: 720 } };
}

function gumConstraints(kind: CallKind): MediaStreamConstraints {
  // Echo cancellation / noise suppression / AGC matter especially on loudspeaker
  // (the default for video calls), where open-air feedback would otherwise howl.
  return {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: kind === 'video' ? videoConstraints() : false,
  };
}

async function newPeerConnection(): Promise<RTCPeerConnection> {
  const turn = await getTurnConfig();
  const conn = new RTCPeerConnection(rtcConfig(turn));
  markConnect('pcCreated');

  conn.ontrack = (e) => {
    remoteStream.value = e.streams[0] ?? null;
    markConnect('firstRemoteMedia');
  };
  conn.onconnectionstatechange = () => {
    if (!pc) return;
    switch (pc.connectionState) {
      case 'connected':
        clearGrace();
        onConnected();
        break;
      case 'disconnected':
        // A transient blip, ICE often recovers on its own. Tell the user we're
        // reconnecting and start a grace timer rather than ending immediately.
        connectionWarning.value = 'Reconnecting…';
        startGrace();
        break;
      case 'failed':
        connectionWarning.value = 'Reconnecting…';
        void onIceFailed();
        break;
      case 'closed':
        void teardown('failed');
        break;
    }
  };
  return conn;
}

function startGrace(): void {
  if (graceTimer) return;
  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (callState.value === 'connected' || callState.value === 'connecting') void teardown('failed');
  }, GRACE_MS);
}

function clearGrace(): void {
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = null;
}

// ICE failed mid-call → start the grace countdown and, as the caller, attempt an
// ICE restart (a fresh offer the peer applies as a renegotiation).
async function onIceFailed(): Promise<void> {
  startGrace();
  const meta = callMeta.value;
  if (!pc || !meta || meta.isGroup || meta.direction !== 'outgoing' || !meta.chatId || !meta.peerUserId) {
    return;
  }
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    await sendSealedSignal('call-offer', meta.chatId, meta.peerUserId, meta.callId, {
      callId: meta.callId,
      type: 'offer',
      kind: meta.kind,
      sdp: offer.sdp,
      sdpType: offer.type,
    });
  } catch (e) {
    console.warn('[call] ICE restart failed', e);
  }
}

/** Wire trickle ICE → sealed call-ice frames for the current 1:1 peer. */
function wireIce(conn: RTCPeerConnection): void {
  const meta = callMeta.value;
  if (!meta?.chatId || !meta.peerUserId) return;
  const { chatId, peerUserId, callId } = meta;
  conn.onicecandidate = (e) => {
    if (!e.candidate) return;
    void sendSealedSignal('call-ice', chatId, peerUserId, callId, {
      callId,
      type: 'ice',
      candidate: e.candidate.toJSON(),
    });
  };
}

function addLocalTracks(conn: RTCPeerConnection, stream: MediaStream): void {
  for (const track of stream.getTracks()) conn.addTrack(track, stream);
}

/** Tell iOS (WebKit 16.4+) which audio session category to use.
 *  - 'play-and-record' is the voice-call category, which routes to the EARPIECE
 *    (receiver) by default instead of the loudspeaker (held-to-the-ear, like a
 *    phone call);
 *  - 'playback' biases toward the LOUDSPEAKER (our only web lever for an iOS
 *    speakerphone toggle — iOS exposes no output-device picker; see setIosSpeakerphone);
 *  - 'auto' restores normal media behaviour after a call.
 *  No-op where the API is absent (Chromium, older iOS). */
function applyAudioSession(type: 'play-and-record' | 'playback' | 'auto'): void {
  try {
    const as = (navigator as unknown as { audioSession?: { type?: string } }).audioSession;
    if (as) as.type = type;
  } catch {
    /* unsupported */
  }
}

/** iOS-only speakerphone state. iOS has no output-device API, so the only lever
 *  for earpiece-vs-loudspeaker from the web is the audio-session CATEGORY (above):
 *  'playback' → loudspeaker, 'play-and-record' → earpiece. This is a documented
 *  best-effort bias, not a hard route switch — a connected Bluetooth headset still
 *  takes OS priority over it. Exposed so the iOS audio-call UI can offer an honest
 *  speaker toggle (no toggle is shown on platforms where it would do nothing). */
export const iosSpeaker = ref(false);
export function setIosSpeakerphone(on: boolean): void {
  iosSpeaker.value = on;
  applyAudioSession(on ? 'playback' : 'play-and-record');
}

function onConnected(): void {
  clearGrace();
  clearDialTimer();
  connectionWarning.value = null; // recovered
  if (callState.value === 'connected') return; // reconnected after a blip
  setState('connected');
  stopLoopTone();
  const meta = callMeta.value;
  if (meta) meta.startedAt = Date.now();
  startTimers();
  applyAudioSession('play-and-record'); // iOS: prefer the earpiece (voice category)
  void initAudioRoute(); // enumerate outputs + pick this call's starting route
  void refreshCameraCount(); // decide whether to offer the flip-camera control
}

/** Count video input devices so the UI only shows the flip-camera button when there's
 *  a second camera to flip to (almost always true on phones, false on most laptops). */
async function refreshCameraCount(): Promise<void> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    hasMultipleCameras.value = devices.filter((d) => d.kind === 'videoinput').length > 1;
  } catch {
    hasMultipleCameras.value = false;
  }
}

function clearDialTimer(): void {
  if (dialTimer) clearTimeout(dialTimer);
  dialTimer = null;
}

/* ---- call-event markers (spec 1040) ----
 *
 * The caller/initiator sends sealed markers over the messaging ratchet so a
 * callee whose app is closed for the whole ring still gets a NAMED notification
 * (the SW previews the queued marker; the push tickle stays content-free) and a
 * missed-call trace on next open. `ring` goes out during the ring; `ended`
 * settles the outcome exactly once per callee. Everything is fire-and-forget —
 * markers must never block or fail call setup.
 *
 * OFF THE HOT PATH: a marker seal shares the per-chat session lock with the
 * live call signalling (offer/answer/trickle-ICE all open under the same
 * withSessionLock), so sending one during connection setup serializes with the
 * ICE burst — harmless on a fast machine, connect-breaking on a starved CI
 * runner. Ring markers therefore fire on a DELAYED timer (2.5s — far inside
 * the 60s ring window the closed-device preview needs), and outcomes settle
 * either after the call is over (teardown/yield) or a beat after answer. An
 * attempt that ends before its timer sends the ring+ended pair AT settle time
 * instead (the call is over; there is no hot path left to disturb). */

const RING_MARKER_DELAY_MS = 2_500;

/* ---- consent-gated merge (spec 1041) ----
 *
 * The callee may INVITE the party behind a waiting or held call into the
 * ongoing call; nothing joins anyone without their explicit accept (the old
 * merge sent a bare `joinroom`, which auto-joined the still-dialing caller —
 * the consent hole). Rules live in the pure module (call/join-request.ts);
 * this is the per-call stateful glue. Everything below dies with the call. */

// Callee side: the ongoing call's request ledger (roomId pre-minted for a 1:1
// so promotion on accept lands both sides in the same room), plus the sealed
// channel (chatId) each requested party is reachable on.
let joinRequests: JoinRequestState | null = null;
const joinRequestChats = new Map<string, string>(); // partyId → 1:1 chatId
// Reactive mirror of the ledger for the UI/testhooks (Maps/Sets inside a
// module `let` aren't reactive): bumped on every ledger change.
export const joinRequestVersion = ref(0);
const touchJoinRequests = (): void => void (joinRequestVersion.value += 1);

// Accepter side: the consent prompt raised by an inbound join request over
// our own dialing/held call. Null when nothing is being asked.
export const joinRequestPrompt = ref<{
  from: string; // who is asking (their name resolves in the UI)
  chatId: string; // the sealed channel the reply goes back on
  callId: string; // OUR attempt/held call the request targets
  roomId: string;
  roomKind: CallKind; // the ongoing call's kind (prompt copy only)
} | null>(null);

/** The join-request ledger for the CURRENT ongoing call (created on demand;
 *  the roomId is pre-minted for a 1:1 so a rejection never strands a room). */
function joinRequestState(): JoinRequestState | null {
  const meta = callMeta.value;
  if (!meta) return null;
  if (!joinRequests) joinRequests = createJoinRequests(meta.isGroup ? (meta.roomId ?? meta.callId) : uid());
  return joinRequests;
}

/** May the user send `partyId` a join request right now? (UI + testhook gate:
 *  capacity, no outstanding request, and no rejection this call — FR-008/009.) */
export function canRequestJoin(partyId: string): boolean {
  void joinRequestVersion.value; // reactive dependency
  const meta = callMeta.value;
  if (!meta) return false;
  const self = getSelfUserId() ?? '';
  const capacityOk = canAdd(meta.kind, meta.roster, meta.invited ?? [], self, 1).ok;
  const s = joinRequests;
  return s ? jrCanRequest(s, partyId, capacityOk) : capacityOk;
}

/** Is a request to `partyId` outstanding? (Drives the "Invited" button state.) */
export function joinRequestPendingFor(partyId: string): boolean {
  void joinRequestVersion.value;
  return joinRequests?.pending.has(partyId) ?? false;
}

/** The waiting/held party answered our request. */
async function handleJoinReply(partyId: string, verdict: 'joinreq-accept' | 'joinreq-reject'): Promise<void> {
  const s = joinRequests;
  if (!s || !s.pending.has(partyId)) return; // stale/duplicate reply
  if (verdict === 'joinreq-reject') {
    jrReject(s, partyId);
    touchJoinRequests();
    const name = (await getContact(partyId))?.name?.split(' ')[0] ?? 'They';
    void toast(`${name} will wait on the line`);
    return;
  }
  jrAccept(s, partyId);
  touchJoinRequests();
  // They are joining s.roomId themselves (their device converts on accept).
  // Our side: promote a 1:1 into that SAME room if needed, then track them as
  // an invitee tile until their mesh leg lands (existing join semantics).
  await withAddInFlight(async () => {
    await ensureActiveIsRoom(s.roomId);
    const meta = callMeta.value;
    if (!meta?.isGroup) return;
    if (!(meta.invited ?? []).includes(partyId)) meta.invited = [...(meta.invited ?? []), partyId];
    markNotJoining(partyId, false);
    armMemberRingTimer(partyId);
  });
  // Their old 1:1 leg to us dissolves as they convert: clear whichever slot
  // held them (the waiting prompt, or the held call).
  if (incomingSecond.value?.from === partyId) {
    incomingSecond.value = null;
    secondIce = [];
  }
  if (heldSlot && heldSlot.meta.peerUserId === partyId) freeHeldSlot();
}

/** The waiting attempt died (their cancel/end, or our decline): forget any
 *  outstanding request silently — their prompt died with their attempt. */
function clearJoinRequestFor(partyId: string | undefined): void {
  if (!partyId || !joinRequests) return;
  jrClearParty(joinRequests, partyId);
  joinRequestChats.delete(partyId);
  touchJoinRequests();
}

/** Same, keyed by the dead attempt's callId (a cancel can arrive after the
 *  waiting prompt already self-dropped, when only the ledger still knows). */
function clearJoinRequestByCallId(callId: string | undefined): void {
  const s = joinRequests;
  if (!callId || !s) return;
  for (const [partyId, id] of s.pending) {
    if (id === callId) {
      clearJoinRequestFor(partyId);
      return;
    }
  }
}

/** Ongoing call over: withdraw every outstanding request (FR-014) and drop the
 *  ledger (rejection-final is scoped to the call, FR-011). */
function teardownJoinRequests(): void {
  const s = joinRequests;
  joinRequests = null;
  joinRequestPrompt.value = null; // an accepter's own call ending drops the prompt too
  if (s) {
    for (const { partyId, callId } of jrDrainPending(s)) {
      const chatId = joinRequestChats.get(partyId);
      if (chatId) void sendJoinRequestCancel(chatId, partyId, callId, s.roomId);
    }
  }
  joinRequestChats.clear();
  touchJoinRequests();
}

// 1:1: pending delayed ring sends, which callIds actually sent one, and which
// already settled their outcome.
const ringMarkerTimers = new Map<string, ReturnType<typeof setTimeout>>();
const callEventRingSent = new Set<string>();
const callEventOutcomeSent = new Set<string>();
// Group: the per-instance marker id (the roomId is REUSED across calls, so it
// can't dedup one call) plus per-member rung/outcome ledgers. Created lazily by
// whoever rings members (initiator, or a participant adding someone later).
const groupCallEvents = new Map<string, { instanceId: string; kind: CallKind; rung: Set<string>; outcome: Set<string> }>();

/** Schedule the 1:1 dial-time ring marker: fires only while the attempt is
 *  still unanswered (a call that connected fast needs no ring marker — the
 *  callee answered it live; their other devices retire via the answered
 *  settle). */
function scheduleRingMarker(meta: CallMeta): void {
  const { callId, kind, peerUserId } = meta;
  if (!peerUserId) return;
  const timer = setTimeout(() => {
    ringMarkerTimers.delete(callId);
    const cur = callMeta.value;
    const stillRinging =
      cur?.callId === callId && !cur.tornDown && callState.value !== 'connected' && callState.value !== 'connecting';
    if (!stillRinging || callEventOutcomeSent.has(callId)) return;
    callEventRingSent.add(callId);
    void sendCallEvent(peerUserId, buildRingEvent(callId, kind, Date.now()));
  }, RING_MARKER_DELAY_MS);
  ringMarkerTimers.set(callId, timer);
}

/** Settle the 1:1 marker for an outgoing attempt (at most once per call). If
 *  the delayed ring marker never fired but the callee's devices were pushed
 *  the ring anyway (a fast cancel), sends the ring+ended pair now — the call
 *  is over, so there is no hot path to protect. */
function settleDirectCallEvent(meta: CallMeta, outcome: 'missed' | 'cancelled' | 'answered'): void {
  if (meta.isGroup || meta.direction !== 'outgoing' || !meta.peerUserId) return;
  if (callEventOutcomeSent.has(meta.callId)) return;
  const timer = ringMarkerTimers.get(meta.callId);
  if (timer) {
    clearTimeout(timer);
    ringMarkerTimers.delete(meta.callId);
  }
  callEventOutcomeSent.add(meta.callId);
  const rung = callEventRingSent.has(meta.callId);
  if (!rung && (outcome === 'missed' || outcome === 'cancelled')) {
    // The server pushed the callee's devices the moment we dialed; give their
    // closed devices the trace even though the delayed ring marker never fired.
    callEventRingSent.add(meta.callId);
    void sendCallEvent(meta.peerUserId, buildRingEvent(meta.callId, meta.kind, Date.now()));
  }
  // 'answered' without a prior ring marker still sends the bare ended frame:
  // it retires the stale ring notification + badge unit on closed devices.
  void sendCallEvent(meta.peerUserId, buildEndedEvent(meta.callId, meta.kind, outcome, Date.now()));
}

/** The marker state for a room we're ringing people into (created on demand). */
function groupCallEventState(roomId: string, kind: CallKind): { instanceId: string; kind: CallKind; rung: Set<string>; outcome: Set<string> } {
  let g = groupCallEvents.get(roomId);
  if (!g) {
    g = { instanceId: uid(), kind, rung: new Set(), outcome: new Set() };
    groupCallEvents.set(roomId, g);
  }
  return g;
}

/** Ring-marker one group invitee (initial ring, recall, or mid-call add) — on
 *  the same delayed timer as the 1:1 marker, and only while they haven't
 *  joined. A recall clears any earlier outcome so the fresh ring settles again. */
function ringGroupCallEvent(roomId: string, kind: CallKind, memberId: string): void {
  const g = groupCallEventState(roomId, kind);
  g.outcome.delete(memberId);
  setTimeout(() => {
    const meta = callMeta.value;
    const live = meta?.isGroup && (meta.roomId ?? meta.callId) === roomId && !meta.tornDown;
    if (!live || g.outcome.has(memberId) || meta.roster.includes(memberId)) return;
    g.rung.add(memberId);
    void sendCallEvent(memberId, buildRingEvent(g.instanceId, g.kind, Date.now(), roomId));
  }, RING_MARKER_DELAY_MS);
}

/** Settle one group invitee's marker (at most once per member per ring). */
function settleGroupCallEvent(roomId: string, memberId: string, outcome: 'missed' | 'cancelled' | 'answered'): void {
  const g = groupCallEvents.get(roomId);
  if (!g || g.outcome.has(memberId)) return;
  g.outcome.add(memberId);
  const rung = g.rung.has(memberId);
  if (!rung && (outcome === 'missed' || outcome === 'cancelled')) {
    g.rung.add(memberId);
    void sendCallEvent(memberId, buildRingEvent(g.instanceId, g.kind, Date.now(), roomId));
  }
  void sendCallEvent(memberId, buildEndedEvent(g.instanceId, g.kind, outcome, Date.now(), roomId));
}

/** Caller-side give-up: after `ms` with no answer, play the no-answer cue, tell the
 *  callee to stop ringing, and end. Armed short while only dialing, then re-armed to a
 *  longer window once the callee proves reachable (call-ringing). */
function armDialTimeout(peerUserId: string, callId: string, ms: number): void {
  clearDialTimer();
  dialTimer = setTimeout(() => {
    if (callState.value === 'dialing' || callState.value === 'remote-ringing') {
      stopLoopTone();
      playTone('noanswer');
      void sendControl('call-cancel', peerUserId, callId, { reason: 'timeout' });
      void teardown('timeout');
    }
  }, ms);
}

/** Active (talk) time of a call in seconds, EXCLUDING any time it spent on hold (call waiting).
 *  Delegates to the pure `duration` module; each call carries its own counters on its CallMeta,
 *  so two concurrent calls report distinct durations. */
function callDurationSec(meta: CallMeta | null): number {
  return activeDurationSec(meta, Date.now());
}

/** Bank the current active stint and stop the clock — called when a call goes on hold so held
 *  time isn't counted as call duration. */
function bankActiveTime(meta: CallMeta | null): void {
  if (meta) bankActive(meta, Date.now());
}

/** (Re)start the active clock for a call becoming active (connect or resume). */
function resumeActiveTime(meta: CallMeta | null): void {
  if (meta) startActive(meta, Date.now());
}

function startTimers(): void {
  stopTimers();
  durationTimer = setInterval(() => {
    // Read the CURRENT active call's meta each tick (not a captured start) so after a swap the
    // duration reflects the now-active call, and held time is excluded.
    callStats.value = { ...callStats.value, durationSec: callDurationSec(callMeta.value) };
  }, 1000);
  lastBytes = { up: 0, down: 0, ts: Date.now() };
  reprimeBytes = false;
  lastLoss = { lost: 0, recv: 0 };
  statsTimer = setInterval(() => void pollStats(), 1000);
}

function stopTimers(): void {
  if (durationTimer) clearInterval(durationTimer);
  if (statsTimer) clearInterval(statsTimer);
  durationTimer = statsTimer = null;
}

async function pollStats(): Promise<void> {
  // Use whichever connection is active (1:1 pc, or the mesh session for group).
  const getStats = pc ? pc.getStats() : groupSession ? groupSession.stats() : null;
  if (!getStats) return;
  let up = 0;
  let down = 0;
  let lost = 0;
  let recv = 0;
  // For the 1:1 ⓘ diagnostics line (spec 2011): the negotiated codec + round-trip time, read from
  // the SAME local getStats — no new data leaves the device.
  const codecs = new Map<string, string>();
  let outCodecId: string | undefined;
  let rtt: number | undefined;
  try {
    const report = await getStats;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    report.forEach((s: any) => {
      if (s.type === 'codec') codecs.set(s.id, String(s.mimeType || '').replace(/^(audio|video)\//, ''));
      if (s.type === 'outbound-rtp' && typeof s.bytesSent === 'number') {
        up += s.bytesSent;
        if (s.kind === 'video' || !outCodecId) outCodecId = s.codecId; // prefer the video codec
      }
      if (s.type === 'inbound-rtp') {
        if (typeof s.bytesReceived === 'number') down += s.bytesReceived;
        if (typeof s.packetsLost === 'number') lost += s.packetsLost;
        if (typeof s.packetsReceived === 'number') recv += s.packetsReceived;
      }
      if (s.type === 'remote-inbound-rtp' && typeof s.roundTripTime === 'number') rtt = s.roundTripTime;
    });
    // 1:1 adaptive outgoing quality (spec 0004 US4): the group path adapts per-leg inside
    // MeshSession; the 1:1 PC adapts here off the same sample — every SECOND 1s tick, the
    // ~2s cadence the controller's streak constants were tuned for (spec 2025 FR-007).
    adaptTick += 1;
    if (pc && adaptTick % 2 === 0) await adaptOneToOne(report);
  } catch {
    return;
  }
  const now = Date.now();
  // First sample after a swap/resume: the active PC (and its cumulative counters) just changed,
  // so re-baseline against this PC's totals and report no rate this tick — otherwise the delta is
  // "all bytes this PC ever sent" reported as one second of usage.
  if (reprimeBytes) {
    reprimeBytes = false;
    lastBytes = { up, down, ts: now };
    lastLoss = { lost, recv }; // re-baseline loss too, else the new PC's totals read as a loss spike
    callStats.value = { ...callStats.value, kBpsUp: 0, kBpsDown: 0 };
    return;
  }
  const dt = (now - lastBytes.ts) / 1000 || 1;
  // bytes/sec ÷ 1000 = KB/s (decimal kilobytes), rounded to one decimal.
  const toKBps = (delta: number): number => Math.max(0, Math.round((delta / dt / 1000) * 10) / 10);
  const kBpsUp = toKBps(up - lastBytes.up);
  const kBpsDown = toKBps(down - lastBytes.down);
  lastBytes = { up, down, ts: now };
  callStats.value = { ...callStats.value, kBpsUp, kBpsDown };

  // Packet loss over this interval → "Connection unstable" (with hysteresis so it
  // doesn't flicker). Never overrides the stronger 'Reconnecting…' state.
  const dLost = Math.max(0, lost - lastLoss.lost);
  const dRecv = Math.max(0, recv - lastLoss.recv);
  lastLoss = { lost, recv };
  const lossRatio = dLost + dRecv > 0 ? dLost / (dLost + dRecv) : 0;
  if (connectionWarning.value !== 'Reconnecting…') {
    if (lossRatio > 0.08) connectionWarning.value = 'Connection unstable';
    else if (lossRatio < 0.03) connectionWarning.value = null;
  }

  // Feed the ⓘ call-diag panel for a 1:1 call (spec 2011). The mesh owns the snapshot for group
  // calls (setDiagSnapshot in mesh.ts), so only set it when this is a 1:1 PC and there's no group
  // session — otherwise the panel sat at "collecting…" on 1:1 calls. Client-local getStats only.
  if (pc && !groupSession) {
    const codec = (outCodecId && codecs.get(outCodecId)) || '?';
    const rttMs = rtt != null ? `${Math.round(rtt * 1000)}ms` : '–';
    const kind = callMeta.value?.kind === 'video' ? 'video' : 'audio';
    setDiagSnapshot([
      `1:1 ${kind} · ${codec} · tier=${oneToOneQc.tier} · ${pc.connectionState}`,
      `↑${kBpsUp} ↓${kBpsDown} KB/s · rtt=${rttMs} · loss=${(lossRatio * 100).toFixed(1)}%`,
    ]);
  }
}

function clearRingTimeout(): void {
  if (noAnswerTimer) clearTimeout(noAnswerTimer);
  noAnswerTimer = null;
}

async function drainPendingIce(): Promise<void> {
  if (!pc) return;
  for (const c of pendingIce.splice(0)) {
    try {
      await pc.addIceCandidate(c);
    } catch {
      /* a stale/duplicate candidate is harmless */
    }
  }
}

function navigateToCall(): void {
  const cur = router.currentRoute.value.fullPath;
  if (cur !== '/call-active') {
    returnPath = cur.startsWith('/call-active') ? '/tabs/calls' : cur;
    void router.push('/call-active');
  }
}

// How recently the app must have started for an incoming call to count as "opened for this
// call" (a cold start / notification tap), vs. one arriving while you've been using the app.
const APP_OPENED_FOR_CALL_MS = 8000;
const appStartedAt = Date.now();
let pendingIncomingForeground = false;

/** Decide how an incoming call is presented (spec 0004 call UX): full-screen when the call is
 *  *why* you're opening the app — backgrounded (show it the moment you foreground) or a cold
 *  start / notification tap (show it now). When you're already actively in the app, leave the
 *  non-intrusive banner (IncomingCallOverlay) to handle it. */
function presentIncoming(): void {
  const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
  if (hidden) {
    // Arrived while backgrounded → open the full-screen view as soon as the app comes forward.
    pendingIncomingForeground = true;
    armIncomingForegroundNav();
  } else if (Date.now() - appStartedAt < APP_OPENED_FOR_CALL_MS) {
    // App was just opened (cold start / tapped the call notification) → straight to full screen.
    navigateToCall();
  }
  // else: actively in the app → the banner handles it (less intrusive), unchanged.
}

function armIncomingForegroundNav(): void {
  if (typeof document === 'undefined') return;
  const onVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onVisible);
    // Only if still ringing for the same call (the caller may have given up while we were away).
    if (pendingIncomingForeground && callState.value === 'incoming') navigateToCall();
    pendingIncomingForeground = false;
  };
  document.addEventListener('visibilitychange', onVisible);
}

/** Tear everything down and reset to idle. Logs the call result locally. */
export async function teardown(reason: EndReason, opts?: { silent?: boolean }): Promise<void> {
  // Idempotency: tear down + log each call exactly once even if several end-signals
  // race (a remote call-end AND the PC closing, a timeout AND a reject, ...). The flag
  // lives on the per-call CallMeta object and is set synchronously here, before any
  // await, so a concurrent second teardown returns. (A per-callId guard would be wrong:
  // group calls reuse the roomId as their callId across calls.)
  const ending = callMeta.value;
  if (ending) {
    if (ending.tornDown) return;
    ending.tornDown = true;
  }
  clearRingTimeout();
  clearDialTimer();
  clearGrace();
  clearGroupIdleTimeout();
  stopTimers();
  stopLoopTone();

  // (spec 1039) Retire the outgoing-attempt token so an in-flight startDirectCall stops
  // mutating shared state, and release an unclaimed in-flight capture (the camera would
  // otherwise stay live if teardown won the race against getUserMedia resolving).
  outgoingAttemptId = null;
  if (pendingCapture) {
    void pendingCapture.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
    pendingCapture = null;
  }

  const meta = callMeta.value;
  const wasConnected = callState.value === 'connected';
  // Total bytes moved this call (sent + received), from the last stats sample.
  const totalBytes = lastBytes.up + lastBytes.down;

  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.getSenders().forEach((s) => s.track?.stop());
    try {
      pc.close();
    } catch {
      /* already closed */
    }
    pc = null;
  }
  if (groupSession) {
    groupSession.leave();
    groupSession = null;
  }
  localStream.value?.getTracks().forEach((t) => t.stop());
  localStream.value = null;
  remoteStream.value = null;
  remoteStreams.value = [];
  groupStreamOwners.value = {};
  activeSpeakers.value = [];
  pendingOffer = null;
  pendingIce.length = 0;
  muted.value = false;
  cameraOff.value = false;
  cameraFacing.value = 'user';
  screenSharing.value = false;
  hasMultipleCameras.value = false;
  videoQuality.value = 'auto';
  lessDataCalls = false;
  oneToOneQc = initialController('high'); // next 1:1 call starts sharp again (spec 2025)
  oneToOneVideoSuspended = false; // the paused-by-adaptation flag never outlives its call
  adaptTick = 0;
  // spec 0007: reset 1:1 connection-health state so the next call starts clean.
  oneToOneDownlink = 'hd';
  oneToOneHealthSeq = 0;
  oneToOneLastSentTier = null;
  oneToOneLastSentAt = 0;
  oneToOnePeerReq = null;
  inPrevLost = 0;
  inPrevRecv = 0;
  inPrevFramesDropped = 0;
  inPrevFramesReceived = 0;
  pendingIncomingForeground = false;
  upgradePending.value = false;
  upgradeRequest.value = false;
  activeScreenTrack?.stop();
  activeScreenTrack = null;
  screenAddedVideo = false;
  routeInitialized = false; // next call re-applies its kind/BT default route
  lastManualRouteAt = 0; // don't carry a manual-override window into the next call
  iosSpeaker.value = false; // next call starts on the earpiece category again
  applyAudioSession('auto'); // iOS: release the voice audio category

  // Persist the outcome to local call history (Calls tab) AND a local-only
  // informational row in the chat (1:1 or group). Each side logs its own. Internal
  // teardowns (answered-elsewhere, glare) pass silent → no user-facing log.
  if (meta) {
    // Talk time only — banked active stints + the current one, excluding any time on hold.
    const durationSec = wasConnected ? callDurationSec(meta) : 0;
    const video = meta.kind === 'video';
    // Why an unanswered call ended, for a clearer log than "No answer": the peer was busy in
    // another call, unreachable, or declined (spec 0004 US2/FR-031). Only for calls that
    // never connected.
    const callOutcome: 'busy' | 'unavailable' | 'declined' | undefined =
      !wasConnected && (reason === 'busy' || reason === 'unavailable' || reason === 'declined')
        ? reason
        : undefined;
    // 1:1 Calls-tab record.
    if (!meta.isGroup) {
      if (wasConnected) await finishCall(meta.callId, durationSec, totalBytes);
      else await markCallMissed(meta.callId, callOutcome);
    }
    if (!opts?.silent) {
      if (meta.isGroup) {
        const joinedIds = [...groupJoined];
        const missed = joinedIds.length === 0; // nobody else joined → "no answer"
        // Resolve to display names (snapshot) so the log/row need no async lookup.
        const participants = await Promise.all(
          joinedIds.map(async (id) => (await getContact(id))?.name ?? id.slice(0, 8)),
        );
        await recordGroupCall({
          roomId: meta.roomId ?? meta.callId,
          name: meta.name,
          avatar: meta.avatar,
          direction: meta.direction,
          video,
          durationSec,
          participants,
          missed,
        });
        if (meta.roomId) {
          await logCallToChat(meta.roomId, {
            direction: meta.direction,
            video,
            missed,
            durationSec: missed ? undefined : durationSec,
            isGroup: true,
            participants,
          });
        }
      } else if (meta.chatId) {
        await logCallToChat(meta.chatId, {
          direction: meta.direction,
          video,
          missed: !wasConnected, // unanswered either way (text differs by direction)
          outcome: callOutcome, // busy/unavailable/declined → clearer than "No answer"
          durationSec: wasConnected ? durationSec : undefined,
        });
      }
    }
    // (spec 1040) Settle the outgoing markers. 1:1: rang out → missed, we gave up
    // before an answer → cancelled, everything else (answered, declined, busy,
    // glare, answered-elsewhere) → handled, so the callee gets no false missed
    // trace. Group: invitees whose ring we never saw settle (join/no-answer) get
    // "cancelled" — the call ended before they ever picked up.
    if (!meta.isGroup) {
      settleDirectCallEvent(
        meta,
        wasConnected ? 'answered' : reason === 'timeout' ? 'missed' : reason === 'hangup' ? 'cancelled' : 'answered',
      );
      callEventRingSent.delete(meta.callId);
      callEventOutcomeSent.delete(meta.callId);
    } else {
      const gRoomId = meta.roomId ?? meta.callId;
      if (groupCallEvents.has(gRoomId)) {
        for (const id of meta.invited ?? []) settleGroupCallEvent(gRoomId, id, 'cancelled');
        groupCallEvents.delete(gRoomId);
      }
    }
    meta.endedReason = reason;
  }
  // (spec 1041) Withdraw outstanding join requests and drop the ledger — the
  // rejection block is scoped to the call that just ended (FR-011/FR-014).
  teardownJoinRequests();
  groupJoined.clear();
  clearAllMemberRingTimers();

  // Call waiting (spec 0005): if a call is parked on hold, the active call ending means RETURN
  // to the held one — resume it as the new active rather than going idle. Covers hanging up,
  // a busy/unavailable result, AND a remote end of the active call; otherwise the held call
  // would be stranded (the bug where the second call's hangup dropped everything).
  if (heldSlot) {
    await restoreHeldCall();
    return;
  }

  setState('ended');
  cancelResumeCountdown();
  cancelPeerResumeCountdown(); // spec 2013
  resetCameraWatchdog();
  // Clear ALL call-waiting display state so a hung-up call can't leak its "on hold" UI into the
  // next call (the reported bug: a device that was on hold kept remoteHeld=true after the call
  // dropped, so the next call opened showing the hold overlay).
  remoteQueued.value = false;
  remoteHeld.value = false;
  groupHeldPeers.value = [];
  heldCall.value = null;
  incomingSecond.value = null;
  callStats.value = { durationSec: 0, kBpsUp: 0, kBpsDown: 0 };
  setDiagSnapshot([]); // spec 2011: drop the 1:1 ⓘ line so it doesn't linger into the next call
  connectionWarning.value = null;

  // Reaching a busy peer holds the full-screen "Busy on another call" (with its own cue)
  // briefly before returning to where the call was placed from, instead of vanishing
  // instantly (spec 0004 US2). Other endings settle quickly as before.
  const busy = reason === 'busy';
  const dwellMs = busy ? 2000 : 400;

  // Tell the surviving party why the call ended, when it wasn't a clean hangup.
  if (!opts?.silent) {
    callCue(busy ? 'busy' : 'callended'); // audio cue for the ending (spec 0004 US5)
    if (reason === 'failed') {
      void toast(wasConnected ? 'Call ended, connection lost' : "Couldn't connect the call");
    } else if (reason === 'unavailable') {
      void toast('Unavailable, couldn’t reach them');
    }
  }

  if (!opts?.silent && router.currentRoute.value.fullPath === '/call-active') {
    // Busy: keep the "Busy on another call" screen up for the dwell, then return.
    if (busy) {
      setTimeout(() => {
        if (router.currentRoute.value.fullPath === '/call-active') void router.replace(returnPath);
      }, dwellMs);
    } else {
      void router.replace(returnPath);
    }
  }

  // Settle back to idle so the next call can start (after the dwell, so the busy screen's
  // endedReason survives long enough to show).
  setTimeout(() => {
    if (callState.value === 'ended') {
      setState('idle');
      callMeta.value = null;
    }
  }, dwellMs);
}

/* ---- outgoing (1:1) ---- */

/** Place a 1:1 call to a contact (peer user id). */
export async function startDirectCall(contactId: string, kind: CallKind): Promise<void> {
  if (callBusyForNewOutgoing()) {
    await toast('You’re already in a call');
    return;
  }
  const contact = await getContact(contactId);
  if (!contact) return;
  const chatId = await sessionChatIdForPeer(contact); // may be a hidden 1:1 (knock-knock, spec 1027)
  const callId = uid();

  callMeta.value = {
    callId,
    isGroup: false,
    kind,
    direction: 'outgoing',
    peerUserId: contactId,
    chatId,
    roster: [contactId],
    name: contact.name,
    avatar: contact.avatar,
  };
  // (spec 1039) This attempt owns the call slot until it's answered, torn down, or a
  // mutual-call resolution yields it. Everything below re-checks after each await.
  outgoingAttemptId = callId;
  const attemptAlive = (): boolean =>
    outgoingAttemptId === callId && callMeta.value?.callId === callId && !callMeta.value?.tornDown;

  await createCall({ callId, contactId, direction: 'outgoing', video: kind === 'video' });
  await loadCallPrefs(); // data-saver floor + call-sounds pref, read once for this call
  if (!attemptAlive()) return; // yielded to a mutual call while we set up (spec 1039)

  // Fast-connect (spec 2008): warm the TURN credential cache OFF the critical path before we
  // await getUserMedia, so the fetch overlaps camera/mic capture and `newPeerConnection` finds it
  // cached instead of blocking on a cold network round-trip (the slow first-call path).
  resetConnectMarks();
  markConnect('callStart');
  markConnect('turnWarmStart');
  warmTurnConfig();

  let stream: MediaStream;
  const capture = navigator.mediaDevices.getUserMedia(gumConstraints(kind));
  pendingCapture = capture;
  try {
    markConnect('gumStart');
    stream = await capture;
    markConnect('gumResolved');
  } catch (err) {
    if (pendingCapture === capture) pendingCapture = null;
    if (!attemptAlive()) return; // slot already repurposed; nothing of ours to tear down
    // The call can't start without local media. Tell the caller WHY (blocked permission,
    // no device, in use) rather than the bare "Couldn't connect the call" — the usual
    // Android cause is the app's mic (or camera) permission being off at the OS level. Pass
    // silent so teardown doesn't ALSO fire its generic notice over this specific one.
    await appToast({ message: describeMediaError(err, kind === 'video' ? 'media' : 'microphone'), duration: 4000 });
    await teardown('failed', { silent: true });
    return;
  }
  if (!attemptAlive()) {
    // The slot was repurposed while we were capturing. A glare yield CLAIMS the capture
    // (sets pendingCapture to null / its own) to reuse it for the auto-accept; if it's
    // still ours, nothing claimed it — release the camera/mic instead of leaking it live.
    if (pendingCapture === capture) {
      pendingCapture = null;
      stream.getTracks().forEach((t) => t.stop());
    }
    return;
  }
  localStream.value = stream;

  try {
    const conn = await newPeerConnection();
    if (!attemptAlive()) {
      try {
        conn.close();
      } catch {
        /* already closed */
      }
      return;
    }
    pc = conn;
    wireIce(pc);
    addLocalTracks(pc, stream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sent = await sendSealedSignal('call-offer', chatId, contactId, callId, {
      callId,
      type: 'offer',
      kind,
      sdp: offer.sdp,
      sdpType: offer.type,
    });
    markConnect('offerSent');
    if (!attemptAlive()) return; // our offer may still cross; the winner ignores it (glare)
    if (!sent) {
      console.warn('[call] offer not sent (no session or offline)');
      await teardown('unavailable');
      return;
    }
  } catch (e) {
    if (!attemptAlive()) return;
    console.warn('[call] startDirectCall failed', e);
    await teardown('failed');
    return;
  }

  setState('dialing');
  startLoopTone('calling', 2800); // "calling" ringback (not yet ringing)
  // (spec 1040) Dial-time marker: lets the callee's closed device NAME this ring
  // and guarantees a missed-call trace even if we die mid-ring. Scheduled off
  // the connect-critical window (see the marker section above).
  if (callMeta.value) scheduleRingMarker(callMeta.value);
  // Caller-side timeout: the server may be buffering the offer for an offline
  // (push-woken) callee, so we can't rely on a fast "unavailable", give up
  // ourselves if nobody answers.
  armDialTimeout(contactId, callId, DIAL_TIMEOUT_MS);
  navigateToCall();
}

/* ---- group (mesh) ---- */

/** Start a group call for a group chat (roomId == group chat id). `members` are the
 *  group participants the server should ring (the initiator supplies them since the
 *  server has no group object). */
export async function startGroupCall(
  roomId: string,
  kind: CallKind,
  name: string,
  avatar: string,
  members: string[] = [],
): Promise<void> {
  if (callBusyForNewOutgoing()) {
    await toast('You’re already in a call');
    return;
  }
  await enterGroupCall(roomId, kind, name, avatar, 'outgoing', members);
}

/** Start a group call that isn't backed by a group chat: mint a fresh room and ring the
 *  chosen contacts directly. The room has no chat, so the callees' ring falls back to a
 *  generic "Group call" (handleGroupInvite) and nothing is logged to a chat — only the
 *  Calls-tab record. Members who aren't each other's contacts are introduced for the
 *  duration of the call (mesh + same-room key gate); the mesh fills in as each one joins. */
export async function startAdHocGroupCall(
  members: string[],
  kind: CallKind,
  name: string,
): Promise<void> {
  if (!members.length) return;
  const roomId = uid(); // a fresh room, deliberately NOT a chat id
  await startGroupCall(roomId, kind, name || 'Group call', groupAvatar(roomId), members);
}

/** Shared group-call entry: build + start the mesh session and wire its callbacks.
 *  `members` non-empty (initiator) rings the group; empty (joiner) just joins. */
async function enterGroupCall(
  roomId: string,
  kind: CallKind,
  name: string,
  avatar: string,
  direction: 'incoming' | 'outgoing',
  members: string[] = [],
  existingStream?: MediaStream, // call waiting: reuse the camera/mic when this is the 2nd call
): Promise<void> {
  callMeta.value = {
    callId: roomId,
    isGroup: true,
    kind,
    direction,
    roomId,
    roster: [],
    // The initiator supplies the members it's ringing; they show as "ringing" tiles until
    // they join. A callee passes none here (it learns the set at invite time — see
    // handleGroupInvite), so its invited list is seeded there.
    invited: members.length ? [...members] : callMeta.value?.invited,
    name,
    avatar,
  };
  setState('connecting');
  // (spec 1030 US2) Fresh join-cue bookkeeping for this call: nobody announced yet,
  // and the first roster snapshot we receive seeds (not cues) the announced set.
  announcedJoiners.clear();
  joinCuePrimed = false;
  joinCueLog.length = 0;
  // Start the per-invitee give-up timers so a member who never joins flips to the
  // recall/remove tile after the reminder window. EVERY participant arms these (not just the
  // initiator) so anyone in the call can ring a no-show again or remove them (spec 0004): a
  // joiner inherits the invited set via callMeta.invited, so it knows who's still expected.
  for (const m of callMeta.value?.invited ?? []) armMemberRingTimer(m);
  // Read the per-call audio prefs once (data-saver floor for the adaptive tier + call-sounds).
  await loadCallPrefs();

  groupSession = new MeshSession(
    roomId,
    kind,
    {
      onLocalStream: (s) => (localStream.value = s),
      onRemoteStreams: (s) => {
        remoteStreams.value = s;
        // More/fewer video publishers → re-pick the adaptive outbound tier.
        void applyOutgoingQuality();
      },
      onStreamMap: (m) => (groupStreamOwners.value = m),
      onActiveSpeakers: (keys) => (activeSpeakers.value = keys),
      onHeldPeers: (ids) => (groupHeldPeers.value = ids),
      onConnectionState: (st) => {
        if (st === 'connected') {
          clearGrace();
          connectionWarning.value = null;
          onConnected();
        } else if (st === 'disconnected') {
          // Transient relay blip, tolerate it under a grace window, like 1:1, rather
          // than ending the whole group call on the first hiccup.
          connectionWarning.value = 'Reconnecting…';
          startGrace();
        } else if (st === 'failed') {
          connectionWarning.value = 'Reconnecting…';
          void onGroupIceFailed();
        }
      },
    },
    members,
  );

  try {
    await groupSession.start(existingStream);
  } catch (e) {
    console.warn('[call] group start failed', e);
    await teardown('failed');
    return;
  }
  // (spec 1040) Ring markers for the invitees, under a fresh per-instance id
  // (the roomId is reused across calls). Their closed devices name the ring
  // from these; outcomes settle per member as the call progresses.
  if (direction === 'outgoing') for (const m of members) ringGroupCallEvent(roomId, kind, m);
  armGroupIdleTimeout(); // end the call if nobody joins within the grace window
  navigateToCall();
}

/** A friendly title for a group call from its participant ids: the contact names we know,
 *  with "& N other(s)" for any we don't (an ad-hoc call may include non-contacts). Falls
 *  back to "Group call" when we recognise nobody. Derived locally from ids — the server
 *  never sees a title, so no profile data leaks (zero-knowledge). */
async function deriveGroupCallTitle(ids: string[]): Promise<string> {
  const names: string[] = [];
  let unknown = 0;
  for (const id of ids) {
    const c = await getContact(id);
    if (c?.name) names.push(c.name);
    else unknown++;
  }
  if (names.length === 0) return 'Group call';
  const parts = [...names];
  if (unknown > 0) parts.push(unknown === 1 ? '1 other' : `${unknown} others`);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} & ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`;
}

/** An incoming group-call invite (server fan-out) → ring locally so the user can join. */
async function handleGroupInvite(frame: Extract<CallFrame, { t: 'call-group-invite' }>): Promise<void> {
  const roomId = frame.roomId;
  if (!roomId || !frame.from) return;
  // (spec 1040) This device is handling the ring live (full ring, second-call
  // prompt, or busy auto-decline below) — the live flows own the call trace, so
  // any queued call-event marker for this room must stay silent.
  void markGroupRingSeenLive(roomId);
  // Already ringing/connected for this room → ignore duplicate invites.
  if (callMeta.value?.roomId === roomId) return;
  // Already prompting for this room in the waiting slot → a server re-ring; keep the prompt.
  if (incomingSecond.value?.roomId === roomId) return;
  if (callState.value !== 'idle') {
    // (spec 1030 US3) In a call: a group invite used to be auto-busied — silently
    // declined with no way to combine the calls. Now, when the single waiting slot
    // is free, it's raised as the second-incoming prompt (Add to call / Accept &
    // hold / Decline), like a direct second caller. The busy fallback remains for
    // a taken slot (spec 2009: at most one waiter) or a locked device.
    if (canRaiseSecondIncoming() && isUnlockedNow()) {
      await presentSecondGroup(frame, roomId);
    } else {
      void sendGroupBusy(frame.from, roomId);
    }
    return;
  }
  if (!isUnlockedNow()) return; // locked → can't decrypt the sealed signalling; skip the ring

  // Everyone we were told about: the initiator plus their named members (which already
  // includes us), minus ourselves. Drives both the friendly title and the "ringing" tiles
  // for people still being rung.
  const self = getSelfUserId() ?? '';
  const participants = [...new Set([frame.from, ...(frame.members ?? [])])].filter((id) => id && id !== self);

  // A real group chat lends its name/avatar; an ad-hoc room has none, so derive a title
  // from the people involved (server stays blind to it).
  const chat = await getChat(roomId);
  callMeta.value = {
    callId: roomId,
    isGroup: true,
    kind: frame.kind ?? 'audio',
    direction: 'incoming',
    roomId,
    // The invite-time set (incl. self) drives the ring's consent line; replaced by the live
    // roster once we join.
    roster: [...new Set([frame.from, ...(frame.members ?? [])])],
    invited: participants,
    // Spec 1027 knock-knock (FR-013, supersedes 1019 FR-019): a live incoming
    // call ALWAYS rings with full identity — you must be able to decide and
    // answer. Hiding governs at-rest surfaces (list, history), never the ring.
    name: chat?.name || (await deriveGroupCallTitle(participants)),
    avatar: chat?.avatar || groupAvatar(roomId),
  };
  setState('incoming');
  presentIncoming(); // full-screen if the app is being opened for this call; else the banner
  startLoopTone('beacon', 2000);
  clearRingTimeout();
  noAnswerTimer = setTimeout(() => {
    // Letting an unanswered group invite lapse also tells the server to stop re-ringing us
    // (spec 0004 US1), the same as an explicit decline.
    void sendGroupLeave(roomId);
    void teardown('timeout');
  }, RING_TIMEOUT_MS);
}

/** A group invite arriving while we're in a call and the waiting slot is free (spec 1030
 *  US3): stash it as the second-incoming prompt — offering Add to call (fold it into the
 *  current call), Accept & hold, or Decline — instead of the old silent auto-busy.
 *  Mirrors presentSecondDirect; the call-waiting cue rides the incomingSecond watcher. */
async function presentSecondGroup(
  frame: Extract<CallFrame, { t: 'call-group-invite' }>,
  roomId: string,
): Promise<void> {
  const from = frame.from ?? '';
  const self = getSelfUserId() ?? '';
  // The invite's people (initiator + named members, minus ourselves): the fold's
  // ring list and the prompt's title source.
  const participants = [...new Set([from, ...(frame.members ?? [])])].filter((id) => id && id !== self);
  const chat = await getChat(roomId);
  incomingSecond.value = {
    kind: 'group',
    callId: roomId,
    from,
    roomId,
    name: chat?.name || (await deriveGroupCallTitle(participants)),
    avatar: chat?.avatar || groupAvatar(roomId),
    callKind: frame.kind ?? 'audio',
    members: participants,
  };
  // If unanswered within the ring window, drop the prompt and stop the server's
  // re-ring of us (same as letting a foreground group invite lapse).
  setTimeout(() => {
    if (incomingSecond.value?.roomId === roomId) {
      incomingSecond.value = null;
      void sendGroupLeave(roomId);
    }
  }, RING_TIMEOUT_MS);
}

/**
 * Fold the pending second incoming GROUP INVITE into the current call (spec 1030,
 * US3) — "Add to call" for a whole group. Gated on the combined DISTINCT headcount
 * (a member already in/ringing in our call counts once — FR-007); then a 1:1 is
 * promoted first if needed, the invite's not-yet-present members are rung into OUR
 * room (they consent by answering, exactly like add-people), and we leave the
 * invite's own room so we're never in two rooms at once (FR-008, INV-5). When the
 * fold wouldn't fit the cap it's blocked with the kind-specific reason and BOTH
 * calls stay exactly as they were (the prompt is kept so Hold/Decline still work).
 */
export async function mergeGroupInvite(): Promise<void> {
  const inc = incomingSecond.value;
  if (!inc || inc.kind !== 'group' || !inc.roomId) return;
  const meta = callMeta.value;
  if (!meta || callState.value === 'idle') return;
  const self = getSelfUserId() ?? '';
  // Distinct newcomers = the invite's members not already in (or ringing into) our
  // call; on a 1:1 the roster already carries the peer, so the math is uniform.
  const present = new Set([self, ...meta.roster, ...(meta.invited ?? [])]);
  const newcomers = [...new Set(inc.members ?? [])].filter((id) => id && !present.has(id));
  const gate = canAdd(meta.kind, meta.roster, meta.invited ?? [], self, newcomers.length);
  if (!gate.ok) {
    await toast(gate.reason);
    return; // both calls unchanged; the invite stays in the waiting slot
  }
  const inviteRoomId = inc.roomId;
  incomingSecond.value = null;
  // The promote+ring section holds the add-in-flight guard so a swap/park can't
  // interleave with the conversion (spec 1030 FR-010).
  await withAddInFlight(async () => {
    await ensureActiveIsRoom(); // promote a 1:1 first (no-op if already a room)
    const m = callMeta.value;
    if (!m?.isGroup || !m.roomId) return;
    const plan = planInvite(m.kind, m.roster, m.invited ?? [], self, newcomers);
    for (const id of plan.toRing) {
      m.invited = [...(m.invited ?? []), id];
      markNotJoining(id, false);
      armMemberRingTimer(id);
      await sendRecall(id, m.roomId, m.kind, m.invited);
      ringGroupCallEvent(m.roomId, m.kind, id); // spec 1040: named ring + trace for their closed devices
    }
  });
  // Leave the invite's own room: we fold people into OUR call, we don't join theirs
  // (and the server stops re-ringing us for it).
  void sendGroupLeave(inviteRoomId);
}

/** Accept the current incoming GROUP call → join the room (no members → no re-ring). */
export async function acceptGroupCall(): Promise<void> {
  const meta = callMeta.value;
  if (callState.value !== 'incoming' || !meta?.isGroup || !meta.roomId) return;
  clearRingTimeout();
  stopLoopTone();
  await enterGroupCall(meta.roomId, meta.kind, meta.name, meta.avatar, 'incoming');
}

/** Tap "Ring again" on a non-joiner's tile → re-ring them and put the tile back to "ringing".
 *  ANY participant may recall (spec 0004): the server re-rings and broadcasts the new state to
 *  the whole room, so every tile flips together — not just the initiator's. */
export async function recallMember(memberId: string): Promise<void> {
  const meta = callMeta.value;
  if (!meta?.isGroup || !meta.roomId) return;
  markNotJoining(memberId, false);
  armMemberRingTimer(memberId);
  await sendRecall(memberId, meta.roomId, meta.kind, meta.invited ?? []);
  ringGroupCallEvent(meta.roomId, meta.kind, memberId); // spec 1040: fresh ring marker on recall
}

/** Free participant slots left in the ACTIVE call for its kind (spec 1028) — 0 when
 *  there is no active call. Drives the Add-people gate (picker disables past this). */
export function callRemainingSlots(): number {
  const meta = callMeta.value;
  if (!meta) return 0;
  return remainingSlots(meta.kind, meta.roster, meta.invited ?? [], getSelfUserId() ?? '');
}

/**
 * Detach the current 1:1 PeerConnection and re-enter as a mesh ROOM, REUSING the
 * live capture (spec 1028). Closes the 1:1 pc WITHOUT stopping the shared
 * mic/cam tracks (the mesh takes them over — one capture per device, SC-006) and
 * marks the old CallMeta torn down so a late 1:1 end-signal can't kill the room.
 */
async function convertActiveToRoom(
  roomId: string,
  kind: CallKind,
  name: string,
  avatar: string,
  direction: 'incoming' | 'outgoing',
): Promise<void> {
  const stream = localStream.value ?? undefined;
  // (spec 1030 US1/T008) A VIDEO 1:1 being folded into an AUDIO room: drop the live
  // camera track before entering, so the merged caller joins audio-only — in an
  // audio-kind room video is strictly per-participant OPT-IN via the normal control
  // (a camera-carrying join would publish video the room's kind doesn't reflect and
  // desync the self-view state). The camera is one tap away again once inside.
  if (kind === 'audio' && stream?.getVideoTracks().length) {
    setLocalVideoTrack(null, true);
    cameraOff.value = false; // reset the toggle state for the (audio) room
  }
  const prevPeer = callMeta.value?.peerUserId; // the 1:1 peer who will follow us in
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      /* already closed */
    }
    pc = null;
  }
  pendingOffer = null;
  pendingIce.length = 0;
  remoteStream.value = null;
  remoteHeld.value = false;
  reprimeBytes = true; // re-baseline byte counters against the new mesh session
  if (callMeta.value) callMeta.value.tornDown = true; // the old 1:1 meta is retired
  await enterGroupCall(roomId, kind, name, avatar, direction, [], stream);
  // (spec 1030 US2) The 1:1 peer following us into the promoted room isn't a new
  // arrival — they were already in the call — so seed them as announced (no
  // "joined the call" cue for the promotion itself). Safe against a fast follow:
  // a roster frame is a WS macrotask, so it can't land between enterGroupCall
  // resolving and this line.
  if (prevPeer) announcedJoiners.add(prevPeer);
}

/**
 * Promote the ACTIVE 1:1 into a mesh room (spec 1028, R2). Idempotent when the
 * active call is already a group. Mints a room, tells the existing peer to follow
 * via a sealed `joinroom`, then converts our own side (reusing the capture). The
 * peer's `joinroom` handler auto-joins the same room, and the mesh rebuilds the
 * pair leg the same way a late joiner already does — no live-PC migration.
 */
async function ensureActiveIsRoom(fixedRoomId?: string): Promise<void> {
  const meta = callMeta.value;
  if (!meta || meta.isGroup) return; // already a room (or no call)
  if (!meta.peerUserId || !meta.chatId) return;
  // (spec 1041) A consent-gated merge pre-mints the roomId at request time and
  // promotes only on accept — pass it here so both sides land in the SAME room.
  const roomId = fixedRoomId ?? uid();
  await sendJoinRoom(meta.chatId, meta.peerUserId, meta.callId, roomId, meta.kind);
  const title = await deriveGroupCallTitle([meta.peerUserId]);
  await convertActiveToRoom(roomId, meta.kind, title, groupAvatar(roomId), 'outgoing');
}

/**
 * Add people to the ACTIVE call (spec 1028, US2). If the active call is a 1:1 it
 * is first promoted into a mesh room (both sides reuse their capture); then each
 * fresh, capacity-fitting id is rung into the room via the existing in-room
 * `call-ring` seam (same as recallMember), and the roster/leg machinery meshes
 * them on accept. The cap is enforced pre-emptively here (planInvite clamps +
 * canAdd reason) with the server `JoinIfRoom` as the authoritative backstop.
 */
export async function addPeople(ids: string[]): Promise<void> {
  if (!callMeta.value || callState.value === 'idle') return;
  // The whole promote+ring section holds the add-in-flight guard so a swap/park
  // can't interleave with the conversion (spec 1030 FR-010).
  const dropped = await withAddInFlight(async () => {
    await ensureActiveIsRoom(); // promote a 1:1 first (no-op if already a room)
    const meta = callMeta.value;
    if (!meta?.isGroup || !meta.roomId) return [];
    const self = getSelfUserId() ?? '';
    const plan = planInvite(meta.kind, meta.roster, meta.invited ?? [], self, ids);
    for (const id of plan.toRing) {
      meta.invited = [...(meta.invited ?? []), id];
      markNotJoining(id, false);
      armMemberRingTimer(id);
      await sendRecall(id, meta.roomId, meta.kind, meta.invited);
      ringGroupCallEvent(meta.roomId, meta.kind, id); // spec 1040: named ring + trace for their closed devices
    }
    return plan.dropped;
  });
  // Anyone who didn't fit the cap → tell the user why (kind-specific copy).
  if (dropped.length) {
    const meta = callMeta.value;
    const self = getSelfUserId() ?? '';
    const gate = meta ? canAdd(meta.kind, meta.roster, meta.invited ?? [], self, 1) : { ok: true as const };
    await toast(gate.ok ? 'Some people are already in the call' : gate.reason);
  }
}

/** Tap "Remove from call" on a non-joiner's tile → stop ringing them, drop them from the
 *  invited set, and tell their device to stop. ANY participant may remove; the server then
 *  broadcasts the removal so everyone's tile disappears together. */
export async function cancelInvite(memberId: string): Promise<void> {
  const meta = callMeta.value;
  if (!meta?.isGroup || !meta.roomId) return;
  clearMemberRingTimer(memberId);
  markNotJoining(memberId, false);
  meta.invited = (meta.invited ?? []).filter((id) => id !== memberId);
  await sendGroupInviteeCancel(memberId, meta.roomId);
}

// ICE failed for a group leg: start the grace countdown and rebuild the mesh
// (re-join/recover). Only if grace expires without recovery do we end the call.
async function onGroupIceFailed(): Promise<void> {
  startGrace();
  const gs = groupSession;
  if (!gs) return;
  try {
    await gs.recover();
  } catch (e) {
    console.warn('[call] group ICE recovery failed', e);
  }
}

// Lone-in-the-room timeout: a group call where nobody else joins ends after a grace
// window (the group-call analogue of the 1:1 dial timeout), instead of hanging.
// A live `let` ONLY so the dev/e2e harness can shrink it (like setCallCapsForTest) to
// exercise the promotion-timeout path (spec 1030 US5) in seconds; production never
// calls the setter, so it stays 60s.
let GROUP_NOBODY_MS = 60_000;

/** Dev/e2e only: shrink the lone-in-the-room timeout. Never called in production. */
export function setGroupIdleMsForTest(ms: number): void {
  GROUP_NOBODY_MS = ms;
}
let groupIdleTimer: ReturnType<typeof setTimeout> | null = null;
function armGroupIdleTimeout(): void {
  if (groupIdleTimer) return; // already counting down
  groupIdleTimer = setTimeout(() => {
    groupIdleTimer = null;
    const self = getSelfUserId() ?? '';
    const others = (callMeta.value?.roster ?? []).filter((id) => id !== self).length;
    if (callMeta.value?.isGroup && others === 0) {
      void toast('No one joined the call');
      void teardown('timeout');
    }
  }, GROUP_NOBODY_MS);
}
function clearGroupIdleTimeout(): void {
  if (groupIdleTimer) clearTimeout(groupIdleTimer);
  groupIdleTimer = null;
}

/* ---- incoming (1:1) ---- */

async function handleOffer(frame: Extract<CallFrame, { t: 'call-offer' }>): Promise<void> {
  const from = frame.from;
  if (!from || !frame.callId) return;

  // (spec 2012) Duplicate incoming invite: the relay now retains the sealed offer and may re-deliver
  // it (the recovery path — e.g. after the callee reconnects following a reload). If we're already
  // ringing for this same callId, don't raise a second incoming screen.
  if (callState.value === 'incoming' && callMeta.value?.callId === frame.callId) return;

  // (spec 1039) An offer already retired by mutual-call resolution (the crossing offer we
  // ignored as winner, or our own yielded attempt) may be redelivered late by the same
  // retention path — drop it; it must never raise a ring.
  if (glareDroppedCallIds.has(frame.callId)) return;

  // Renegotiation of an in-progress call (e.g. the peer's ICE restart): same
  // call + peer and we're already connected/connecting → apply as offer/answer,
  // don't raise a new incoming call.
  const cur = callMeta.value;
  if (
    pc &&
    cur &&
    cur.callId === frame.callId &&
    cur.peerUserId === from &&
    cur.chatId &&
    (callState.value === 'connected' || callState.value === 'connecting')
  ) {
    const signal = await openSealedSignal(cur.chatId, frame.ciphertext);
    if (signal?.type === 'offer' && signal.sdp) {
      try {
        await pc.setRemoteDescription({ type: signal.sdpType ?? 'offer', sdp: signal.sdp });
        await drainPendingIce();
        // A renegotiation may carry a DOWNGRADE to audio (the peer dropped video for
        // the call). Mirror it: remove our video too + go to the earpiece, so neither
        // side is left showing a dead video tile. UPGRADES (audio->video) never arrive
        // as a raw renegotiation; they go through the consent flow (call-upgrade-*).
        if (signal.kind === 'audio' && cur.kind === 'video') {
          cur.kind = 'audio';
          const vsender = videoSender();
          if (vsender) {
            vsender.track?.stop();
            await vsender.replaceTrack(null);
          }
          setLocalVideoTrack(null, true);
          if (audioRoute.value !== 'bluetooth') await setRoute('earpiece');
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSealedSignal('call-answer', cur.chatId, from, cur.callId, {
          callId: cur.callId,
          type: 'answer',
          sdp: answer.sdp,
          sdpType: answer.type,
        });
      } catch (e) {
        console.warn('[call] renegotiation failed', e);
      }
    }
    return;
  }

  // Can't decrypt the SDP behind the passcode gate → tell the caller we're busy.
  if (!isUnlockedNow()) {
    void sendControl('call-busy', from, frame.callId);
    return;
  }

  // Mutual call — glare (spec 1039): they called us while we have an UNANSWERED outgoing
  // attempt at them. Detected via callMeta, which startDirectCall sets synchronously — NOT
  // via callState, which only leaves 'idle' after capture + PC build + offer send. Mutual
  // taps usually land inside that setup window, and missing them here is what used to
  // clobber the slot and strand BOTH sides on "Calling…". Runs before the per-chat-mute
  // gate below: a mutual attempt is not an unsolicited ring — this user just placed a
  // call at that very contact.
  const unanswered =
    callState.value === 'idle' || callState.value === 'dialing' || callState.value === 'remote-ringing';
  const role = glareRole(getSelfUserId() ?? '', from, callMeta.value, unanswered);
  if (role === 'win') {
    // Our attempt survives (deterministic id tie-break, same on both sides). Their
    // crossing offer dies here — they auto-answer OURS instead.
    rememberGlareDrop(frame.callId);
    return;
  }
  if (role === 'yield') {
    await yieldToMutualCall(frame, from);
    return;
  }

  // Busy gate: `callMeta` (not just callState) so an offer from a THIRD party landing in
  // an outgoing call's setup window gets the normal busy/call-waiting treatment instead of
  // falling through and corrupting the call being placed (spec 1039 FR-006).
  if (callState.value !== 'idle' || callMeta.value) {
    if (canRaiseSecondIncoming()) {
      // Call waiting (spec 0005): a held slot is free AND no one is already waiting → offer
      // Accept & hold instead of busy. The waiting-slot check (spec 2009) stops a later caller
      // from stealing the place of one already in the prompt.
      await presentSecondDirect(frame, from);
      return;
    }
    void sendControl('call-busy', from, frame.callId);
    return;
  }

  let contact = await getContact(from);
  if (!contact) {
    await addContactWithId(from, '');
    contact = await getContact(from);
  }
  if (!contact) return;
  const chatId = await sessionChatIdForPeer(contact); // may be a hidden 1:1 (knock-knock, spec 1027)

  // Per-chat call mute (spec 1015 FR-022a): a muted or web-push-off chat silences
  // its incoming calls too. The caller/chat is resolvable here (the app is live), so
  // this is the HARD guarantee — don't ring on this device (no overlay, no tone);
  // the caller's own no-answer timeout ends it as a normal missed call. (A fully
  // closed app's SW path can't resolve the caller from the content-free tickle, so
  // it fail-opens and rings — see sw.ts.)
  const offerChat = await getChat(chatId);
  if ((offerChat?.mutedUntil && offerChat.mutedUntil > Date.now()) || offerChat?.notifyWebPush === false) {
    return;
  }

  const signal = await openSealedSignal(chatId, frame.ciphertext);
  if (!signal || signal.type !== 'offer' || !signal.sdp) {
    console.warn('[call] incoming offer could not be opened', { hasSignal: !!signal });
    return;
  }

  await ringForOffer(frame.callId, from, contact, chatId, signal);
}

/** Stage an incoming 1:1 offer into the (free) call slot and ring for it. Shared by the
 *  normal incoming path above and the mismatched-kind mutual-call fallback (spec 1039),
 *  which must ring WITHOUT re-running the per-chat-mute gate. */
async function ringForOffer(
  callId: string,
  from: string,
  contact: { name: string; avatar: string },
  chatId: string,
  signal: CallSignal,
): Promise<void> {
  const kind: CallKind = signal.kind ?? 'audio';
  callMeta.value = {
    callId,
    isGroup: false,
    kind,
    direction: 'incoming',
    peerUserId: from,
    chatId,
    roster: [from],
    // Spec 1027 knock-knock (FR-013, supersedes 1019 FR-019): full caller
    // identity on the ring, always — hiding never suppresses a live call.
    name: contact.name,
    avatar: contact.avatar,
  };
  pendingOffer = { sdp: signal.sdp!, sdpType: signal.sdpType ?? 'offer' };
  await createCall({ callId, contactId: from, direction: 'incoming', video: kind === 'video' });

  // Fast-connect (spec 2008): warm the TURN cache NOW, during the ring, so accepting doesn't pay a
  // cold fetch. Network/SDP prep only — NO camera/mic capture before the user accepts (Principle
  // IX). Begins the callee's connect-milestone record (continued in acceptCall, no reset there).
  resetConnectMarks();
  markConnect('ringStart');
  markConnect('turnWarmStart');
  warmTurnConfig();

  setState('incoming');
  presentIncoming(); // full-screen if the app is being opened for this call; else the banner
  startLoopTone('beacon', 2000);
  void sendControl('call-ringing', from, callId);

  clearRingTimeout();
  noAnswerTimer = setTimeout(() => {
    void sendControl('call-end', from, callId, { reason: 'timeout' });
    void teardown('timeout');
  }, RING_TIMEOUT_MS);
}

/** Mutual-call resolution, yielding side (spec 1039): we placed a call at `from` and their
 *  offer crossed ours — the id tie-break says THEIR attempt survives. Abandon ours
 *  surgically (no teardown: the slot is reused in the same breath) and join theirs —
 *  automatically when the kinds match (both people already asked for exactly this call),
 *  via a normal ring when they differ (never auto-enable media this user didn't ask for,
 *  FR-004). */
async function yieldToMutualCall(frame: Extract<CallFrame, { t: 'call-offer' }>, from: string): Promise<void> {
  const mine = callMeta.value;
  if (!mine || mine.tornDown) return;

  // Resolve + open the surviving offer FIRST — its kind picks auto-accept vs ring, and if
  // it can't be opened we keep our own attempt (losing both calls would be worse).
  let contact = await getContact(from);
  if (!contact) {
    await addContactWithId(from, '');
    contact = await getContact(from);
  }
  if (!contact) return;
  const chatId = await sessionChatIdForPeer(contact); // may be a hidden 1:1 (knock-knock, spec 1027)
  const signal = await openSealedSignal(chatId, frame.ciphertext);
  if (!signal || signal.type !== 'offer' || !signal.sdp) return;
  // The slot may have moved on while we awaited (our attempt answered, torn down, or an
  // earlier copy of this offer already resolved the glare) — re-check before acting on it.
  if (callMeta.value !== mine || mine.tornDown) return;
  const offerKind: CallKind = signal.kind ?? 'audio';
  const mode = yieldMode(mine.kind, offerKind);

  // Abandon OUR attempt. No teardown(): it would stop shared media, log the call, cue
  // "ended", and settle the state we're about to reuse. Surgical steps instead:
  const abandonedId = mine.callId;
  outgoingAttemptId = null; // the in-flight startDirectCall stops at its next token check
  mine.tornDown = true; // and any racing teardown of the old attempt becomes a no-op
  rememberGlareDrop(abandonedId); // a late redelivery of our own offer must not ring
  clearDialTimer();
  clearRingTimeout();
  stopLoopTone();
  // Withdraw our offer so the relay drops its retained copy and any of the winner's other
  // devices stop ringing for it (same control a dial-timeout give-up sends).
  void sendControl('call-cancel', from, abandonedId, { reason: 'answered-elsewhere' });
  // (spec 1040) Settle the abandoned attempt's call-event marker as handled: the yield
  // skips teardown (the settle choke point), and an unsettled ring marker would
  // reconcile on the WINNER's device into a phantom missed call ~a ring window after
  // every mutual call. Deferred past the auto-accept's answer seal (same session lock).
  setTimeout(() => {
    settleDirectCallEvent(mine, 'answered');
    callEventRingSent.delete(abandonedId);
    callEventOutcomeSent.delete(abandonedId);
  }, RING_MARKER_DELAY_MS);
  // FR-007: the abandoned attempt must not surface as a separate unanswered call — the
  // encounter is logged once, by the surviving call's incoming record below.
  void deleteCalls([abandonedId]);

  // Claim our attempt's media (captured or still capturing) before dismantling: same-kind
  // auto-accept reuses it — a second concurrent getUserMedia is a WebKit mute trigger
  // (bug 179363) — and on a mismatch it must be released, not leaked live.
  const media: Promise<MediaStream> | MediaStream | null = pendingCapture ?? localStream.value;
  pendingCapture = null;
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      /* already closed */
    }
    pc = null;
  }
  localStream.value = null;
  pendingIce.length = 0;
  oneToOneVideoSuspended = false; // the abandoned attempt's PC is gone; flag dies with it
  const reuse = mode === 'auto-accept' && media != null;
  if (!reuse && media) {
    void Promise.resolve(media)
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => {});
  }

  if (mode === 'ring') {
    // Kinds differ: present the surviving call as a normal incoming ring (the established
    // consent surface). Deliberately NOT re-running the per-chat-mute gate: a mutual
    // attempt is solicited — this user just called that contact themselves.
    await ringForOffer(frame.callId, from, contact, chatId, signal);
    return;
  }

  // Same kind: connect without ringing. The state flows dialing → connecting → connected,
  // so the caller's "calling" cue transitions straight into the call (FR-008) — the
  // incoming ringtone never plays and no incoming UI is raised.
  callMeta.value = {
    callId: frame.callId,
    isGroup: false,
    kind: offerKind,
    direction: 'incoming',
    peerUserId: from,
    chatId,
    roster: [from],
    name: contact.name,
    avatar: contact.avatar,
  };
  pendingOffer = { sdp: signal.sdp, sdpType: signal.sdpType ?? 'offer' };
  await createCall({ callId: frame.callId, contactId: from, direction: 'incoming', video: offerKind === 'video' });
  resetConnectMarks();
  markConnect('ringStart');
  markConnect('turnWarmStart');
  warmTurnConfig();
  await acceptIncoming({ media: media ?? undefined, auto: true });
}

/** Accept the current incoming call (branches to the group path for a group ring).
 *  Parameterless on purpose — it's bound straight to @click handlers. */
export async function acceptCall(): Promise<void> {
  return acceptIncoming();
}

/** The accept flow. `opts` is the mutual-call auto-accept path (spec 1039): `auto` joins
 *  without the slot ever having rung (callState never reached 'incoming'), and `media`
 *  hands over the yielded attempt's already-captured stream so no second concurrent
 *  getUserMedia runs (WebKit mute hazard, bug 179363). */
async function acceptIncoming(opts?: { media?: Promise<MediaStream> | MediaStream; auto?: boolean }): Promise<void> {
  if (callMeta.value?.isGroup) {
    await acceptGroupCall();
    return;
  }
  const meta = callMeta.value;
  const stateOk = callState.value === 'incoming' || opts?.auto === true;
  if (!stateOk || !meta?.chatId || !meta.peerUserId || !pendingOffer) return;
  clearRingTimeout();
  stopLoopTone();
  await loadCallPrefs(); // data-saver floor + call-sounds pref, read once for this call

  markConnect('callStart');
  // Fast-connect (spec 2008): start media capture and connection setup CONCURRENTLY. getUserMedia
  // doesn't need the peer connection, and building the PC + applying the remote offer + buffered
  // ICE doesn't need the captured stream — so overlapping them removes the serial gap. TURN was
  // already warmed during the ring, so newPeerConnection doesn't pay a cold fetch here.
  markConnect('gumStart');
  const gumPromise = (opts?.media != null
    ? Promise.resolve(opts.media)
    : navigator.mediaDevices.getUserMedia(gumConstraints(meta.kind))
  ).then((s) => {
    markConnect('gumResolved');
    return s;
  });
  gumPromise.catch(() => {}); // tame the unhandled-rejection while the PC sets up in parallel

  try {
    pc = await newPeerConnection();
    wireIce(pc);
    await pc.setRemoteDescription({ type: pendingOffer.sdpType, sdp: pendingOffer.sdp });
    markConnect('remoteDescriptionSet');
    await drainPendingIce();
  } catch {
    // Connection setup failed; stop any capture that may still resolve, then end.
    void gumPromise.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
    await teardown('failed');
    return;
  }

  let stream: MediaStream;
  try {
    stream = await gumPromise; // capture overlapped the setup above; usually already resolved
  } catch (err) {
    // We can't answer without our own mic/camera. Surface the real reason (usually a
    // blocked OS permission on Android) instead of the generic teardown notice.
    await appToast({ message: describeMediaError(err, meta.kind === 'video' ? 'media' : 'microphone'), duration: 4000 });
    void sendControl('call-reject', meta.peerUserId, meta.callId, { reason: 'failed' });
    await teardown('failed', { silent: true });
    return;
  }
  localStream.value = stream;

  try {
    addLocalTracks(pc, stream);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSealedSignal('call-answer', meta.chatId, meta.peerUserId, meta.callId, {
      callId: meta.callId,
      type: 'answer',
      sdp: answer.sdp,
      sdpType: answer.type,
    });
    markConnect('answerSent');
  } catch {
    await teardown('failed');
    return;
  }

  pendingOffer = null;
  setState('connecting');
  navigateToCall();
}

/* ---- call waiting (spec 0005): hold the active call, take a second, swap, drop ---- */

/* (spec 1030 US4, FR-010) The add-in-flight guard. A promotion/add converts the ACTIVE
 * call (close the 1:1 pc → mint a room → re-enter as a mesh) across several awaits; a
 * swap/park interleaving mid-conversion would capture a half-built call into the held
 * slot (a dead pc, no group session yet) — a half-open connection. Every add/merge path
 * claims this slot for its critical section, and swapCalls/parkActiveAsHeld drain it
 * before touching the active call. Adds also serialize against EACH OTHER, so two
 * concurrent adds can't both promote. */
let addInFlight: Promise<void> | null = null;

async function withAddInFlight<T>(fn: () => Promise<T>): Promise<T> {
  while (addInFlight) await addInFlight; // serialize behind any add already converting
  let release!: () => void;
  addInFlight = new Promise<void>((r) => (release = r));
  try {
    return await fn();
  } finally {
    addInFlight = null;
    release();
  }
}

/** Wait until no promotion/add is converting the active call (no-op when idle). */
async function drainAddInFlight(): Promise<void> {
  while (addInFlight) await addInFlight;
}

/** Pause the current ACTIVE call and move it into the held slot, keeping its connection +
 *  ICE alive. 1:1: detach the senders + send a sealed hold to the peer. Group: pause every
 *  leg (MeshSession.pause). The active singleton refs are then cleared for the new call to
 *  populate — we do NOT teardown. */
async function parkActiveAsHeld(): Promise<void> {
  await drainAddInFlight(); // never park a call mid-promotion (spec 1030 FR-010)
  const meta = callMeta.value;
  if (!meta) return;
  bankActiveTime(meta); // freeze the parked call's duration clock — held time isn't talk time
  if (meta.isGroup && groupSession) {
    await groupSession.pause();
  } else if (pc) {
    await set1to1Senders(pc, null);
    if (meta.chatId && meta.peerUserId) void sendHoldResume('hold', meta.chatId, meta.peerUserId, meta.callId);
  }
  heldSlot = {
    meta,
    pc,
    groupSession,
    remoteStream: remoteStream.value,
    remoteStreams: remoteStreams.value,
    owners: groupStreamOwners.value,
  };
  heldCall.value = meta;
  callCue('hold');
  // Detach the active refs (the new call repopulates them) WITHOUT tearing the held call down.
  pc = null;
  groupSession = null;
  remoteStream.value = null;
  remoteStreams.value = [];
  groupStreamOwners.value = {};
  activeSpeakers.value = [];
  groupHeldPeers.value = [];
  remoteHeld.value = false;
}

/** Return to the held call as the new ACTIVE call: restore its connection objects, capture a
 *  FRESH local stream (the just-ended active call stopped the shared one), re-attach the held
 *  call's senders + tell the other side(s) we resumed. Called when the active call ends while a
 *  call is parked, so hanging up / busy / a remote end RETURNS to the held call instead of
 *  stranding it (spec 0005 US3). */
async function restoreHeldCall(): Promise<void> {
  const slot = heldSlot;
  if (!slot) return;
  heldSlot = null;
  heldCall.value = null;
  pc = slot.pc;
  groupSession = slot.groupSession;
  callMeta.value = slot.meta;
  resumeActiveTime(slot.meta); // restart this call's duration clock from now
  reprimeBytes = true; // re-baseline byte counters against the resumed PC (no usage spike)
  remoteStream.value = slot.remoteStream;
  remoteStreams.value = slot.remoteStreams;
  groupStreamOwners.value = slot.owners;
  remoteHeld.value = false;
  groupHeldPeers.value = [];
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia(gumConstraints(slot.meta.kind));
  } catch {
    /* mic/camera unavailable on resume — proceed with no outgoing media rather than dropping */
  }
  localStream.value = stream;
  if (slot.meta.isGroup && slot.groupSession && stream) {
    await slot.groupSession.resume(stream);
  } else if (slot.pc) {
    if (stream) await set1to1Senders(slot.pc, stream);
    if (slot.meta.chatId && slot.meta.peerUserId) {
      void sendHoldResume('resume', slot.meta.chatId, slot.meta.peerUserId, slot.meta.callId);
      beginPeerResumeCountdown(slot.meta.kind); // spec 2013: tell us their video resumes shortly (video only)
    }
  }
  callCue('resume');
  setState('connected');
  navigateToCall();
}

/** Swap the active and held calls (spec 0005 US2): pause the current active call, resume the
 *  held one into the active slot, and park the just-paused call as the new held. The shared
 *  camera/mic stays live (no re-capture) — only which call sends it changes. */
export async function swapCalls(): Promise<void> {
  await drainAddInFlight(); // an add/promotion completes before the swap parks it (FR-010)
  const slot = heldSlot;
  const activeMeta = callMeta.value;
  if (!slot || !activeMeta) return;
  const stream = localStream.value; // the one live camera/mic — moves to the resumed call
  // 1) Pause the current ACTIVE call (it becomes the new held).
  bankActiveTime(activeMeta); // freeze its clock; the resumed call's clock restarts below
  if (activeMeta.isGroup && groupSession) {
    await groupSession.pause();
  } else if (pc) {
    await set1to1Senders(pc, null);
    if (activeMeta.chatId && activeMeta.peerUserId) void sendHoldResume('hold', activeMeta.chatId, activeMeta.peerUserId, activeMeta.callId);
  }
  const newHeld: HeldSlot = {
    meta: activeMeta,
    pc,
    groupSession,
    remoteStream: remoteStream.value,
    remoteStreams: remoteStreams.value,
    owners: groupStreamOwners.value,
  };
  // 2) Promote the held call to ACTIVE and resume its media from the shared stream.
  pc = slot.pc;
  groupSession = slot.groupSession;
  callMeta.value = slot.meta;
  resumeActiveTime(slot.meta); // restart the resumed call's duration clock
  reprimeBytes = true; // re-baseline byte counters against the resumed PC (no usage spike)
  remoteStream.value = slot.remoteStream;
  remoteStreams.value = slot.remoteStreams;
  groupStreamOwners.value = slot.owners;
  remoteHeld.value = false;
  groupHeldPeers.value = [];
  if (slot.meta.isGroup && slot.groupSession && stream) {
    await slot.groupSession.resume(stream);
  } else if (slot.pc && stream) {
    await set1to1Senders(slot.pc, stream);
    if (slot.meta.chatId && slot.meta.peerUserId) {
      void sendHoldResume('resume', slot.meta.chatId, slot.meta.peerUserId, slot.meta.callId);
      beginPeerResumeCountdown(slot.meta.kind); // spec 2013: tell us their video resumes shortly (video only)
    }
  }
  // 3) The just-paused call is the new held slot.
  heldSlot = newHeld;
  heldCall.value = newHeld.meta;
  callCue('swap');
}

/** End the ACTIVE call and continue on the held one (spec 0005 US3). hangupCall already routes
 *  through teardown → restoreHeldCall when a call is parked, so this is just an alias. */
export const endActive = hangupCall;

/** Close + clear the held slot's connection (its senders carry null tracks, so the shared
 *  stream the ACTIVE call uses is untouched). Used by both a local endHeld and a remote end of
 *  the held call. */
function freeHeldSlot(): void {
  const slot = heldSlot;
  if (!slot) return;
  heldSlot = null;
  heldCall.value = null;
  if (slot.meta.isGroup && slot.groupSession) slot.groupSession.leave();
  else if (slot.pc) {
    try {
      slot.pc.close();
    } catch {
      /* already closed */
    }
  }
}

/** Drop the HELD call without disturbing the active one (spec 0005 US3): tell its other side
 *  it ended, log it, and free the slot. */
export async function endHeld(): Promise<void> {
  const slot = heldSlot;
  if (!slot) return;
  if (!slot.meta.isGroup && slot.pc && slot.meta.peerUserId) {
    void sendControl('call-end', slot.meta.peerUserId, slot.meta.callId, { reason: 'hangup' });
  }
  if (slot.meta.chatId && !slot.meta.isGroup) {
    await logCallToChat(slot.meta.chatId, { direction: slot.meta.direction, video: slot.meta.kind === 'video', missed: false });
  }
  freeHeldSlot();
}

/** Connect the stashed second 1:1 incoming call as the new ACTIVE call, reusing the shared
 *  camera/mic (no second getUserMedia). Mirrors acceptCall's 1:1 answer path. */
async function connectSecondDirect(
  inc: NonNullable<typeof incomingSecond.value>,
  stream: MediaStream,
): Promise<void> {
  if (!inc.offer || !inc.from || !inc.chatId) return;
  callMeta.value = {
    callId: inc.callId,
    isGroup: false,
    kind: inc.callKind,
    direction: 'incoming',
    peerUserId: inc.from,
    chatId: inc.chatId,
    roster: [inc.from],
    name: inc.name,
    avatar: inc.avatar,
  };
  await createCall({ callId: inc.callId, contactId: inc.from, direction: 'incoming', video: inc.callKind === 'video' });
  localStream.value = stream;
  // Connect-milestone record for the SECOND (call-waiting) call — the performance benchmark the
  // first call is measured against (spec 2008). callStart = accept; firstRemoteMedia via ontrack.
  resetConnectMarks();
  markConnect('callStart');
  try {
    pc = await newPeerConnection();
    wireIce(pc);
    addLocalTracks(pc, stream);
    await pc.setRemoteDescription({ type: inc.offer.sdpType, sdp: inc.offer.sdp });
    // Drain the ICE candidates that arrived while the offer was stashed (fast connect).
    for (const c of secondIce.splice(0)) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        /* stale/duplicate candidate is harmless */
      }
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSealedSignal('call-answer', inc.chatId, inc.from, inc.callId, {
      callId: inc.callId,
      type: 'answer',
      sdp: answer.sdp,
      sdpType: answer.type,
    });
  } catch {
    await teardown('failed');
    return;
  }
  setState('connecting');
  navigateToCall();
}

/**
 * Merge the pending second incoming DIRECT caller INTO the current call (spec
 * 1028, US1) — the third choice alongside Accept-&-hold and Decline. Promotes the
 * active call to a mesh room if it's still a 1:1, then tells the incoming caller
 * to join that room instead of the 1:1 they placed. The caller joins in the
 * room's kind (audio/video); the held call, if any, is untouched (merge acts only
 * on the ACTIVE call). Blocked with a reason if the caller wouldn't fit the cap.
 */
export async function mergeIncoming(): Promise<void> {
  const inc = incomingSecond.value;
  if (!inc || inc.kind !== 'direct' || !inc.from || !inc.chatId) return;
  const meta = callMeta.value;
  if (!meta) return;
  // (spec 1041) The merge is now a consent-gated REQUEST: the waiting caller
  // gets a Join / Stay-waiting prompt and nothing converts until they accept
  // (the old flow's bare `joinroom` auto-joined them — the consent hole).
  // Their attempt keeps ringing meanwhile, so hold/decline stay available.
  // Gate on capacity first: a blocked request leaves everything as it was.
  {
    const self = getSelfUserId() ?? '';
    const gate = canAdd(meta.kind, meta.roster, meta.invited ?? [], self, 1);
    if (!gate.ok) {
      await toast(gate.reason);
      return;
    }
  }
  const s = joinRequestState();
  if (!s || !jrRequest(s, inc.from, inc.callId)) return; // rejected this call, or already asked
  joinRequestChats.set(inc.from, inc.chatId);
  touchJoinRequests();
  // The room is only PRE-minted here (s.roomId); promotion happens on accept
  // (never strand a solo room on a rejection — spec FR-003).
  const sent = await sendJoinRequest(inc.chatId, inc.from, inc.callId, s.roomId, meta.kind);
  if (!sent) {
    // Old client or no session: degrade silently — their attempt just keeps
    // ringing and the request clears with it (spec edge case).
    clearJoinRequestFor(inc.from);
  }
}

/** (spec 1041) An inbound join request (or an old client's request-less
 *  `joinroom`) over OUR dialing/held call: raise the consent prompt. Only two
 *  states can consent — we are the WAITING caller (still dialing them) or the
 *  HELD/connected party; anything else ignores the signal. */
function raiseJoinRequestPrompt(meta: CallMeta, roomId: string, roomKind: CallKind): void {
  if (!meta.peerUserId || !meta.chatId) return;
  const waiting = meta.direction === 'outgoing' && (callState.value === 'dialing' || callState.value === 'remote-ringing');
  const heldOrLive = callState.value === 'connected';
  if (!waiting && !heldOrLive) return;
  joinRequestPrompt.value = {
    from: meta.peerUserId,
    chatId: meta.chatId,
    callId: meta.callId,
    roomId,
    roomKind,
  };
}

/** Accept the join request: reply, end our own 1:1 attempt cleanly, and follow
 *  into the room with OUR OWN media kind (clarification A) reusing the capture
 *  — an audio attempt lands mic-only even in a video room; no new getUserMedia. */
export async function acceptJoinRequest(): Promise<void> {
  const req = joinRequestPrompt.value;
  const meta = callMeta.value;
  joinRequestPrompt.value = null;
  if (!req || !meta || meta.callId !== req.callId || meta.tornDown) return;
  void sendJoinRequestReply('joinreq-accept', req.chatId, req.from, req.callId, req.roomId);
  if (callState.value !== 'connected') {
    // A still-ringing attempt: withdraw it (relay retention + their other
    // devices) and settle its spec-1040 marker as handled. DEFERRED past the
    // accept: the cancel is a plain frame while the accept still has to seal,
    // so sending it now puts it on the wire FIRST — and the callee's cancel
    // handling clears the waiting slot + pending request, dropping the accept
    // that arrives a beat later (the CI-only lost-merge race).
    setTimeout(() => {
      void sendControl('call-cancel', req.from, req.callId, { reason: 'answered-elsewhere' });
      settleDirectCallEvent(meta, 'answered');
    }, RING_MARKER_DELAY_MS);
  }
  const title = await deriveGroupCallTitle([req.from]);
  await convertActiveToRoom(req.roomId, meta.kind, title, groupAvatar(req.roomId), 'incoming');
}

/** Stay waiting: reply reject (the callee's merge affordance for us disappears
 *  for the rest of their call) — our own attempt is untouched (FR-006). */
export function rejectJoinRequest(): void {
  const req = joinRequestPrompt.value;
  joinRequestPrompt.value = null;
  if (!req) return;
  void sendJoinRequestReply('joinreq-reject', req.chatId, req.from, req.callId, req.roomId);
}

/** (spec 1041 FR-002) Invite the HELD call's party into the active call — the
 *  same consent-gated request, over the held 1:1's sealed channel. */
export async function mergeHeld(): Promise<void> {
  const held = heldSlot;
  const meta = callMeta.value;
  if (!held || !meta || held.meta.isGroup || !held.meta.peerUserId || !held.meta.chatId) return;
  {
    const self = getSelfUserId() ?? '';
    const gate = canAdd(meta.kind, meta.roster, meta.invited ?? [], self, 1);
    if (!gate.ok) {
      await toast(gate.reason);
      return;
    }
  }
  const s = joinRequestState();
  if (!s || !jrRequest(s, held.meta.peerUserId, held.meta.callId)) return;
  joinRequestChats.set(held.meta.peerUserId, held.meta.chatId);
  touchJoinRequests();
  const sent = await sendJoinRequest(held.meta.chatId, held.meta.peerUserId, held.meta.callId, s.roomId, meta.kind);
  if (!sent) clearJoinRequestFor(held.meta.peerUserId);
}

/** Accept the pending second incoming call (US1): put the current call on hold and connect
 *  the new one, reusing the one shared camera/mic. The held call's other side sees "on hold". */
export async function acceptAndHold(): Promise<void> {
  const inc = incomingSecond.value;
  if (!inc || !canHoldIncoming()) return;
  incomingSecond.value = null;
  await loadCallPrefs();
  await parkActiveAsHeld();
  // Media for the new call: reuse the held call's camera/mic. But if the new call is VIDEO and
  // the shared stream has no camera (the held call was audio-only), capture audio+video fresh —
  // otherwise we'd answer a video call with no video to send. The held call's senders are
  // already detached, so swapping its stream is safe (it re-captures on resume).
  let shared = localStream.value;
  if (inc.callKind === 'video' && !shared?.getVideoTracks().length) {
    try {
      const fresh = await navigator.mediaDevices.getUserMedia(gumConstraints('video'));
      shared?.getTracks().forEach((t) => t.stop());
      shared = fresh;
    } catch {
      /* camera unavailable → fall through and connect with whatever we have (audio-only) */
    }
  }
  if (!shared) {
    try {
      shared = await navigator.mediaDevices.getUserMedia(gumConstraints(inc.callKind));
    } catch {
      await teardown('failed');
      return;
    }
  }
  localStream.value = shared;
  if (inc.kind === 'direct') {
    await connectSecondDirect(inc, shared);
  } else {
    // A group invite as the second call: join the room, reusing the shared stream.
    await enterGroupCall(inc.roomId ?? inc.callId, inc.callKind, inc.name, inc.avatar, 'incoming', [], shared);
  }
}

/** Decline the pending second incoming call (keep the active call): tell the caller busy and
 *  clear the prompt. */
export async function rejectSecond(): Promise<void> {
  const inc = incomingSecond.value;
  if (!inc) return;
  incomingSecond.value = null;
  if (inc.kind === 'direct' && inc.from) {
    // (spec 1041) Declining the waiting call also withdraws any outstanding
    // join request — their prompt must not outlive their attempt.
    const s = joinRequests;
    if (s && s.pending.has(inc.from) && inc.chatId) {
      void sendJoinRequestCancel(inc.chatId, inc.from, inc.callId, s.roomId);
    }
    clearJoinRequestFor(inc.from);
    void sendControl('call-busy', inc.from, inc.callId);
  } else if (inc.kind === 'group' && inc.from && inc.roomId) {
    void sendGroupBusy(inc.from, inc.roomId);
  }
}

/** A second 1:1 call arrived while we're in a call and a held slot is free (spec 0005):
 *  stash its (decrypted) offer and raise the Accept-&-hold prompt with a call-waiting cue,
 *  WITHOUT disturbing the active call. Falls back to busy if it can't be opened/resolved. */
async function presentSecondDirect(
  frame: Extract<CallFrame, { t: 'call-offer' }>,
  from: string,
): Promise<void> {
  const busy = (): void => void sendControl('call-busy', from, frame.callId);
  if (!isUnlockedNow()) return busy();
  let contact = await getContact(from);
  if (!contact) {
    await addContactWithId(from, '');
    contact = await getContact(from);
  }
  if (!contact) return busy();
  const chatId = await sessionChatIdForPeer(contact); // may be a hidden 1:1 (knock-knock, spec 1027)
  const offerChat = await getChat(chatId);
  if ((offerChat?.mutedUntil && offerChat.mutedUntil > Date.now()) || offerChat?.notifyWebPush === false) return;
  const signal = await openSealedSignal(chatId, frame.ciphertext);
  if (!signal || signal.type !== 'offer' || !signal.sdp) return busy();
  secondIce = []; // fresh ICE buffer for this pending second call
  incomingSecond.value = {
    kind: 'direct',
    callId: frame.callId,
    from,
    chatId,
    name: contact.name,
    avatar: contact.avatar,
    callKind: signal.kind ?? 'audio',
    offer: { sdp: signal.sdp, sdpType: signal.sdpType ?? 'offer' },
  };
  // The call-waiting cue (and its repeat) is driven by the incomingSecond watcher below, so it
  // also fires for the group second-incoming path and stops however the prompt is dismissed.
  // Tag the ack 'call-waiting' so the caller shows "in their queue" rather than plain "Ringing…".
  void sendControl('call-ringing', from, frame.callId, { reason: 'call-waiting' });
  // If unanswered within the ring window, drop the prompt (the caller's own timeout ends it).
  setTimeout(() => {
    if (incomingSecond.value?.callId === frame.callId) incomingSecond.value = null;
    clearJoinRequestByCallId(frame.callId); // spec 1041: an expired attempt frees its pending request
  }, RING_TIMEOUT_MS);
}

/** Decline the current incoming call. (Group rings carry no per-invitee decline;
 *  just stop ringing locally; the call continues for everyone else.) */
export async function rejectCall(): Promise<void> {
  const meta = callMeta.value;
  if (!meta) return;
  if (!meta.isGroup && meta.peerUserId) {
    void sendControl('call-reject', meta.peerUserId, meta.callId, { reason: 'declined' });
  } else if (meta.isGroup && meta.roomId) {
    // Dismissing a group invite we never accepted: tell the server so it stops re-ringing
    // us (otherwise the reminder rounds keep bringing the ring back — spec 0004 US1). A
    // joined call instead sends call-leave through the mesh teardown.
    void sendGroupLeave(meta.roomId);
  }
  await teardown('declined', { silent: meta.isGroup });
}

/** Decline an incoming 1:1 call AND send the caller a quick canned reply ("In a
 *  meeting." etc.) into the chat, like the phone's "Decline with message". */
export async function declineWithMessage(text: string): Promise<void> {
  const meta = callMeta.value;
  const body = text.trim();
  const chatId = meta?.chatId;
  // Send the reply before tearing down (teardown clears the call, not the chat).
  if (chatId && body) {
    try {
      await sendMessage(chatId, body);
    } catch {
      /* best-effort: still decline even if the reply couldn't be sent */
    }
  }
  await rejectCall();
}

/** Leave the full-screen call UI WITHOUT ending the call: return to wherever the call
 *  was placed from. The call keeps running and the floating MinimizedCall widget shows
 *  it, so the user can keep using the app and tap to re-expand. */
export function minimizeCall(): void {
  if (router.currentRoute.value.fullPath === '/call-active') {
    void router.replace(returnPath);
  }
}

/** Re-expand a minimized call back to the full-screen call screen. */
export function expandCall(): void {
  if (router.currentRoute.value.fullPath !== '/call-active') {
    void router.push('/call-active');
  }
}

/** Hang up the current (outgoing/connecting/connected) call. */
export async function hangupCall(): Promise<void> {
  const meta = callMeta.value;
  if (!meta) return;
  const duration = callDurationSec(meta); // talk time, excluding any on-hold interval
  if (meta.peerUserId) {
    void sendControl('call-end', meta.peerUserId, meta.callId, { reason: 'hangup', duration });
  }
  await teardown('hangup');
}

/* ---- in-call controls ---- */

export function toggleMute(): void {
  muted.value = !muted.value;
  localStream.value?.getAudioTracks().forEach((t) => (t.enabled = !muted.value));
  callCue(muted.value ? 'mute' : 'unmute');
}

export function toggleCamera(): void {
  cameraOff.value = !cameraOff.value;
  callCue(cameraOff.value ? 'cameraoff' : 'cameraon');
  // Acts on whichever video track is live (camera, or the screen while sharing), so
  // the user can blank/resume the outgoing video without ending the call.
  localStream.value?.getVideoTracks().forEach((t) => (t.enabled = !cameraOff.value));
}

/* ---- mid-call media changes (camera flip, screen share, video<->audio) ----
 *
 * replaceTrack swaps a track in-place with NO renegotiation (camera flip, screen
 * share over an existing video sender), so it works for 1:1 AND for a mesh leg's
 * sender in a group call. ADDING or REMOVING video (audio<->video, or sharing the
 * screen from an audio-only call) changes the m-line set and needs a fresh
 * offer/answer; that renegotiation is only wired for 1:1 here (a group call's mesh
 * must already carry video to flip the camera or screen-share). */

let activeScreenTrack: MediaStreamTrack | null = null;
let screenAddedVideo = false; // screen share added video to an audio-only 1:1 call

function videoSender(): RTCRtpSender | null {
  // Match by the TRANSCEIVER's media kind, not the sender's current track. A 1:1
  // video->audio downgrade nulls the track (replaceTrack(null)) but leaves the sender
  // and its video m-line alive for the life of the PC. Filtering on s.track?.kind would
  // miss that dormant sender, so a later audio->video re-upgrade would addTrack a SECOND
  // video m-line and the live track would land on an inactive direction the peer never
  // receives (local self-view still shows, audio keeps flowing: the reported bug).
  // receiver.track.kind keeps reporting 'video' even when the sender's track is null, so
  // we always reuse the one existing video transceiver via replaceTrack.
  const tx = pc?.getTransceivers().find((t) => t.receiver?.track?.kind === 'video');
  return tx?.sender ?? null;
}

/* ---- outgoing-video quality (adaptive, spec 0004 US4) ----
 * Each connection runs the pure controller in services/call/quality (AIMD over getStats —
 * climb on health, back off on genuine local or remote-reported congestion). 1:1 starts
 * HIGH (one cheap encode, spec 2025); mesh legs start MEDIUM (N parallel encoders). The
 * manual quality pin + "use less data" are an UPPER-BOUND clamp (the controller may still
 * drop below to keep the call alive). Group adaptation is per-receiver inside MeshSession;
 * 1:1 runs here against the single PC's video sender. */
let lessDataCalls = false;

// 1:1 adaptive state, sampled in pollStats; reset per call. Starts HIGH (spec 2025
// FR-001): a single encode is cheap and the first sample lands within ~2s to correct a
// genuinely bad link — starting sharp is the point (mesh legs keep the medium start).
let oneToOneQc: ControllerState = initialController('high');
// Spec 2025 FR-005: set when ADAPTATION detached the video track at tier 'off' (a real
// pause — a 1 bps cap kept the encoder "bandwidth limited" forever, so video never came
// back). Only the flag's owner re-attaches, so this never fights the user's camera
// toggle or hold/resume, which manage tracks through their own paths.
let oneToOneVideoSuspended = false;
// Spec 2025 FR-007: pollStats ticks every 1s for the byte counters/warning/ⓘ, but the
// controller's streak constants were designed for ~2s samples — adapt every SECOND tick.
let adaptTick = 0;

// 1:1 connection-health (spec 0007 US2). We periodically tell the peer the max quality we want from
// THEM (`requestedTier`, from our downlink + manual pin + view size), and apply the peer's report to
// cap what WE send to them. All sealed `qos` over the existing call-ice frame; no server change.
const HEALTH_INTERVAL_MS = 2000; // resend our report at least this often (FR: ~2s)
const HEALTH_STALE_MS = 6000; // ignore a peer report older than this; fall back to send-side (FR-004)
let oneToOneDownlink: Tier = 'hd'; // our self-assessed downlink class (hysteresis state)
let oneToOneHealthSeq = 0; // monotonic seq for OUR outgoing reports
let oneToOneLastSentTier: Tier | null = null; // last requestedTier we sent (to detect change)
let oneToOneLastSentAt = 0; // when we last sent (to honor the ~2s cadence)
let oneToOnePeerReq: { tier: Tier; seq: number; at: number } | null = null; // latest report FROM the peer
// inbound deltas for downlink self-assessment (cumulative counters → per-interval rates)
let inPrevLost = 0;
let inPrevRecv = 0;
let inPrevFramesDropped = 0;
let inPrevFramesReceived = 0;

/** The peer's fresh requested ceiling, or undefined if there's no report or it's stale (→ send-side
 *  fallback, never a hang). `now` lets callers reuse one timestamp. */
function oneToOnePeerCeiling(now: number): Tier | undefined {
  if (!oneToOnePeerReq) return undefined;
  if (now - oneToOnePeerReq.at > HEALTH_STALE_MS) return undefined;
  return oneToOnePeerReq.tier;
}

/** The current upper-bound tier from the manual pin + data-saver. */
function qualityClamp(): Tier {
  return clampForPin(videoQuality.value, lessDataCalls);
}

/** Apply a tier's encoding to a single (1:1) sender. Best-effort: not every browser honors
 *  every field, and there may be no sender yet on an audio call. */
async function applySenderTier(sender: RTCRtpSender | null, tier: Tier): Promise<void> {
  if (!sender) return;
  // Tier 'off' is a REAL pause (spec 2025 FR-005): detach the track so nothing is encoded.
  // The old 1 bps cap left a zombie encode whose own "bandwidth limited" reading kept the
  // controller congested forever — video that dipped once never came back. With the track
  // detached, samples read healthy and the ladder climbs back out on its own.
  if (tier === 'off') {
    if (!oneToOneVideoSuspended && sender.track) {
      oneToOneVideoSuspended = true;
      await sender.replaceTrack(null).catch(() => {});
    }
    return;
  }
  // Leaving the floor: re-attach ONLY what adaptation itself detached (never a track the
  // user's camera toggle or a hold removed — those paths own their tracks).
  if (oneToOneVideoSuspended) {
    oneToOneVideoSuspended = false;
    const v = localStream.value?.getVideoTracks()[0];
    if (v && v.readyState === 'live') await sender.replaceTrack(v).catch(() => {});
  }
  // iOS/WebKit: tier by BITRATE ONLY (`avoidEncoderScaling`) — never via scaleResolutionDownBy/
  // maxFramerate, which stall the old iPhone H.264 encoder (spec 0005). maxBitrate alone is honored
  // and safe (the iPhone-8 black-video bug was the camera-mute/​re-acquire, not the bitrate cap), so
  // per-receiver + manual quality caps (spec 0007 US2/US3) still take effect on iOS. Non-iOS gets the
  // full per-tier encoding (incl. a clean resolution downscale at low/medium).
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
  const enc = tierEncoding(tier, isIOS());
  const e = params.encodings[0];
  e.maxBitrate = enc.maxBitrate;
  e.scaleResolutionDownBy = enc.scaleResolutionDownBy;
  if (enc.maxFramerate == null) delete e.maxFramerate;
  else e.maxFramerate = enc.maxFramerate;
  try {
    await sender.setParameters(params);
  } catch (e2) {
    console.warn('[call] could not apply video quality', e2);
  }
}

/** One 1:1 adaptive step from a fresh getStats report: step the controller toward the clamp —
 *  bounded by the peer's fresh requested ceiling (spec 0007 US2) — and apply if the tier changed.
 *  Also assess our own downlink from inbound stats and (rate-limited) report it to the peer. */
async function adaptOneToOne(report: RTCStatsReport): Promise<void> {
  const now = Date.now();
  const before = oneToOneQc.tier;
  oneToOneQc = nextTier(oneToOneQc, snapshotFromReport(report), qualityClamp(), oneToOnePeerCeiling(now));
  if (oneToOneQc.tier !== before) await applySenderTier(videoSender(), oneToOneQc.tier);
  await reportHealthToPeer(report, now);
}

/** Assess our own downlink for the 1:1 peer from this inbound sample and send a sealed `qos` report
 *  when our requested ceiling changed, or at least every ~2s (spec 0007 US2). Coarse enums only. */
async function reportHealthToPeer(report: RTCStatsReport, now: number): Promise<void> {
  const meta = callMeta.value;
  if (!meta?.chatId || !meta.peerUserId || meta.isGroup) return;
  // Only report once the call is CONNECTED: before that there's no downlink to assess, and a qos
  // seal/open competes for the same per-chat sessionMutex as the offer/ICE handshake — emitting it
  // during setup delays ICE and can blow the connection timeout on a slow runner.
  if (pc?.connectionState !== 'connected') return;
  // Per-interval inbound video loss + frame drops → coarse downlink class (hysteretic).
  let lost = 0;
  let recv = 0;
  let framesDropped = 0;
  let framesReceived = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  report.forEach((s: any) => {
    if (s.type === 'inbound-rtp' && s.kind === 'video') {
      lost += s.packetsLost ?? 0;
      recv += s.packetsReceived ?? 0;
      framesDropped += s.framesDropped ?? 0;
      framesReceived += s.framesReceived ?? s.framesDecoded ?? 0;
    }
  });
  const dLost = Math.max(0, lost - inPrevLost);
  const dRecv = Math.max(0, recv - inPrevRecv);
  const dDrop = Math.max(0, framesDropped - inPrevFramesDropped);
  const dFrames = Math.max(0, framesReceived - inPrevFramesReceived);
  inPrevLost = lost;
  inPrevRecv = recv;
  inPrevFramesDropped = framesDropped;
  inPrevFramesReceived = framesReceived;
  const fractionLost = dRecv + dLost > 0 ? dLost / (dRecv + dLost) : 0;
  // packets: the window's evidence size — a near-empty interval must not move the class
  // (spec 2025 FR-006).
  oneToOneDownlink = downlinkClassFrom(
    { fractionLost, framesDropped: dDrop, framesReceived: dFrames, packets: dRecv + dLost },
    oneToOneDownlink,
  );
  // requestedTier = min(downlink, manual pin/data-saver, view size). The 1:1 remote is shown
  // (near-)fullscreen, so the tile target is HD here; US4 refines this with the real rendered size.
  const requested = requestedTierOf(oneToOneDownlink, qualityClamp(), 'hd');
  const changed = requested !== oneToOneLastSentTier;
  if (!changed && now - oneToOneLastSentAt < HEALTH_INTERVAL_MS) return;
  oneToOneLastSentTier = requested;
  oneToOneLastSentAt = now;
  oneToOneHealthSeq += 1;
  void sendHealth(meta.chatId, meta.peerUserId, meta.callId, {
    requestedTier: requested,
    downlinkClass: oneToOneDownlink,
    seq: oneToOneHealthSeq,
  });
}

/** Re-evaluate outgoing quality after a manual change. Group: push the clamp to the mesh
 *  (per-leg controllers adapt toward it). 1:1: bring the controller down to the clamp if the
 *  pin was lowered, and apply the current tier now (the controller keeps adapting in pollStats). */
async function applyOutgoingQuality(): Promise<void> {
  if (groupSession) {
    groupSession.setQualityClamp(qualityClamp());
    return;
  }
  const clampIdx = TIERS.indexOf(qualityClamp());
  if (TIERS.indexOf(oneToOneQc.tier) > clampIdx) oneToOneQc = { tier: qualityClamp(), healthyStreak: 0, unhealthyStreak: 0 };
  await applySenderTier(videoSender(), oneToOneQc.tier);
  // spec 0007 US3: a manual pin folds into what we ASK the peer for, so tell them now (not on the
  // next ~2s tick) — a low/medium pin must cut INCOMING promptly, not just our outgoing.
  sendHealthNow();
}

/** Recompute our 1:1 requested ceiling from the current downlink + manual pin + view size and send
 *  it immediately (spec 0007 US3 — pin changes shouldn't wait for the next poll). No-op off a 1:1. */
function sendHealthNow(): void {
  const meta = callMeta.value;
  if (!meta?.chatId || !meta.peerUserId || meta.isGroup) return;
  if (pc?.connectionState !== 'connected') return; // don't emit qos during setup (see reportHealthToPeer)
  const requested = requestedTierOf(oneToOneDownlink, qualityClamp(), 'hd');
  oneToOneLastSentTier = requested;
  oneToOneLastSentAt = Date.now();
  oneToOneHealthSeq += 1;
  void sendHealth(meta.chatId, meta.peerUserId, meta.callId, {
    requestedTier: requested,
    downlinkClass: oneToOneDownlink,
    seq: oneToOneHealthSeq,
  });
}

/** Spec 0007 US4: the view reports the rendered group-tile size (CSS px, larger dimension); we map it
 *  to a tier and ask every peer for at most that — a small grid tile needs far less than fullscreen.
 *  No-op off a group call. */
export function setGroupTileSize(px: number): void {
  groupSession?.setAllTileTargets(tileTarget(px));
}

/** Test-only introspection (spec 2025): the 1:1 controller's current tier, whether
 *  adaptation has the video paused (the recoverable floor), and the peer-requested
 *  ceiling — so probes/e2e can watch the climb and the floor recovery. */
export function oneToOneQualityDiag(): { tier: Tier; suspended: boolean; requestedByPeer?: Tier; downlink: Tier } {
  return {
    tier: oneToOneQc.tier,
    suspended: oneToOneVideoSuspended,
    requestedByPeer: oneToOnePeerReq?.tier,
    downlink: oneToOneDownlink,
  };
}

/** Change the outgoing-video quality tier and apply it immediately. */
export async function setVideoQuality(q: VideoQuality): Promise<void> {
  videoQuality.value = q;
  await applyOutgoingQuality();
}

/** Test-only introspection: number of video transceivers on the 1:1 PC, matched by the
 *  receiver's media kind so a dormant sender whose track was nulled still counts. Used
 *  to prove a re-upgrade reuses the single video m-line instead of adding a duplicate. */
export function videoTransceiverCount(): number {
  return pc?.getTransceivers().filter((t) => t.receiver?.track?.kind === 'video').length ?? 0;
}

/** Test-only: cumulative inbound video frames decoded on the 1:1 PC. A real media-flow
 *  signal (independent of the receiver track's muted attribute, which is unreliable in
 *  headless Chromium) for asserting that video actually reaches us after a re-upgrade. */
export async function inboundVideoFrames(): Promise<number> {
  if (!pc) return 0;
  let frames = 0;
  (await pc.getStats()).forEach((r) => {
    const s = r as { type: string; kind?: string; framesDecoded?: number };
    if (s.type === 'inbound-rtp' && s.kind === 'video') frames += s.framesDecoded ?? 0;
  });
  return frames;
}

/** Send a fresh offer for the current 1:1 PC (after adding/removing a track). The
 *  peer answers via handleOffer's renegotiation branch. */
async function renegotiate(): Promise<void> {
  const meta = callMeta.value;
  if (!pc || !meta || meta.isGroup || !meta.chatId || !meta.peerUserId) return;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSealedSignal('call-offer', meta.chatId, meta.peerUserId, meta.callId, {
      callId: meta.callId,
      type: 'offer',
      kind: meta.kind,
      sdp: offer.sdp,
      sdpType: offer.type,
    });
  } catch (e) {
    console.warn('[call] renegotiate failed', e);
  }
}

/** Put `track` into the local preview stream (so the on-screen self-view updates),
 *  replacing + optionally stopping the previous video track. */
function setLocalVideoTrack(track: MediaStreamTrack | null, stopOld: boolean): void {
  const ls = localStream.value;
  if (!ls) {
    if (track) localStream.value = new MediaStream([track]);
    return;
  }
  for (const old of ls.getVideoTracks()) {
    ls.removeTrack(old);
    if (stopOld) old.stop();
  }
  if (track) {
    track.enabled = !cameraOff.value;
    ls.addTrack(track);
  }
}

/** Replace the outgoing video track on whichever connection is active. Returns false
 *  if there's no video sender to replace (e.g. an audio-only group call). */
async function replaceOutgoingVideo(track: MediaStreamTrack): Promise<boolean> {
  if (groupSession) {
    const ok = await groupSession.replaceVideoTrack(track);
    if (ok) await applyOutgoingQuality();
    return ok;
  }
  const sender = videoSender();
  if (!sender) return false;
  await sender.replaceTrack(track);
  await applySenderTier(sender, oneToOneQc.tier);
  return true;
}

/** Flip between the front and rear camera mid-call (camera calls only). */
export async function switchCamera(): Promise<void> {
  if (screenSharing.value) return; // flip applies to the camera, not the shared screen
  const next = cameraFacing.value === 'user' ? 'environment' : 'user';
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(next) });
  } catch {
    await toast('Could not switch camera');
    return;
  }
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  if (!(await replaceOutgoingVideo(track))) {
    track.stop();
    return;
  }
  cameraFacing.value = next;
  setLocalVideoTrack(track, true);
}

/** Whether this platform can capture the screen. getDisplayMedia exists on desktop
 *  + Android Chrome, but NOT on iOS Safari/PWA (a hard WebKit limitation), so we
 *  hide the option there instead of letting it silently no-op. */
export function canScreenShare(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/** Start/stop sharing the screen. While sharing, the outgoing video track is the
 *  display capture; stopping restores the camera (or returns an audio call to audio).
 *  Audio routes to the loudspeaker while sharing (unless on Bluetooth). */
export async function toggleScreenShare(): Promise<void> {
  if (screenSharing.value) {
    await stopScreenShare();
    return;
  }
  if (!canScreenShare()) {
    await toast('Screen sharing isn’t supported on this device');
    return;
  }
  let display: MediaStream;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch {
    return; // user dismissed the OS picker
  }
  const screenTrack = display.getVideoTracks()[0];
  if (!screenTrack) return;
  // The OS "Stop sharing" affordance ends the track directly.
  screenTrack.addEventListener('ended', () => void stopScreenShare());

  const meta = callMeta.value;
  if (await replaceOutgoingVideo(screenTrack)) {
    // Had a video sender already (video call) → swapped the track in place.
  } else if (!meta?.isGroup && pc && meta) {
    // Audio-only 1:1 call → add a video track and renegotiate to carry it.
    pc.addTrack(screenTrack, localStream.value ?? new MediaStream([screenTrack]));
    meta.kind = 'video';
    screenAddedVideo = true;
    await renegotiate();
  } else {
    // Audio-only group call: video is added per-leg via mesh renegotiation.
    screenTrack.stop();
    await toast('Start the call with video to share your screen');
    return;
  }
  activeScreenTrack = screenTrack;
  setLocalVideoTrack(screenTrack, true);
  screenSharing.value = true;
  cameraOff.value = false;
  if (audioRoute.value !== 'bluetooth') await setRoute('speaker'); // shared content → loudspeaker
}

async function stopScreenShare(): Promise<void> {
  if (!screenSharing.value) return;
  screenSharing.value = false;
  activeScreenTrack?.stop();
  activeScreenTrack = null;
  const meta = callMeta.value;

  if (screenAddedVideo && pc && meta) {
    // Screen share had upgraded an audio call → drop back to audio-only.
    screenAddedVideo = false;
    const sender = videoSender();
    if (sender) {
      sender.track?.stop();
      await sender.replaceTrack(null);
    }
    setLocalVideoTrack(null, true);
    meta.kind = 'audio';
    await renegotiate();
    if (audioRoute.value !== 'bluetooth') await setRoute('earpiece');
    return;
  }

  // Otherwise restore the camera (a fresh capture; the old one was stopped on share).
  let camTrack: MediaStreamTrack | null = null;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(cameraFacing.value) });
    camTrack = s.getVideoTracks()[0] ?? null;
  } catch {
    camTrack = null;
  }
  if (camTrack && (await replaceOutgoingVideo(camTrack))) {
    setLocalVideoTrack(camTrack, true);
  } else {
    camTrack?.stop();
  }
}

/** Capture the local camera and add it to the 1:1 PC (replacing any existing video
 *  sender), update the preview + kind, and optionally re-offer. Shared by the upgrade
 *  requester (after the peer accepts) and the acceptor. */
async function addLocalVideo(renegotiateAfter: boolean): Promise<boolean> {
  const meta = callMeta.value;
  if (!pc || !meta) return false;
  let s: MediaStream;
  try {
    s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(cameraFacing.value) });
  } catch {
    await toast('Camera unavailable');
    return false;
  }
  const track = s.getVideoTracks()[0];
  if (!track) return false;
  const sender = videoSender();
  if (sender) await sender.replaceTrack(track);
  else pc.addTrack(track, localStream.value ?? s);
  setLocalVideoTrack(track, true);
  meta.kind = 'video';
  cameraOff.value = false;
  await applySenderTier(videoSender(), oneToOneQc.tier);
  // The camera wasn't enumerated on an audio-only call, so re-check now that video is
  // on - this is what makes the flip-camera button appear after an audio->video switch.
  void refreshCameraCount();
  if (renegotiateAfter) await renegotiate();
  if (audioRoute.value !== 'bluetooth') await setRoute('speaker');
  return true;
}

/** Ask the 1:1 peer to switch the call to video (consent-gated). The peer gets a
 *  prompt; only on accept do BOTH sides add their cameras. */
export async function requestVideoUpgrade(): Promise<void> {
  const meta = callMeta.value;
  if (!pc || !meta || meta.isGroup || meta.kind !== 'audio' || !meta.peerUserId) return;
  if (upgradePending.value) return;
  upgradePending.value = true;
  await sendControl('call-upgrade-request', meta.peerUserId, meta.callId);
  // Clear the pending indicator if the peer never responds.
  setTimeout(() => (upgradePending.value = false), 25_000);
}

/** Accept an incoming video-upgrade request: add OUR camera (so the peer sees us too),
 *  then tell the requester to add theirs + re-offer. */
export async function acceptUpgrade(): Promise<void> {
  upgradeRequest.value = false;
  const meta = callMeta.value;
  if (!pc || !meta || meta.isGroup || !meta.peerUserId) return;
  if (!(await addLocalVideo(false))) {
    await sendControl('call-upgrade-reject', meta.peerUserId, meta.callId);
    return;
  }
  await sendControl('call-upgrade-accept', meta.peerUserId, meta.callId);
}

/** Decline an incoming video-upgrade request: stay audio-only. */
export async function rejectUpgrade(): Promise<void> {
  upgradeRequest.value = false;
  const meta = callMeta.value;
  if (meta?.peerUserId) await sendControl('call-upgrade-reject', meta.peerUserId, meta.callId);
}

/** Turn an audio-only call INTO a video call. 1:1 goes through the consent flow
 *  (requestVideoUpgrade); a group turns on my own camera immediately (each peer renegotiates
 *  to receive it). There is no longer a video->audio downgrade — once a call is video it stays
 *  video; use the camera toggle to stop sending. A no-op if already a video call. */
export async function toggleVideoMode(): Promise<void> {
  const meta = callMeta.value;
  if (!meta || meta.kind !== 'audio') return;
  if (meta.isGroup ? !groupSession : !pc) return;

  if (!meta.isGroup) {
    await requestVideoUpgrade(); // 1:1 needs both parties' consent
    return;
  }
  // Group video is capped (spec 0004 US3): once a call has more than VIDEO_MAX participants
  // it can't become a video call (the roster includes self).
  if ((meta.roster?.length ?? 0) > VIDEO_MAX) {
    await toast(`Video is limited to ${VIDEO_MAX} people`);
    return;
  }
  // Group: turn on my own video immediately (each peer renegotiates to receive it).
  let s: MediaStream;
  try {
    s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(cameraFacing.value) });
  } catch {
    await toast('Camera unavailable');
    return;
  }
  const track = s.getVideoTracks()[0];
  if (!track) return;
  // Publish BEFORE touching the local preview / kind, and surface a failure instead
  // of half-applying (a throw here used to leave a black self tile + nothing sent).
  try {
    await groupSession!.addVideoTrack(track);
  } catch (e) {
    console.warn('[call] group addVideoTrack failed', e);
    track.stop();
    await toast('Could not turn on video');
    return;
  }
  setLocalVideoTrack(track, true);
  meta.kind = 'video';
  cameraOff.value = false;
  await applyOutgoingQuality();
  void refreshCameraCount(); // surface the flip-camera button now that video is on
}

/* ---- inbound frame dispatch (called from sync.ts) ---- */

/** Route a mesh group-call leg signal (an offer/answer/ice frame carrying a roomId) to
 *  the MeshSession, decrypted per-pair over the sender's 1:1 ratchet. Returns true when
 *  the frame belonged to the active mesh (so the 1:1 path is skipped); false when it's a
 *  real 1:1 frame (no roomId) and should fall through to the untouched 1:1 handling. */
async function handleMeshSignal(
  type: 'offer' | 'answer' | 'ice',
  frame: { roomId?: string; from?: string; ciphertext?: unknown },
): Promise<boolean> {
  const gs = groupSession;
  if (!frame.roomId || !gs || gs.roomId !== frame.roomId || !frame.from) return false;
  // Same container the sender sealed over: a real contact's 1:1 ratchet, or the ephemeral
  // call-scoped one for a co-participant who isn't a contact (ad-hoc group call).
  const chatId = await meshSessionChatId(frame.from);
  const signal = await openSealedSignal(chatId, frame.ciphertext);
  if (groupSession !== gs || !signal) return true;
  // Hold/resume ride a call-ice frame; dispatch on the INNER signal type (spec 0005) before
  // the offer/answer/ice handling — a peer paused/resumed their leg to us.
  if (signal.type === 'hold') await gs.onPeerHold(frame.from);
  else if (signal.type === 'resume') await gs.onPeerResume(frame.from);
  else if (signal.type === 'qos' && signal.qos) gs.onPeerHealth(frame.from, signal.qos); // spec 0007 US2
  else if (type === 'offer') await gs.onPeerOffer(frame.from, signal);
  else if (type === 'answer') await gs.onPeerAnswer(frame.from, signal);
  else await gs.onPeerIce(frame.from, signal);
  return true;
}

// Cold start from a call push can deliver the sealed setup frames (the 1:1 offer + the
// caller's trickled ICE, or a group invite) BEFORE device-key auto-unlock finishes — we
// can't decrypt them yet. Dropping them was the bug: a dropped offer auto-replied "busy"
// and killed the call, and dropped ICE left an answered call stuck connecting. Instead,
// hold the sealed frames and replay them the instant we unlock. Bounded + expired so a
// PIN-locked device whose owner never answers doesn't hoard them (and never rings a call
// the caller already withdrew while we were locked — see the cancel/end handling below).
let lockedCallFrames: CallFrame[] = [];
let lockedCallTimer: ReturnType<typeof setTimeout> | null = null;
const LOCKED_CALL_TTL_MS = 60_000; // matches the server's call-buffer / answer window

function clearLockedCallFrames(): void {
  lockedCallFrames = [];
  if (lockedCallTimer) {
    clearTimeout(lockedCallTimer);
    lockedCallTimer = null;
  }
}

function holdCallFrameWhileLocked(frame: CallFrame): void {
  lockedCallFrames.push(frame);
  if (lockedCallFrames.length > 128) lockedCallFrames.shift();
  if (!lockedCallTimer) lockedCallTimer = setTimeout(clearLockedCallFrames, LOCKED_CALL_TTL_MS);
}

// A withdrawal (call-cancel / call-end) for a call we're still holding locked → forget its
// setup frames so we don't ring a dead call once we unlock.
function dropHeldCall(id: string | undefined): void {
  if (!id) return;
  lockedCallFrames = lockedCallFrames.filter((f) => {
    const cid = 'callId' in f ? f.callId : undefined;
    const rid = 'roomId' in f ? f.roomId : undefined;
    return cid !== id && rid !== id;
  });
}

// Replay held setup frames in arrival order (an offer before its ICE) once unlocked.
watch(isUnlocked, (unlocked) => {
  if (!unlocked || lockedCallFrames.length === 0) return;
  const queued = lockedCallFrames;
  clearLockedCallFrames();
  void (async () => {
    for (const f of queued) await handleCallFrame(f);
  })();
});

export async function handleCallFrame(frame: CallFrame): Promise<void> {
  // While the keystore is still locked we can't open sealed signalling. Hold the
  // decryption-dependent SETUP frames (replayed on unlock) rather than dropping them; let
  // plaintext control frames through, and use a withdrawal to forget a held call.
  if (!isUnlockedNow()) {
    const roomId = 'roomId' in frame ? frame.roomId : undefined;
    const isSetup =
      ((frame.t === 'call-offer' || frame.t === 'call-ice') && !roomId) ||
      frame.t === 'call-group-invite';
    if (isSetup) {
      holdCallFrameWhileLocked(frame);
      return;
    }
    if (frame.t === 'call-cancel' || frame.t === 'call-end') {
      dropHeldCall('callId' in frame ? frame.callId : undefined);
    }
  }

  switch (frame.t) {
    case 'call-offer':
      if (await handleMeshSignal('offer', frame)) return;
      await handleOffer(frame);
      return;

    case 'call-ringing': {
      // The callee's device acknowledged the call (its page is ringing, OR its
      // service worker showed the call notification and acked via /v1/call/ack and
      // the server forwarded this). Either way the phone is reachable → "Ringing".
      const meta = callMeta.value;
      if (!meta || meta.callId !== frame.callId) return;
      // The callee is busy but offered Accept & hold → they've been notified and may pick us up.
      // Set this independent of the dialing→ringing transition below: the server auto-issues a
      // plain call-ringing the instant the callee's socket gets the offer (flipping us to
      // remote-ringing), so the callee app's later 'call-waiting'-tagged ack must still register.
      if (frame.reason === 'call-waiting') remoteQueued.value = true;
      if (callState.value === 'dialing') {
        setState('remote-ringing');
        startLoopTone('ringing', 2600); // switch the ringback to the "ringing" cue
        // Reachable now: extend the give-up window so we keep ringing while the callee
        // opens the app from the push and answers, instead of cancelling at 30s.
        if (meta.peerUserId) armDialTimeout(meta.peerUserId, meta.callId, ANSWER_TIMEOUT_MS);
      }
      return;
    }

    case 'call-upgrade-request': {
      // The 1:1 peer wants to switch us to video → show an accept/decline prompt.
      const meta = callMeta.value;
      if (meta && !meta.isGroup && meta.callId === frame.callId && meta.kind === 'audio') {
        upgradeRequest.value = true;
      }
      return;
    }

    case 'call-upgrade-accept': {
      // The peer accepted our upgrade request → add our camera + re-offer (so both
      // sides now send video and neither sees a black tile).
      const meta = callMeta.value;
      if (meta && !meta.isGroup && meta.callId === frame.callId && upgradePending.value) {
        upgradePending.value = false;
        await addLocalVideo(true);
      }
      return;
    }

    case 'call-upgrade-reject': {
      const meta = callMeta.value;
      if (meta && meta.callId === frame.callId && upgradePending.value) {
        upgradePending.value = false;
        void toast('Video request declined');
      }
      return;
    }

    case 'call-answer': {
      if (await handleMeshSignal('answer', frame)) return;
      const meta = callMeta.value;
      if (!pc || !meta || meta.callId !== frame.callId || !meta.chatId) return;
      const signal = await openSealedSignal(meta.chatId, frame.ciphertext);
      if (!signal || signal.type !== 'answer' || !signal.sdp) return;
      // Initial answer flips us to connecting; a renegotiation answer (already
      // connected, e.g. ICE restart) is just applied, no state change/cancel.
      const initial = callState.value === 'dialing' || callState.value === 'remote-ringing';
      try {
        await pc.setRemoteDescription({ type: signal.sdpType ?? 'answer', sdp: signal.sdp });
        await drainPendingIce();
      } catch {
        return;
      }
      if (initial) {
        setState('connecting');
        // Multi-device: tell the callee's other devices to stop ringing.
        if (meta.peerUserId) {
          void sendControl('call-cancel', meta.peerUserId, meta.callId, { reason: 'answered-elsewhere' });
        }
        // (spec 1040) Settle the marker soon (not at teardown — a long call would
        // leave the callee's closed other devices showing a stale ring), but a
        // beat AFTER the answer: the settle seal shares the session lock with the
        // trickle-ICE opens happening right now, and injecting it mid-burst can
        // stall connection setup on a slow machine.
        setTimeout(() => {
          if (callMeta.value?.callId === meta.callId) settleDirectCallEvent(meta, 'answered');
        }, RING_MARKER_DELAY_MS);
      }
      return;
    }

    case 'call-ice': {
      if (await handleMeshSignal('ice', frame)) return;
      // ICE for the pending SECOND incoming call (whose pc doesn't exist until Accept & hold):
      // buffer it so the call connects fast once accepted, instead of discarding the early
      // candidates (which made the second call slow to connect) — spec 0005.
      const second = incomingSecond.value;
      if (second && second.callId === frame.callId && second.chatId) {
        const sig = await openSealedSignal(second.chatId, frame.ciphertext);
        if (sig?.type === 'ice' && sig.candidate) secondIce.push(sig.candidate);
        // (spec 1041) The waiting caller's answer to our join request rides
        // their attempt's own sealed channel.
        else if ((sig?.type === 'joinreq-accept' || sig?.type === 'joinreq-reject') && second.from) {
          await handleJoinReply(second.from, sig.type);
        }
        return;
      }
      // (spec 1041) The HELD party's answer to a join request (their frames key
      // on the held call's id, which the active-meta check below won't match).
      if (heldSlot && heldSlot.meta.callId === frame.callId && heldSlot.meta.chatId && heldSlot.meta.peerUserId) {
        const sig = await openSealedSignal(heldSlot.meta.chatId, frame.ciphertext);
        if (sig?.type === 'joinreq-accept' || sig?.type === 'joinreq-reject') {
          await handleJoinReply(heldSlot.meta.peerUserId, sig.type);
        }
        return; // other held-call signals keep today's behavior (parked calls don't process them)
      }
      // (spec 1041) A reply whose waiting slot is ALREADY GONE (the accepter's
      // own attempt-cancel can land first) still resolves via the pending
      // ledger — a consented merge must never be lost to frame ordering.
      if (joinRequests) {
        const party = [...joinRequests.pending.entries()].find(([, id]) => id === frame.callId)?.[0];
        const chat = party ? joinRequestChats.get(party) : undefined;
        if (party && chat) {
          const sig = await openSealedSignal(chat, frame.ciphertext);
          if (sig?.type === 'joinreq-accept' || sig?.type === 'joinreq-reject') {
            await handleJoinReply(party, sig.type);
          }
          return;
        }
      }
      const meta = callMeta.value;
      if (!meta || meta.callId !== frame.callId || !meta.chatId) return;
      const signal = await openSealedSignal(meta.chatId, frame.ciphertext);
      if (!signal) return;
      // Hold/resume ride a call-ice frame (spec 0005): the 1:1 peer paused/resumed the call.
      // Pause/restore our outgoing to them and flag the call "on hold" — media stops/returns
      // both ways. (Applies to the ACTIVE 1:1 call; a held-call hold is an US2/US3 edge.)
      if (signal.type === 'hold' && pc) {
        cancelResumeCountdown(); // re-held mid-countdown → abort the pending go-live
        cancelPeerResumeCountdown(); // spec 2013: and our mirror countdown for their video
        remoteHeld.value = true;
        await set1to1Senders(pc, null); // pause OUR outgoing too — no data while held
        return;
      }
      if (signal.type === 'resume' && pc) {
        remoteHeld.value = false; // their video unfreezes immediately
        beginResumeCountdown(pc); // 5s heads-up + cue before WE become visible/audible again
        return;
      }
      // (spec 1041) A join request over our own dialing/held call: consent
      // prompt, never an auto-join. Cancel withdraws an outstanding prompt.
      if (signal.type === 'joinreq' && signal.roomId) {
        raiseJoinRequestPrompt(meta, signal.roomId, signal.kind ?? meta.kind);
        return;
      }
      if (signal.type === 'joinreq-cancel') {
        if (joinRequestPrompt.value?.callId === meta.callId) joinRequestPrompt.value = null;
        return;
      }
      if (signal.type === 'joinreq-accept' || signal.type === 'joinreq-reject') return; // replies never target the active meta
      // Promote/merge (spec 1028): the peer is turning this 1:1 into a group (or
      // merging us into their call). Follow them into the mesh room, reusing our
      // capture — the same late-join path builds the fresh legs.
      if (signal.type === 'joinroom' && signal.roomId) {
        // (spec 1041) Consent gate: a joinroom while we are STILL DIALING this
        // peer is an old client's request-less merge — raise the same consent
        // prompt instead of auto-joining (a call the user never agreed to must
        // not start). While CONNECTED it is the legitimate promote follow —
        // being in the call together is the consent — and stays automatic.
        if (callState.value === 'dialing' || callState.value === 'remote-ringing') {
          raiseJoinRequestPrompt(meta, signal.roomId, signal.kind ?? meta.kind);
          return;
        }
        const title = await deriveGroupCallTitle([meta.peerUserId ?? '']);
        await convertActiveToRoom(signal.roomId, signal.kind ?? meta.kind, title, groupAvatar(signal.roomId), 'incoming');
        return;
      }
      // Connection-health report (spec 0007 US2): the peer is telling us the max quality it wants
      // from us. Keep only the newest (by seq) and apply it as a ceiling in adaptOneToOne.
      if (signal.type === 'qos' && signal.qos) {
        const q = signal.qos;
        if (!oneToOnePeerReq || q.seq > oneToOnePeerReq.seq) {
          oneToOnePeerReq = { tier: q.requestedTier, seq: q.seq, at: Date.now() };
        }
        return;
      }
      if (signal.type !== 'ice' || !signal.candidate) return;
      if (pc?.remoteDescription) {
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch {
          /* ignore */
        }
      } else {
        pendingIce.push(signal.candidate);
      }
      return;
    }

    case 'call-reject':
    case 'call-busy': {
      const meta = callMeta.value;
      // Group busy (roomId, no callId): ONE invitee can't take it → mark their tile
      // "unavailable" and stop ringing them, but DON'T end the group call for everyone else
      // (spec 0004 US2). The busy mark is non-overriding — if a free device of theirs joins,
      // the roster handler clears it.
      if (frame.t === 'call-busy' && frame.roomId && frame.from && meta?.isGroup && meta.roomId === frame.roomId) {
        clearMemberRingTimer(frame.from);
        markMemberBusy(frame.from, true);
        return;
      }
      if (meta && meta.callId === frame.callId) {
        await teardown(frame.t === 'call-busy' ? 'busy' : 'declined');
      }
      return;
    }

    case 'call-cancel': {
      // The caller withdrew, or we answered on another device → stop ringing. A group-call
      // recall "remove" carries the roomId (no callId): dismiss the ring if it's for the
      // group we're being rung for. Also forget any held (locked) frames for it.
      const meta = callMeta.value;
      // A second incoming call (call-waiting prompt) the caller gave up on before we answered →
      // dismiss the Accept-&-hold prompt; our active call is untouched (spec 0005).
      if (incomingSecond.value && incomingSecond.value.callId === frame.callId) {
        clearJoinRequestFor(incomingSecond.value.from); // spec 1041: their attempt died — forget the request
        incomingSecond.value = null;
        secondIce = [];
        return;
      }
      clearJoinRequestByCallId(frame.callId); // spec 1041: a cancel can trail the prompt's self-drop
      dropHeldCall(frame.callId);
      dropHeldCall(frame.roomId);
      const matchesCall = !!frame.callId && meta?.callId === frame.callId;
      const matchesRoom = !!frame.roomId && meta?.roomId === frame.roomId;
      if (meta && (matchesCall || matchesRoom) && callState.value === 'incoming') {
        await teardown(frame.reason === 'answered-elsewhere' ? 'answered-elsewhere' : 'remote', {
          silent: true,
        });
      }
      return;
    }

    case 'call-end': {
      const meta = callMeta.value;
      // A second incoming call the caller ended before we answered → dismiss the prompt
      // (some callers send call-end rather than call-cancel on give-up); spec 0005.
      if (incomingSecond.value && incomingSecond.value.callId === frame.callId) {
        clearJoinRequestFor(incomingSecond.value.from); // spec 1041: their attempt died — forget the request
        incomingSecond.value = null;
        secondIce = [];
        return;
      }
      if (meta && meta.callId === frame.callId) {
        // 'unreachable' (spec 2012 US2): the server tells the caller the callee's socket dropped mid-
        // ring and didn't come back — surface it as the clear "unavailable" outcome, not a generic
        // remote hang-up, so the caller knows the callee wasn't there (rather than 60s of false ring).
        const unavailable = frame.reason === 'unavailable' || frame.reason === 'unreachable';
        await teardown(unavailable ? 'unavailable' : 'remote');
      } else if (heldSlot && heldSlot.meta.callId === frame.callId) {
        // The HELD call's remote hung up → free the held slot; the active call is undisturbed
        // (spec 0005 FR-009).
        freeHeldSlot();
        void toast('Your held call ended');
      }
      return;
    }

    case 'call-roster': {
      const gs = groupSession;
      if (!gs || frame.roomId !== gs.roomId) return;
      const self = getSelfUserId() ?? '';
      // Diff by SET membership, not just count, so a coalesced join+leave (which can
      // leave the count unchanged) is still classified correctly.
      const before = new Set((callMeta.value?.roster ?? []).filter((id) => id !== self));
      const after = frame.members.filter((id) => id !== self);
      after.forEach((id) => groupJoined.add(id)); // remember everyone who joined, for the call log
      // Anyone now in the room has answered → stop their give-up timer and clear any
      // recall/remove state (their tile goes ringing/connecting → live).
      for (const id of after) {
        clearMemberRingTimer(id);
        markNotJoining(id, false);
        markMemberBusy(id, false); // a free device joined → no longer "unavailable" (US2)
        // (spec 1040) They joined → settle their marker so no closed device of
        // theirs logs a false missed call (and its stale ring retires).
        settleGroupCallEvent(frame.roomId, id, 'answered');
      }
      // (spec 1030 US2) "{name} joined the call": the first roster of a call seeds
      // silently (whoever is already in the room was here before us, or is us);
      // every later update announces each genuinely-new member exactly once.
      if (!joinCuePrimed) {
        joinCuePrimed = true;
        for (const id of frame.members) announcedJoiners.add(id);
      } else {
        for (const id of newJoiners(announcedJoiners, frame.members, self)) {
          announcedJoiners.add(id);
          joinCueLog.push(id);
          void announceJoinCue(id);
        }
      }
      const afterSet = new Set(after);
      const left = [...before].filter((id) => !afterSet.has(id));
      // Someone who WAS in the room and is now gone has left → drop them from the invited set
      // too, so their tile disappears (after the goodbye wave) instead of reverting to a
      // "Ringing…" placeholder as if we were still calling them. (A genuine no-show who never
      // joined stays in `invited` and keeps its ringing/recall tile.)
      if (left.length && callMeta.value?.invited) {
        callMeta.value.invited = callMeta.value.invited.filter((id) => !left.includes(id));
      }
      if (callMeta.value) callMeta.value.roster = frame.members;
      await gs.onRoster(frame.members);

      if (after.length === 0) {
        if (before.size > 0) {
          // We had company and now we're alone → end the call (the leaving tile's wave is the
          // goodbye; no toast).
          await teardown('remote');
          return;
        }
        // Still the only one in the room → arm the "nobody answered" timeout so a
        // lone group call doesn't hang on "Waiting…" forever.
        armGroupIdleTimeout();
      } else {
        clearGroupIdleTimeout(); // someone is here
        // No toast when someone leaves: their tile shows the waving-hand goodbye (with their
        // avatar), then the grid reflows.
      }
      return;
    }

    case 'call-member': {
      // Server-authoritative ring-state for one invitee, broadcast to the whole room so every
      // participant's tile flips together (spec 0004): 'noanswer' once the reminder window
      // elapsed, 'ringing' on a recall, 'removed' when dropped. This replaces each client
      // timing the no-answer locally from its own join — which is why the retry tile used to
      // appear at different moments for different people.
      const meta = callMeta.value;
      if (!meta?.isGroup || meta.roomId !== frame.roomId) return;
      const id = frame.to;
      if (!id || meta.roster.includes(id)) return; // already joined → ignore stale state
      if (frame.status === 'noanswer') {
        clearMemberRingTimer(id);
        markNotJoining(id, true);
        // (spec 1040) Their reminder window ran out → the missed-call marker.
        settleGroupCallEvent(frame.roomId, id, 'missed');
      } else if (frame.status === 'ringing') {
        markNotJoining(id, false);
        markMemberBusy(id, false);
        if (!(meta.invited ?? []).includes(id)) meta.invited = [...(meta.invited ?? []), id];
        armMemberRingTimer(id); // local fallback in case the next 'noanswer' broadcast is missed
      } else if (frame.status === 'removed') {
        clearMemberRingTimer(id);
        markNotJoining(id, false);
        markMemberBusy(id, false);
        if (meta.invited) meta.invited = meta.invited.filter((m) => m !== id);
      }
      return;
    }

    case 'call-group-invite':
      // Server fan-out of an incoming group call → ring locally so we can join.
      await handleGroupInvite(frame);
      return;

    case 'call-full': {
      // The server refused our join: the room is at its participant cap (spec 0004 US3).
      // Abandon our local attempt and tell the user; the existing call is undisturbed.
      const meta = callMeta.value;
      if (meta?.isGroup && meta.roomId === frame.roomId) {
        callCue('callfull');
        await toast('This call is full');
        await teardown('unavailable', { silent: true });
      }
      return;
    }

    // call-join/call-leave are client→server only (we send, never receive them).
    case 'call-join':
    case 'call-leave':
      return;
  }
}

/** Convenience accessor for components. */
export function useCall() {
  return {
    callState,
    callMeta,
    localStream,
    remoteStream,
    groupStreamOwners,
    activeSpeakers,
    muted,
    cameraOff,
    callStats,
    cameraFacing,
    screenSharing,
    upgradePending,
    upgradeRequest,
    startDirectCall,
    acceptCall,
    rejectCall,
    hangupCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    toggleScreenShare,
    toggleVideoMode,
    videoQuality,
    setVideoQuality,
    acceptUpgrade,
    rejectUpgrade,
    addPeople,
    mergeIncoming,
    mergeGroupInvite,
    callRemainingSlots,
    recallMember,
    cancelInvite,
  };
}
