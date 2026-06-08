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
} from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import { isUnlockedNow } from '@/services/crypto/identity';
import { getTurnConfig, rtcConfig } from '@/services/call/turn';
import { sendSealedSignal, openSealedSignal, sendControl, chatIdForPeer } from '@/services/call/signalling';
import { GroupSession } from '@/services/call/sfu';
import { supportsMediaE2EE } from '@/services/call/e2ee';
import { startLoopTone, stopLoopTone } from '@/services/sound';
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
export const callStats = ref({ durationSec: 0, kbpsUp: 0, kbpsDown: 0 });
// Group calls: the remote participants' streams (one per peer) for the tile grid.
export const remoteStreams = ref<MediaStream[]>([]);
// A transient status shown during the call when the connection is degraded
// ('Reconnecting…' while ICE is down, 'Connection unstable' on high packet loss).
export const connectionWarning = ref<string | null>(null);

/* ---- audio output routing (earpiece / loudspeaker / Bluetooth) ---- */
// We model three logical routes the user understands, EARPIECE (held to the ear),
// SPEAKER (loudspeaker) and BLUETOOTH, on top of the one web primitive available:
// HTMLMediaElement.setSinkId + enumerateDevices('audiooutput'). That works on
// Chromium (Android/desktop); iOS has no output-selection API at all (the OS owns
// the route). Even on Android the inner earpiece is often not a distinct sink, so
// earpiece/speaker is best-effort there, but a connected Bluetooth device DOES
// enumerate as its own sink, which is what makes the auto-pick reliable.
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

/** iOS (incl. iPadOS posing as Mac). On iOS there's no setSinkId, but a 1:1 call's
 *  remote audio can still be steered between the earpiece (an <audio> element) and
 *  the loudspeaker (a <video> element); the call UI uses this to offer the toggle. */
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
  if (!supportsAudioOutput()) {
    // iOS: no output-selection API, but for a 1:1 call we can still flip earpiece /
    // speaker via the audio-vs-video element trick (Bluetooth follows the system).
    return isIOS() && !callMeta.value?.isGroup ? ['earpiece', 'speaker'] : [];
  }
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
let groupSession: GroupSession | null = null;
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
const DIAL_TIMEOUT_MS = 45_000; // caller: give up if nobody answers
const GRACE_MS = 12_000; // mid-call: tolerate a blip before ending

/* ---- helpers ---- */

function setState(s: CallState): void {
  callState.value = s;
}

async function toast(message: string): Promise<void> {
  const t = await toastController.create({ message, duration: 1800, position: 'bottom' });
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
  void initAudioRoute(); // enumerate outputs + pick this call's starting route
}

