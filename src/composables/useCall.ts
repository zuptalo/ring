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
import router from '@/router';
import { uid } from '@/utils/uid';
import {
  getContact,
  getChat,
  addContactWithId,
  startDirectChat,
  createCall,
  finishCall,
  markCallMissed,
  recordGroupCall,
  logCallToChat,
  sendMessage,
  getSetting,
} from '@/db/queries';
import { groupAvatar } from '@/db/avatars';
import { capitalizeFirst } from '@/utils/text';
import { getSelfUserId } from '@/services/auth';
import { isUnlockedNow, isUnlocked } from '@/services/crypto/identity';
import { getTurnConfig, warmTurnConfig, rtcConfig } from '@/services/call/turn';
import {
  sendSealedSignal, openSealedSignal, sendControl, meshSessionChatId, sendRecall, sendGroupInviteeCancel,
  sendGroupLeave, sendGroupBusy, sendHoldResume,
} from '@/services/call/signalling';
import { MeshSession } from '@/services/call/mesh';
import { syncState } from '@/composables/useSync';
import { startLoopTone, stopLoopTone, playTone, cue, type ToneName } from '@/services/sound';
import type { CallState, CallMeta, CallKind, EndReason } from '@/services/call/types';
import { VIDEO_MAX } from '@/services/call/types';
import {
  type Tier,
  type ControllerState,
  TIERS,
  tierEncoding,
  initialController,
  nextTier,
  snapshotFromReport,
  clampForPin,
} from '@/services/call/quality';
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
export const callStats = ref({ durationSec: 0, kbpsUp: 0, kbpsDown: 0 });
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

/** The far side resumed a call they'd put us on hold. Their media unfreezes right away, but give
 *  US a 5s heads-up (visible countdown + a cue) before our camera/mic go live again, so we're not
 *  caught by surprise. Restores outgoing on `target` when the countdown hits zero — unless the
 *  call moved on (torn down, re-held, or swapped) in the meantime. */
