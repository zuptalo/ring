/**
 * 1:1 WebRTC call engine + reactive call store (singleton).
 *
 * Signalling rides the WebSocket as live-only `call-*` frames; SDP/ICE are
 * E2EE'd peer-to-peer over the existing Double Ratchet (services/call/signalling).
 * Media is a direct DTLS-SRTP PeerConnection (natively end-to-end encrypted),
 * relayed through the server's TURN only when a direct path is blocked
 * (iceTransportPolicy 'relay', forced by the 443-only deployment).
 *
 * Group calls (SFU) are layered on separately (services/call/sfu.ts); this file
 * owns the 1:1 path and the shared reactive state/UI surface.
 */
import { ref, computed } from 'vue';
import { toastController } from '@ionic/vue';
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
import { getSelfUserId } from '@/services/auth';
import { isUnlockedNow } from '@/services/crypto/identity';
import { getTurnConfig, rtcConfig } from '@/services/call/turn';
import { sendSealedSignal, openSealedSignal, sendControl, chatIdForPeer } from '@/services/call/signalling';
import { MeshSession } from '@/services/call/mesh';
import { startLoopTone, stopLoopTone, playTone } from '@/services/sound';
import type { CallState, CallMeta, CallKind, EndReason } from '@/services/call/types';
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

/** Latest per-tile audio RMS for the active group call (tile key → level). Empty when
 *  not in a group call. Exposed for the e2e test hook to verify metering end-to-end. */
export function groupAudioLevels(): Record<string, number> {
  return groupSession?.audioLevels() ?? {};
}

let pendingOffer: { sdp: string; sdpType: RTCSdpType } | null = null;
const pendingIce: RTCIceCandidateInit[] = [];
let noAnswerTimer: ReturnType<typeof setTimeout> | null = null;
let dialTimer: ReturnType<typeof setTimeout> | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let durationTimer: ReturnType<typeof setInterval> | null = null;
let lastBytes = { up: 0, down: 0, ts: 0 };
let lastLoss = { lost: 0, recv: 0 };
let returnPath = '/tabs/calls';

const RING_TIMEOUT_MS = 35_000; // callee: auto-decline if unanswered
const DIAL_TIMEOUT_MS = 30_000; // caller: give up if NO sign of reachability (30s)
// Once the callee is confirmed reachable (call-ringing, e.g. its push was acked), give
// it a longer answer window so the caller doesn't hang up while the callee is still
// cold-starting the app from the push (which cancelled the ring the instant it opened).
const ANSWER_TIMEOUT_MS = 60_000;
const GRACE_MS = 12_000; // mid-call: tolerate a blip before ending

// Group calls: the set of OTHER participants that actually joined during the call
// (accumulated from call-roster frames), for the call log + Calls-tab record.
const groupJoined = new Set<string>();


/* ---- helpers ---- */

function setState(s: CallState): void {
  callState.value = s;
}

async function toast(message: string): Promise<void> {
  const t = await toastController.create({ message, duration: 1800, position: 'top' });
  await t.present();
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

  conn.ontrack = (e) => {
    remoteStream.value = e.streams[0] ?? null;
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

function startTimers(): void {
  stopTimers();
  const started = callMeta.value?.startedAt ?? Date.now();
  durationTimer = setInterval(() => {
    callStats.value = { ...callStats.value, durationSec: Math.floor((Date.now() - started) / 1000) };
  }, 1000);
  lastBytes = { up: 0, down: 0, ts: Date.now() };
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
  } catch {
    return;
  }
  const now = Date.now();
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
    const durationSec = wasConnected
      ? Math.max(0, Math.floor((Date.now() - (meta.startedAt ?? Date.now())) / 1000))
      : 0;
    const video = meta.kind === 'video';
    // 1:1 Calls-tab record (unchanged behaviour).
    if (!meta.isGroup) {
      if (wasConnected) await finishCall(meta.callId, durationSec, totalBytes);
      else await markCallMissed(meta.callId);
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
          durationSec: wasConnected ? durationSec : undefined,
        });
      }
    }
    meta.endedReason = reason;
  }
  groupJoined.clear();

  setState('ended');
  callStats.value = { durationSec: 0, kbpsUp: 0, kbpsDown: 0 };
  connectionWarning.value = null;

  // Tell the surviving party why the call ended, when it wasn't a clean hangup.
  if (!opts?.silent) {
    if (reason === 'failed') {
      void toast(wasConnected ? 'Call ended, connection lost' : "Couldn't connect the call");
    } else if (reason === 'unavailable') {
      void toast('Unavailable, couldn’t reach them');
    }
  }

  if (!opts?.silent && router.currentRoute.value.fullPath === '/call-active') {
    void router.replace(returnPath);
  }

  // Settle back to idle so the next call can start.
  setTimeout(() => {
    if (callState.value === 'ended') {
      setState('idle');
      callMeta.value = null;
    }
  }, 400);
}