function clearDialTimer(): void {
  if (dialTimer) clearTimeout(dialTimer);
  dialTimer = null;
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
  pendingOffer = null;
  pendingIce.length = 0;
  muted.value = false;
  cameraOff.value = false;
  cameraFacing.value = 'user';
  screenSharing.value = false;
  activeScreenTrack?.stop();
  activeScreenTrack = null;
  screenAddedVideo = false;
  routeInitialized = false; // next call re-applies its kind/BT default route
  lastManualRouteAt = 0; // don't carry a manual-override window into the next call

  // Persist the outcome to local call history (with the data used).
  if (meta) {
    if (wasConnected) {
      const durationSec = Math.max(0, Math.floor((Date.now() - (meta.startedAt ?? Date.now())) / 1000));
      await finishCall(meta.callId, durationSec, totalBytes);
    } else {
      await markCallMissed(meta.callId);
    }
    if (meta) meta.endedReason = reason;
  }

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
  startLoopTone('pulse', 3000); // ringback
  // Caller-side timeout: the server may be buffering the offer for an offline
  // (push-woken) callee, so we can't rely on a fast "unavailable", give up
  // ourselves if nobody answers.
  clearDialTimer();
  dialTimer = setTimeout(() => {
    if (callState.value === 'dialing' || callState.value === 'remote-ringing') {
      void sendControl('call-cancel', contactId, callId, { reason: 'timeout' });
      void teardown('timeout');
    }
  }, DIAL_TIMEOUT_MS);
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
  if (!supportsMediaE2EE()) {
    await toast('Encrypted group calls need a recent Chrome or Edge');
    await teardown('failed', { silent: true });
    return;
  }
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

  groupSession = new GroupSession(
    roomId,
    kind,
    {
      onLocalStream: (s) => (localStream.value = s),
      onRemoteStreams: (s) => (remoteStreams.value = s),
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
  if (!supportsMediaE2EE()) return; // can't run encrypted group calls in this browser
  if (!isUnlockedNow()) return; // locked → can't decrypt the group key; skip the ring

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
        // Adopt the peer's call kind if it changed (they turned video on/off), so our
        // UI shows or hides the video stage to match. Pick up the kind-appropriate
        // default audio route on the change (unless on Bluetooth).
        if (signal.kind && cur.kind !== signal.kind) {
          cur.kind = signal.kind;
          if (audioRoute.value !== 'bluetooth') {
            await setRoute(signal.kind === 'video' ? 'speaker' : 'earpiece');
          }
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
  return pc?.getSenders().find((s) => s.track?.kind === 'video') ?? null;
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
  if (groupSession) return groupSession.replaceVideoTrack(track);
  const sender = videoSender();
  if (!sender) return false;
  await sender.replaceTrack(track);
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

/** Start/stop sharing the screen. While sharing, the outgoing video track is the
 *  display capture; stopping restores the camera (or returns an audio call to audio).
 *  Audio routes to the loudspeaker while sharing (unless on Bluetooth). */
export async function toggleScreenShare(): Promise<void> {
  if (screenSharing.value) {
    await stopScreenShare();
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

/** Toggle a 1:1 call between audio-only and video (adds/removes the camera track and
 *  renegotiates). Group audio<->video isn't supported here (needs an SFU re-offer). */
export async function toggleVideoMode(): Promise<void> {
  const meta = callMeta.value;
  if (!pc || !meta || meta.isGroup) return;
  if (meta.kind === 'audio') {
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: cameraFacing.value } } });
    } catch {
      await toast('Camera unavailable');
      return;
    }
    const track = s.getVideoTracks()[0];
    if (!track) return;
    const sender = videoSender();
    if (sender) await sender.replaceTrack(track);
    else pc.addTrack(track, localStream.value ?? s);
    setLocalVideoTrack(track, true);
    meta.kind = 'video';
    cameraOff.value = false;
    await renegotiate();
    if (audioRoute.value !== 'bluetooth') await setRoute('speaker');
  } else {
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
    await renegotiate();
    if (audioRoute.value !== 'bluetooth') await setRoute('earpiece');
  }
}

/* ---- inbound frame dispatch (called from sync.ts) ---- */

export async function handleCallFrame(frame: CallFrame): Promise<void> {
  switch (frame.t) {
    case 'call-offer':
      await handleOffer(frame);
      return;

    case 'call-ringing': {
      const meta = callMeta.value;
      if (meta && meta.callId === frame.callId && callState.value === 'dialing') {
        setState('remote-ringing');
      }
      return;
    }

    case 'call-answer': {
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

    case 'call-key': {
      const gs = groupSession;
      if (!gs || frame.roomId !== gs.roomId || !frame.from) return;
      const chatId = await chatIdForPeer(frame.from);
      if (!chatId) return;
      const signal = await openSealedSignal(chatId, frame.ciphertext);
      // The session may have been torn down while we decrypted, re-check.
      if (groupSession === gs && signal?.type === 'key' && typeof signal.epoch === 'number' && signal.key) {
        await gs.onKey(signal.epoch, signal.key);
      }
      return;
    }

    case 'call-key-request': {
      // A member is missing the current group key → if we're the master, resend it.
      const gs = groupSession;
      if (!gs || frame.roomId !== gs.roomId || !frame.from) return;
      await gs.resendKeyTo(frame.from);
      return;
    }

    case 'call-group-invite':
      // Server fan-out of an incoming group call → ring locally so we can join.
      await handleGroupInvite(frame);
      return;

    case 'sfu-offer': {
      const gs = groupSession;
      if (!gs || frame.roomId !== gs.roomId) return;
      await gs.onSfuOffer(frame.sdp as RTCSessionDescriptionInit);
      return;
    }

    case 'sfu-ice': {
      const gs = groupSession;
      if (!gs || frame.roomId !== gs.roomId) return;
      await gs.onSfuIce(frame.ciphertext as RTCIceCandidateInit);
      return;
    }

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
    muted,
    cameraOff,
    callStats,
    cameraFacing,
    screenSharing,
    startDirectCall,
    acceptCall,
    rejectCall,
    hangupCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    toggleScreenShare,
    toggleVideoMode,
  };
}