function beginResumeCountdown(target: RTCPeerConnection): void {
  cancelResumeCountdown();
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

/** Whether a second incoming call can be taken with Accept & hold: we're in exactly one call
 *  (active, no held slot yet) so a slot is free (two-call cap, spec 0005). */
export function canHoldIncoming(): boolean {
  return callState.value !== 'idle' && callState.value !== 'ended' && heldSlot === null;
}

/** Latest per-tile audio RMS for the active group call (tile key → level). Empty when
 *  not in a group call. Exposed for the e2e test hook to verify metering end-to-end. */
export function groupAudioLevels(): Record<string, number> {
  return groupSession?.audioLevels() ?? {};
}

/** Test/diagnostic: group-call video flow + per-leg tiers across the whole mesh (the 1:1
 *  inboundVideoFrames() can't see a mesh's per-peer connections). Empty when not in a group. */
export function groupCallDiag(): Promise<{ inboundVideoFrames: number; tiers: Record<string, string> }> {
  return groupSession?.meshDiag() ?? Promise.resolve({ inboundVideoFrames: 0, tiers: {} });
}

let pendingOffer: { sdp: string; sdpType: RTCSdpType } | null = null;
const pendingIce: RTCIceCandidateInit[] = [];

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

function gumConstraints(kind: CallKind): MediaStreamConstraints {
  // Echo cancellation / noise suppression / AGC matter especially on loudspeaker
  // (the default for video calls), where open-air feedback would otherwise howl.
  return {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: kind === 'video',
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
  // Use whichever connection is active (1:1 pc, or the SFU connection for group).
  const getStats = pc ? pc.getStats() : groupSession ? groupSession.stats() : null;
  if (!getStats) return;
  let up = 0;
  let down = 0;
  let lost = 0;
  let recv = 0;
  try {
    const report = await getStats;
    report.forEach((s) => {
      if (s.type === 'outbound-rtp' && typeof s.bytesSent === 'number') up += s.bytesSent;
      if (s.type === 'inbound-rtp') {
        if (typeof s.bytesReceived === 'number') down += s.bytesReceived;
        if (typeof s.packetsLost === 'number') lost += s.packetsLost;
        if (typeof s.packetsReceived === 'number') recv += s.packetsReceived;
      }
    });
    // 1:1 adaptive outgoing quality (spec 0004 US4): the group path adapts per-leg inside
    // MeshSession; the 1:1 PC adapts here off the same sample.
    if (pc) await adaptOneToOne(report);
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
    callStats.value = { ...callStats.value, kbpsUp: 0, kbpsDown: 0 };
    return;
  }
  const dt = (now - lastBytes.ts) / 1000 || 1;
  const kbpsUp = Math.max(0, Math.round(((up - lastBytes.up) * 8) / 1000 / dt));
  const kbpsDown = Math.max(0, Math.round(((down - lastBytes.down) * 8) / 1000 / dt));
  lastBytes = { up, down, ts: now };
  callStats.value = { ...callStats.value, kbpsUp, kbpsDown };

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
  oneToOneQc = initialController(); // next call starts low again
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
    meta.endedReason = reason;
  }
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
  // Clear ALL call-waiting display state so a hung-up call can't leak its "on hold" UI into the
  // next call (the reported bug: a device that was on hold kept remoteHeld=true after the call
  // dropped, so the next call opened showing the hold overlay).
  remoteQueued.value = false;
  remoteHeld.value = false;
  groupHeldPeers.value = [];
  heldCall.value = null;
  incomingSecond.value = null;
  callStats.value = { durationSec: 0, kbpsUp: 0, kbpsDown: 0 };
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
  const chatId = await startDirectChat(contact);
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
  await createCall({ callId, contactId, direction: 'outgoing', video: kind === 'video' });
  await loadCallPrefs(); // data-saver floor + call-sounds pref, read once for this call

  // Fast-connect (spec 2008): warm the TURN credential cache OFF the critical path before we
  // await getUserMedia, so the fetch overlaps camera/mic capture and `newPeerConnection` finds it
  // cached instead of blocking on a cold network round-trip (the slow first-call path).
  resetConnectMarks();
  markConnect('callStart');
  markConnect('turnWarmStart');
  warmTurnConfig();

  let stream: MediaStream;
  try {
    markConnect('gumStart');
    stream = await navigator.mediaDevices.getUserMedia(gumConstraints(kind));
    markConnect('gumResolved');
  } catch {
    await teardown('failed');
    return;
  }
  localStream.value = stream;

  try {
    pc = await newPeerConnection();
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
    if (!sent) {
      console.warn('[call] offer not sent (no session or offline)');
      await teardown('unavailable');
      return;
    }
  } catch (e) {
    console.warn('[call] startDirectCall failed', e);
    await teardown('failed');
    return;
  }

  setState('dialing');
  startLoopTone('calling', 2800); // "calling" ringback (not yet ringing)
  // Caller-side timeout: the server may be buffering the offer for an offline
  // (push-woken) callee, so we can't rely on a fast "unavailable", give up
  // ourselves if nobody answers.
  armDialTimeout(contactId, callId, DIAL_TIMEOUT_MS);
  navigateToCall();
}

/* ---- group (SFU) ---- */

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

/** Shared group-call entry: build + start the SFU session and wire its callbacks.
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
    if (c?.name) names.push(capitalizeFirst(c.name));
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
  // Already ringing/connected for this room → ignore duplicate invites.
  if (callMeta.value?.roomId === roomId) return;
  if (callState.value !== 'idle') {
    // Busy in another call → tell the caller we're unavailable instead of letting their tile
    // for us ring forever, and stop their server-side re-ring of us (spec 0004 US2).
    void sendGroupBusy(frame.from, roomId);
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

// ICE failed for the group PC: start the grace countdown and rebuild the SFU
// connection (re-join). Only if grace expires without recovery do we end the call.
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
const GROUP_NOBODY_MS = 60_000;
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

  if (callState.value !== 'idle') {
    const meta = callMeta.value;
    const glareWithPeer = meta?.direction === 'outgoing' && meta.peerUserId === from;
    if (glareWithPeer) {
      const self = getSelfUserId() ?? '';
      if (self < from) return; // we win, keep our outgoing offer, ignore theirs
      await teardown('answered-elsewhere', { silent: true }); // we yield, accept theirs
    } else if (canHoldIncoming()) {
      // Call waiting (spec 0005): a held slot is free → offer Accept & hold instead of busy.
      await presentSecondDirect(frame, from);
      return;
    } else {
      void sendControl('call-busy', from, frame.callId);
      return;
    }
  }

  let contact = await getContact(from);
  if (!contact) {
    await addContactWithId(from, '');
    contact = await getContact(from);
  }
  if (!contact) return;
  const chatId = await startDirectChat(contact);

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

  const kind: CallKind = signal.kind ?? 'audio';
  callMeta.value = {
    callId: frame.callId,
    isGroup: false,
    kind,
    direction: 'incoming',
    peerUserId: from,
    chatId,
    roster: [from],
    name: contact.name,
    avatar: contact.avatar,
  };
  pendingOffer = { sdp: signal.sdp, sdpType: signal.sdpType ?? 'offer' };
  await createCall({ callId: frame.callId, contactId: from, direction: 'incoming', video: kind === 'video' });

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
  void sendControl('call-ringing', from, frame.callId);

  clearRingTimeout();
  noAnswerTimer = setTimeout(() => {
    void sendControl('call-end', from, frame.callId, { reason: 'timeout' });
    void teardown('timeout');
  }, RING_TIMEOUT_MS);
}

/** Accept the current incoming call (branches to the group path for a group ring). */
export async function acceptCall(): Promise<void> {
  if (callMeta.value?.isGroup) {
    await acceptGroupCall();
    return;
  }
  const meta = callMeta.value;
  if (callState.value !== 'incoming' || !meta?.chatId || !meta.peerUserId || !pendingOffer) return;
  clearRingTimeout();
  stopLoopTone();
  await loadCallPrefs(); // data-saver floor + call-sounds pref, read once for this call

  markConnect('callStart');
  // Fast-connect (spec 2008): start media capture and connection setup CONCURRENTLY. getUserMedia
  // doesn't need the peer connection, and building the PC + applying the remote offer + buffered
  // ICE doesn't need the captured stream — so overlapping them removes the serial gap. TURN was
  // already warmed during the ring, so newPeerConnection doesn't pay a cold fetch here.
  markConnect('gumStart');
  const gumPromise = navigator.mediaDevices
    .getUserMedia(gumConstraints(meta.kind))
    .then((s) => {
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
  } catch {
    void sendControl('call-reject', meta.peerUserId, meta.callId, { reason: 'failed' });
    await teardown('failed');
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

/** Pause the current ACTIVE call and move it into the held slot, keeping its connection +
 *  ICE alive. 1:1: detach the senders + send a sealed hold to the peer. Group: pause every
 *  leg (MeshSession.pause). The active singleton refs are then cleared for the new call to
 *  populate — we do NOT teardown. */
async function parkActiveAsHeld(): Promise<void> {
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
    if (slot.meta.chatId && slot.meta.peerUserId) void sendHoldResume('resume', slot.meta.chatId, slot.meta.peerUserId, slot.meta.callId);
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
  const chatId = await startDirectChat(contact);
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
 * share over an existing video sender), so it works for 1:1 AND for the SFU sender
 * in a group call. ADDING or REMOVING video (audio<->video, or sharing the screen
 * from an audio-only call) changes the m-line set and needs a fresh offer/answer;
 * that's only wired for 1:1 here (the SFU is server-offers-only, so group calls must
 * already carry video to flip the camera or screen-share). */

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
 * Both 1:1 and group video START LOW and adapt: each connection runs the pure controller in
 * services/call/quality (AIMD over getStats — climb only with headroom, back off on local or
 * remote-reported congestion). The manual quality pin + "use less data" are an UPPER-BOUND
 * clamp (the controller may still drop below to keep the call alive). Group adaptation is
 * per-receiver inside MeshSession; 1:1 runs here against the single PC's video sender. */
let lessDataCalls = false;

// 1:1 adaptive state, sampled in pollStats; reset per call.
let oneToOneQc: ControllerState = initialController();

/** The current upper-bound tier from the manual pin + data-saver. */
function qualityClamp(): Tier {
  return clampForPin(videoQuality.value, lessDataCalls);
}

/** Apply a tier's encoding to a single (1:1) sender. Best-effort: not every browser honors
 *  every field, and there may be no sender yet on an audio call. */
async function applySenderTier(sender: RTCRtpSender | null, tier: Tier): Promise<void> {
  if (!sender) return;
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

/** One 1:1 adaptive step from a fresh getStats report: step the controller toward the clamp
 *  and apply if the tier changed. Called from pollStats (~1s). */
async function adaptOneToOne(report: RTCStatsReport): Promise<void> {
  const before = oneToOneQc.tier;
  oneToOneQc = nextTier(oneToOneQc, snapshotFromReport(report), qualityClamp());
  if (oneToOneQc.tier !== before) await applySenderTier(videoSender(), oneToOneQc.tier);
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
  if (TIERS.indexOf(oneToOneQc.tier) > clampIdx) oneToOneQc = { tier: qualityClamp(), healthyStreak: 0 };
  await applySenderTier(videoSender(), oneToOneQc.tier);
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
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: next } } });
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
    // Audio-only group call: can't add video without an SFU re-offer.
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
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: cameraFacing.value } } });
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
    s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: cameraFacing.value } } });
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
    s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: cameraFacing.value } } });
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
        return;
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
        remoteHeld.value = true;
        await set1to1Senders(pc, null); // pause OUR outgoing too — no data while held
        return;
      }
      if (signal.type === 'resume' && pc) {
        remoteHeld.value = false; // their video unfreezes immediately
        beginResumeCountdown(pc); // 5s heads-up + cue before WE become visible/audible again
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
        incomingSecond.value = null;
        secondIce = [];
        return;
      }
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
        incomingSecond.value = null;
        secondIce = [];
        return;
      }
      if (meta && meta.callId === frame.callId) {
        await teardown(frame.reason === 'unavailable' ? 'unavailable' : 'remote');
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
  };
}