/* ---- outgoing (1:1) ---- */

/** Place a 1:1 call to a contact (peer user id). */
export async function startDirectCall(contactId: string, kind: CallKind): Promise<void> {
  if (callState.value !== 'idle') {
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

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(gumConstraints(kind));
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
  if (callState.value !== 'idle') {
    await toast('You’re already in a call');
    return;
  }
  await enterGroupCall(roomId, kind, name, avatar, 'outgoing', members);
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
): Promise<void> {
  callMeta.value = {
    callId: roomId,
    isGroup: true,
    kind,
    direction,
    roomId,
    roster: [],
    name,
    avatar,
  };
  setState('connecting');
  // Read the "use less data" floor once for this call (used by the adaptive tier).
  lessDataCalls = await getSetting<boolean>('storage.lessDataCalls', false);

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
    await groupSession.start();
  } catch (e) {
    console.warn('[call] group start failed', e);
    await teardown('failed');
    return;
  }
  armGroupIdleTimeout(); // end the call if nobody joins within the grace window
  navigateToCall();
}

/** An incoming group-call invite (server fan-out) → ring locally so the user can join. */
async function handleGroupInvite(frame: Extract<CallFrame, { t: 'call-group-invite' }>): Promise<void> {
  const roomId = frame.roomId;
  if (!roomId || !frame.from) return;
  // Already ringing/connected for this room → ignore duplicate invites.
  if (callMeta.value?.roomId === roomId) return;
  if (callState.value !== 'idle') return; // busy with another call, can't join two
  if (!isUnlockedNow()) return; // locked → can't decrypt the sealed signalling; skip the ring

  // The server is group-graph-less, so resolve the group's name/avatar locally.
  const chat = await getChat(roomId);
  callMeta.value = {
    callId: roomId,
    isGroup: true,
    kind: frame.kind ?? 'audio',
    direction: 'incoming',
    roomId,
    roster: frame.members ?? [],
    name: chat?.name || 'Group call',
    avatar: chat?.avatar || '',
  };
  setState('incoming');
  startLoopTone('beacon', 2000);
  clearRingTimeout();
  noAnswerTimer = setTimeout(() => void teardown('timeout'), RING_TIMEOUT_MS);
}

/** Accept the current incoming GROUP call → join the room (no members → no re-ring). */
export async function acceptGroupCall(): Promise<void> {
  const meta = callMeta.value;
  if (callState.value !== 'incoming' || !meta?.isGroup || !meta.roomId) return;
  clearRingTimeout();
  stopLoopTone();
  await enterGroupCall(meta.roomId, meta.kind, meta.name, meta.avatar, 'incoming');
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

  setState('incoming');
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

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(gumConstraints(meta.kind));
  } catch {
    void sendControl('call-reject', meta.peerUserId, meta.callId, { reason: 'failed' });
    await teardown('failed');
    return;
  }
  localStream.value = stream;

  try {
    pc = await newPeerConnection();
    wireIce(pc);
    addLocalTracks(pc, stream);
    await pc.setRemoteDescription({ type: pendingOffer.sdpType, sdp: pendingOffer.sdp });
    await drainPendingIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSealedSignal('call-answer', meta.chatId, meta.peerUserId, meta.callId, {
      callId: meta.callId,
      type: 'answer',
      sdp: answer.sdp,
      sdpType: answer.type,
    });
  } catch {
    await teardown('failed');
    return;
  }

  pendingOffer = null;
  setState('connecting');
  navigateToCall();
}

/** Decline the current incoming call. (Group rings carry no per-invitee decline;
 *  just stop ringing locally; the call continues for everyone else.) */
export async function rejectCall(): Promise<void> {
  const meta = callMeta.value;
  if (!meta) return;
  if (!meta.isGroup && meta.peerUserId) {
    void sendControl('call-reject', meta.peerUserId, meta.callId, { reason: 'declined' });
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
  const duration = meta.startedAt ? Math.floor((Date.now() - meta.startedAt) / 1000) : 0;
  if (meta.peerUserId) {
    void sendControl('call-end', meta.peerUserId, meta.callId, { reason: 'hangup', duration });
  }
  await teardown('hangup');
}

/* ---- in-call controls ---- */

export function toggleMute(): void {
  muted.value = !muted.value;
  localStream.value?.getAudioTracks().forEach((t) => (t.enabled = !muted.value));
}

export function toggleCamera(): void {
  cameraOff.value = !cameraOff.value;
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

/* ---- outgoing-video quality tiers ----
 * The user can trade picture quality for data use mid-call. 'auto' removes any cap and
 * lets the browser's bandwidth estimator pick; the lower tiers clamp the first encoding's
 * bitrate (and scale resolution/framerate down) so the camera sends less. Applied via
 * RTCRtpSender.setParameters, which leaves the track (and its E2EE transform) in place. */
const QUALITY_ENCODING: Record<VideoQuality, { maxBitrate?: number; scaleResolutionDownBy: number; maxFramerate?: number }> = {
  auto: { maxBitrate: undefined, scaleResolutionDownBy: 1 },
  medium: { maxBitrate: 600_000, scaleResolutionDownBy: 1.5, maxFramerate: 24 },
  low: { maxBitrate: 150_000, scaleResolutionDownBy: 3, maxFramerate: 15 },
};

// Adaptive outbound quality (group/mesh): as more participants publish video, step the
// tier DOWN so the O(N) mesh uplink doesn't overwhelm the connection. A manual pick
// (anything but 'auto') always wins. `lessDataCalls` (the "Use less data for calls"
// setting, read once at group-call start) is a floor: never full 'auto'.
let lessDataCalls = false;

/** How many remote participants are currently publishing video. */
function videoPublisherCount(): number {
  return remoteStreams.value.filter((s) => s.getVideoTracks().some((t) => t.readyState === 'live')).length;
}

/** The tier to actually apply: a manual pin wins; otherwise scale by publisher count. */
function effectiveTier(): VideoQuality {
  if (videoQuality.value !== 'auto') return videoQuality.value;
  const n = videoPublisherCount();
  let tier: VideoQuality = n <= 1 ? 'auto' : n <= 3 ? 'medium' : 'low';
  if (lessDataCalls && tier === 'auto') tier = 'medium';
  return tier;
}

/** The outgoing video sender on the 1:1 PC (group fan-out goes through MeshSession). */
function activeVideoSender(): RTCRtpSender | null {
  return groupSession ? groupSession.videoSender() : videoSender();
}

/** Push the effective quality tier onto a 1:1 video sender's first encoding (best-effort:
 *  not every browser honors every field, and there may be no sender yet on audio). */
async function applyVideoQuality(sender: RTCRtpSender | null): Promise<void> {
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
  const tier = QUALITY_ENCODING[effectiveTier()];
  const enc = params.encodings[0];
  if (tier.maxBitrate == null) delete enc.maxBitrate;
  else enc.maxBitrate = tier.maxBitrate;
  enc.scaleResolutionDownBy = tier.scaleResolutionDownBy;
  if (tier.maxFramerate == null) delete enc.maxFramerate;
  else enc.maxFramerate = tier.maxFramerate;
  try {
    await sender.setParameters(params);
  } catch (e) {
    console.warn('[call] could not apply video quality', e);
  }
}

/** Apply the effective tier to the active outgoing video — fanned across every mesh leg
 *  for a group call, or the single sender for 1:1. */
async function applyOutgoingQuality(): Promise<void> {
  if (groupSession) await groupSession.applyVideoQuality(QUALITY_ENCODING[effectiveTier()]);
  else await applyVideoQuality(videoSender());
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
  await applyVideoQuality(sender);
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
  await applyVideoQuality(activeVideoSender());
  // The camera wasn't enumerated on an audio-only call, so re-check now that video is
  // on - this is what makes the flip-camera button appear after an audio->video switch.
  void refreshCameraCount();
  if (renegotiateAfter) await renegotiate();
  if (audioRoute.value !== 'bluetooth') await setRoute('speaker');
  return true;
}

/** Remove the local 1:1 video track (downgrade to audio-only) and reset the route. */
async function removeLocalVideo(): Promise<void> {
  const meta = callMeta.value;
  if (!pc || !meta) return;
  screenSharing.value = false;
  activeScreenTrack?.stop();
  activeScreenTrack = null;
  const sender = videoSender();
  if (sender) {
    sender.track?.stop();
    await sender.replaceTrack(null);
  }
  setLocalVideoTrack(null, true);
  meta.kind = 'audio';
  if (audioRoute.value !== 'bluetooth') await setRoute('earpiece');
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

/** Toggle a call between audio-only and video. 1:1 audio->video goes through the
 *  consent flow (requestVideoUpgrade); 1:1 video->audio downgrades unilaterally (the
 *  peer mirrors it via the renegotiation). Group audio<->video is per-participant
 *  (no consent), negotiated by the SFU. */
export async function toggleVideoMode(): Promise<void> {
  const meta = callMeta.value;
  if (!meta) return;
  if (meta.isGroup ? !groupSession : !pc) return;

  if (meta.kind === 'audio') {
    if (!meta.isGroup) {
      await requestVideoUpgrade(); // 1:1 needs both parties' consent
      return;
    }
    // Group: turn on my own video immediately (the SFU forwards it).
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
  } else {
    if (meta.isGroup) {
      screenSharing.value = false;
      activeScreenTrack?.stop();
      activeScreenTrack = null;
      await groupSession!.removeVideoTrack();
      setLocalVideoTrack(null, true);
      meta.kind = 'audio';
    } else {
      await removeLocalVideo();
      await renegotiate(); // tell the peer to mirror the downgrade
    }
  }
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
  const chatId = await chatIdForPeer(frame.from);
  if (!chatId) return true; // ours, but no session to decrypt with → swallow
  const signal = await openSealedSignal(chatId, frame.ciphertext);
  if (groupSession !== gs || !signal) return true;
  if (type === 'offer') await gs.onPeerOffer(frame.from, signal);
  else if (type === 'answer') await gs.onPeerAnswer(frame.from, signal);
  else await gs.onPeerIce(frame.from, signal);
  return true;
}

export async function handleCallFrame(frame: CallFrame): Promise<void> {
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
      if (meta && meta.callId === frame.callId && callState.value === 'dialing') {
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
      const meta = callMeta.value;
      if (!meta || meta.callId !== frame.callId || !meta.chatId) return;
      const signal = await openSealedSignal(meta.chatId, frame.ciphertext);
      if (!signal || signal.type !== 'ice' || !signal.candidate) return;
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
      if (meta && meta.callId === frame.callId) {
        await teardown(frame.t === 'call-busy' ? 'busy' : 'declined');
      }
      return;
    }

    case 'call-cancel': {
      // The caller withdrew, or we answered on another device → stop ringing.
      const meta = callMeta.value;
      if (meta && meta.callId === frame.callId && callState.value === 'incoming') {
        await teardown(frame.reason === 'answered-elsewhere' ? 'answered-elsewhere' : 'remote', {
          silent: true,
        });
      }
      return;
    }

    case 'call-end': {
      const meta = callMeta.value;
      if (meta && meta.callId === frame.callId) {
        await teardown(frame.reason === 'unavailable' ? 'unavailable' : 'remote');
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
      const afterSet = new Set(after);
      const someoneLeft = [...before].some((id) => !afterSet.has(id));
      if (callMeta.value) callMeta.value.roster = frame.members;
      await gs.onRoster(frame.members);

      if (after.length === 0) {
        if (before.size > 0) {
          // We had company and now we're alone → end the call.
          void toast('Everyone left the call');
          await teardown('remote');
          return;
        }
        // Still the only one in the room → arm the "nobody answered" timeout so a
        // lone group call doesn't hang on "Waiting…" forever.
        armGroupIdleTimeout();
      } else {
        clearGroupIdleTimeout(); // someone is here
        if (someoneLeft) void toast('Someone left the call');
      }
      return;
    }

    case 'call-group-invite':
      // Server fan-out of an incoming group call → ring locally so we can join.
      await handleGroupInvite(frame);
      return;

    // SFU-era frames, dormant under the mesh: the server no longer drives an SFU and
    // mesh never sends keys/stream-ids (each leg is a known peer over native DTLS-SRTP).
    // Left as no-ops so an in-flight frame from a mid-deploy peer is harmlessly ignored.
    case 'call-key':
    case 'call-key-request':
    case 'call-streamid':
    case 'sfu-offer':
    case 'sfu-ice':
    // The client never receives call-join/leave or sfu-answer (server-bound).
    case 'call-join':
    case 'call-leave':
    case 'sfu-answer':
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
