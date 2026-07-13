/**
 * Mesh group-call client. Each participant holds ONE direct RTCPeerConnection to
 * EACH other participant — exactly like running N simultaneous 1:1 calls. There is
 * no SFU and no per-frame application E2EE: every leg is end-to-end encrypted by
 * native DTLS-SRTP (no middle-box ever sees media), so the codec pipeline is
 * untouched and iOS/Safari negotiates hardware H.264 (which the SFU+VP8 path could
 * not decode). Mesh uplink is O(N) per peer, bounded by the adaptive quality in
 * useCall and a small group-size cap.
 *
 * Signalling reuses the 1:1 sealed-frame path: per-pair offer/answer/ICE are sealed
 * over that pair's Double Ratchet (sealForChat) and relayed by the server, tagged
 * with `roomId` so the receiver routes them here instead of the 1:1 path. Each leg
 * runs the standard "perfect negotiation" pattern (polite/impolite by user-id
 * order) so simultaneous offers and mid-call renegotiations (camera on/off) resolve
 * without glare. This mirrors GroupSession's public surface so useCall barely
 * changes; the active-speaker metering is lifted verbatim from the SFU client.
 */
import { sendLive } from '@/composables/useSync';
import { getSelfUserId } from '@/services/auth';
import { getTurnConfig, warmTurnConfig, callRtcConfig } from '@/services/call/turn';
import { sendSealedSignal, meshSessionChatId, clearCallSession } from '@/services/call/signalling';
import { pushDiag, setDiagSnapshot } from '@/services/call/diag';
import {
  type Tier,
  type ControllerState,
  TIERS,
  tierEncoding,
  initialController,
  nextTier,
  snapshotFromReport,
  clampForPeers,
  tierMin,
  downlinkClassFrom,
  requestedTierOf,
} from '@/services/call/quality';
import type { CallKind } from '@/services/call/types';
import type { CallSignal } from '@/services/crypto/message';

// WebKit/iOS encoders (notably older devices like the iPhone 8) stall when scaleResolutionDownBy
// / maxFramerate are pushed via setParameters — they can stop producing frames entirely, so the
// peer receives no video. There we tier by maxBitrate only. Detected once from the UA (duplicated
// from useCall's isIOS rather than imported, to keep mesh free of a useCall → mesh import cycle).
const isWebKitVideo =
  typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && typeof document !== 'undefined' && 'ontouchend' in document));

export interface MeshCallbacks {
  /** The set of remote streams changed (one per connected peer). */
  onRemoteStreams: (streams: MediaStream[]) => void;
  /** The local stream is ready. */
  onLocalStream: (stream: MediaStream) => void;
  /** Aggregate connection state across all legs (connected once any leg connects). */
  onConnectionState: (state: RTCPeerConnectionState) => void;
  /** streamId → userId map for labelling tiles. In mesh each PC IS a known peer,
   *  so this is derived locally — no sealed stream-id announcements needed. */
  onStreamMap: (map: Record<string, string>) => void;
  /** Tile keys (remote stream ids, or SELF_KEY) currently speaking. */
  onActiveSpeakers: (keys: string[]) => void;
  /** Call waiting (spec 0005): the set of peers who have put US on hold (their tile shows
   *  "on hold"). Empty when nobody has us held. */
  onHeldPeers?: (peerIds: string[]) => void;
  /** Peers whose video has gone dark (their camera-off / adaptive pause detaches the
   *  sending track, so our receiver track mutes — no stream event fires). The tile
   *  grid swaps those peers to avatars off this (spec 2029). */
  onVideoMutedPeers?: (peerIds: string[]) => void;
}

/** Outgoing-video encoding tier (shape matches useCall's QUALITY_ENCODING entry). */
export interface VideoEncoding {
  maxBitrate?: number;
  scaleResolutionDownBy: number;
  maxFramerate?: number;
}

// Tile key for our own outgoing feed — must match the self tile's key in
// CallActivePage so the speaking highlight lines up.
const SELF_KEY = '__self__';
const SPEAK_THRESH = 0.05;
const SPEAK_HOLD_MS = 700;
const SAMPLE_MS = 120;
// Initial-negotiation watchdog: re-send the first offer if unanswered within this window,
// up to this many times (≈5s × 3 = 15s, inside the call's connection-grace window).
const NEGOTIATE_TIMEOUT_MS = 5000;
const NEGOTIATE_MAX_ATTEMPTS = 3;

interface PeerLeg {
  pc: RTCPeerConnection;
  peerId: string;
  polite: boolean; // larger user id is polite: it rolls back on offer collision
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingIce: RTCIceCandidateInit[]; // inbound, buffered until we have a remote description
  pendingLocalIce: RTCIceCandidateInit[]; // outbound, buffered until the leg has negotiated
  // Has this leg exchanged its first offer/answer yet? Until it has, only ONE side
  // (the impolite peer) sends the initial offer — see the negotiation guard in buildLeg.
  negotiated: boolean;
  // Initial-negotiation watchdog (impolite peer only): the first offer is sent exactly once
  // via onnegotiationneeded, so if that single sealed frame is lost during a chaotic join
  // (several people accepting at once on a flaky link) the leg would deadlock — the polite
  // peer can't safely offer (X3DH race). The watchdog retransmits the offer until the leg
  // negotiates, bounded by offerAttempts.
  negotiateTimer?: ReturnType<typeof setTimeout>;
  offerAttempts: number;
  // Per-receiver adaptive-quality state (spec 0004 US4): each leg adapts its OUTGOING video
  // independently from this leg's own getStats, so one call can send different qualities to
  // different peers based on each link. Starts low; climbs/backs off via quality.nextTier.
  qc: ControllerState;
  // Spec 2025 FR-005: true when ADAPTATION detached this leg's video track at tier 'off'
  // (a real pause — the old 1 bps cap kept the encoder "bandwidth limited" forever and
  // video never came back). Only adaptation re-attaches what it detached, so this never
  // fights hold/resume or the camera toggle, which manage tracks through their own paths.
  videoSuspended: boolean;
  // Per-receiver connection health (spec 0007 US2).
  health: LegHealth;
}

/** Spec 0007 US2 per-leg health state. `peerReq` is the latest sealed report FROM this peer (caps
 *  what WE send them); the rest is OUR outgoing-report bookkeeping for this peer — the self-assessed
 *  downlink class, a monotonic seq, change/cadence tracking, and the previous inbound counters used
 *  to turn cumulative getStats totals into per-interval rates. */
interface LegHealth {
  peerReq?: { tier: Tier; seq: number; at: number };
  downlink: Tier;
  seq: number;
  lastSentTier: Tier | null;
  lastSentAt: number;
  inPrevLost: number;
  inPrevRecv: number;
  inPrevDrop: number;
  inPrevFrames: number;
}

function freshLegHealth(): LegHealth {
  return { downlink: 'hd', seq: 0, lastSentTier: null, lastSentAt: 0, inPrevLost: 0, inPrevRecv: 0, inPrevDrop: 0, inPrevFrames: 0 };
}

const MESH_HEALTH_INTERVAL_MS = 2000; // resend each leg's report at least this often (~2s)
const MESH_HEALTH_STALE_MS = 6000; // ignore a peer report older than this → send-side fallback

export class MeshSession {
  readonly roomId: string;
  readonly kind: CallKind;
  private selfId: string;
  private cb: MeshCallbacks;
  private members: string[]; // initiator-only: members to ring on the first join
  private local: MediaStream | null = null;
  private legs = new Map<string, PeerLeg>(); // peerUserId → leg
  private remote = new Map<string, MediaStream>(); // peerUserId → their stream
  // Peers whose video is dark (spec 2029), tracked from two independent sources whose
  // UNION is emitted: the sealed camoff/camon signal (authoritative — every app version
  // ≥2029 sends it) and the receiver track's own mute state (fallback for older senders;
  // browsers fire it inconsistently, and it must never CLEAR a signal-set dark state).
  private signalDark = new Set<string>();
  private trackDark = new Set<string>();
  // The user's camera toggle (spec 2029): while true every leg's video sender stays
  // detached — nothing is encoded or sent, and the peers' receiver tracks mute so
  // their tiles swap to our avatar. Owned by the user; adaptation (videoSuspended)
  // and hold (paused/held) manage their own detaches and never re-attach past this.
  private cameraOff = false;
  // Roster updates apply one at a time (see onRoster): a burst of joins must not interleave.
  private rosterChain: Promise<void> = Promise.resolve();
  // Per-sender setParameters is serialized (interleaving getParameters/setParameters on the
  // SAME sender trips "getParameters() has never been called").
  private qualityChain: Promise<void> = Promise.resolve();
  // Upper-bound tier from the manual quality pin + "use less data" (spec 0004 US4). The
  // adaptive controller may go BELOW this to keep a call alive, but never above it.
  private clampTier: Tier = 'hd';
  // Spec 0007 US4: rendered tile-size ceiling that folds into the health report we send each peer.
  // The group grid is uniform, so `defaultTile` covers all legs (incl. ones that join later);
  // `tileTargets` is an optional per-peer override (e.g. a future spotlight view). Default HD.
  private tileTargets = new Map<string, Tier>();
  private defaultTile: Tier = 'hd';
  // Aggregate connection-state tracking (so a single leg blip doesn't end the call).
  private everConnected = false;
  private lastEmittedState: RTCPeerConnectionState | null = null;

  // Active-speaker metering (lifted from the SFU client; transport-agnostic).
  private audioCtx: AudioContext | null = null;
  private analysers = new Map<
    string,
    { src: MediaStreamAudioSourceNode; an: AnalyserNode; buf: Uint8Array<ArrayBuffer> }
  >();
  private levels = new Map<string, number>();
  private speaking = new Set<string>();
  private lastLoud = new Map<string, number>();
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  // Per-leg RTP snapshot feeding the on-screen ⓘ call-stats panel (see diag.ts).
  private diagTimer: ReturnType<typeof setInterval> | null = null;
  // Call waiting (spec 0005): true while this call is HELD — every leg's senders are detached
  // (replaceTrack(null)) and adaptation is suspended until resume().
  private paused = false;
  // Peers who have put US on hold (their tile shows "on hold"); we pause our outgoing to them.
  private heldPeers = new Set<string>();

  constructor(roomId: string, kind: CallKind, cb: MeshCallbacks, members: string[] = []) {
    this.roomId = roomId;
    this.kind = kind;
    this.selfId = getSelfUserId() ?? '';
    this.members = members;
    this.cb = cb;
  }

  /** getUserMedia, then join the room. Legs are built lazily as the roster arrives.
   *  `existing` reuses an already-captured local stream (call waiting, spec 0005): when this
   *  call is started as the SECOND call, it shares the first call's camera/mic instead of a
   *  second getUserMedia (one capture per device; the active call owns the live tracks). */
  async start(existing?: MediaStream): Promise<void> {
    this.selfId = getSelfUserId() ?? '';
    if (!this.selfId) throw new Error('not signed in');
    // Fast-connect (spec 2008): warm the TURN cache OFF the critical path before awaiting capture,
    // so the credential fetch overlaps getUserMedia instead of running serially after it (the same
    // first-call speed-up applied to the 1:1 paths). Harmless when `existing` reuses a stream.
    warmTurnConfig();
    this.local =
      existing ??
      (await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: this.kind === 'video' ? { facingMode: { ideal: 'user' } } : false,
      }));
    this.cb.onLocalStream(this.local);
    await getTurnConfig(); // now a warm cache hit (fetch overlapped the capture above)
    this.syncAudioMonitors();
    this.startDiag();
    // Initiator sends the member list so the server rings the group exactly once;
    // later joiners / recovery re-joins omit it.
    await sendLive({
      t: 'call-join',
      roomId: this.roomId,
      kind: this.kind,
      ...(this.members.length ? { members: this.members } : {}),
    });
  }

  /** Roster update → open a leg to each new peer, close legs to departed peers. Serialized
   *  through a promise chain so a burst of roster frames (several people accepting at once)
   *  applies strictly in order and two updates never interleave their open/close passes. */
  onRoster(members: string[]): Promise<void> {
    this.rosterChain = this.rosterChain
      .then(() => this.applyRoster(members))
      .catch((e) => console.warn('[mesh] roster apply failed', e));
    return this.rosterChain;
  }

  private async applyRoster(members: string[]): Promise<void> {
    const others = members.filter((m) => m && m !== this.selfId);
    const present = new Set(others);
    for (const peerId of [...this.legs.keys()]) {
      if (!present.has(peerId)) this.closeLeg(peerId);
    }
    for (const peerId of others) {
      if (!this.legs.has(peerId)) await this.buildLeg(peerId);
    }
  }

  /** Inbound per-pair offer from `from` (initial or renegotiation). */
  async onPeerOffer(from: string, signal: CallSignal): Promise<void> {
    if (!signal.sdp) return;
    const leg = await this.buildLeg(from);
    const desc: RTCSessionDescriptionInit = { type: signal.sdpType ?? 'offer', sdp: signal.sdp };
    const collision = leg.makingOffer || leg.pc.signalingState !== 'stable';
    leg.ignoreOffer = !leg.polite && collision;
    if (leg.ignoreOffer) return; // impolite peer keeps its own offer
    try {
      // Modern browsers implicitly roll back the polite peer on collision here.
      await leg.pc.setRemoteDescription(desc);
      leg.negotiated = true; // a paired session now exists; this side may renegotiate too
      this.clearNegotiationWatchdog(leg); // negotiating now — stop any pending retransmit
      await this.drainIce(leg);
      await leg.pc.setLocalDescription(); // implicit answer
      await this.send('call-answer', from, {
        callId: this.roomId,
        type: 'answer',
        sdp: leg.pc.localDescription?.sdp,
        sdpType: leg.pc.localDescription?.type,
        roomId: this.roomId,
      });
      this.flushLocalIce(leg); // session is paired now — release any held candidates
    } catch (e) {
      console.warn('[mesh] offer handling failed', e);
    }
  }

  /** Inbound per-pair answer from `from`. */
  async onPeerAnswer(from: string, signal: CallSignal): Promise<void> {
    const leg = this.legs.get(from);
    if (!leg || !signal.sdp) return;
    try {
      await leg.pc.setRemoteDescription({ type: signal.sdpType ?? 'answer', sdp: signal.sdp });
      leg.negotiated = true; // first offer/answer done; renegotiation glare is now safe
      this.clearNegotiationWatchdog(leg); // the offer landed — stop retransmitting
      await this.drainIce(leg);
      this.flushLocalIce(leg); // release the candidates buffered while the offer was in flight
    } catch (e) {
      console.warn('[mesh] answer handling failed', e);
    }
  }

  /** Send (or, from the watchdog, re-send) this leg's offer, sealed over the pair's ratchet. */
  private async sendOffer(leg: PeerLeg): Promise<void> {
    try {
      leg.makingOffer = true;
      await leg.pc.setLocalDescription(); // implicit offer
      await this.send('call-offer', leg.peerId, {
        callId: this.roomId,
        type: 'offer',
        kind: this.kind,
        sdp: leg.pc.localDescription?.sdp,
        sdpType: leg.pc.localDescription?.type,
        roomId: this.roomId,
      });
    } catch (e) {
      console.warn('[mesh] negotiation failed', e);
    } finally {
      leg.makingOffer = false;
    }
  }

  /** Retransmit the initial offer if it hasn't been answered within the window — covers a
   *  first-offer frame lost during a chaotic simultaneous join. Retransmits the EXISTING
   *  offer SDP (no fresh setLocalDescription → no glare); bounded by offerAttempts, after
   *  which the call-level connection grace takes over. Impolite peer only (it owns the first
   *  offer); the polite peer must not offer first (X3DH race — see buildLeg). */
  private armNegotiationWatchdog(leg: PeerLeg): void {
    if (leg.polite) return;
    this.clearNegotiationWatchdog(leg);
    leg.negotiateTimer = setTimeout(() => {
      if (leg.negotiated || leg.pc.connectionState === 'connected') return;
      if (leg.offerAttempts >= NEGOTIATE_MAX_ATTEMPTS) return; // give up; grace handles it
      leg.offerAttempts++;
      const ld = leg.pc.localDescription;
      if (ld?.type === 'offer') {
        void this.send('call-offer', leg.peerId, {
          callId: this.roomId,
          type: 'offer',
          kind: this.kind,
          sdp: ld.sdp,
          sdpType: ld.type,
          roomId: this.roomId,
        });
      } else {
        void this.sendOffer(leg); // no offer yet (negotiationneeded never fired) → make one
      }
      this.armNegotiationWatchdog(leg); // keep watching until negotiated or attempts exhausted
    }, NEGOTIATE_TIMEOUT_MS);
  }

  private clearNegotiationWatchdog(leg: PeerLeg): void {
    if (leg.negotiateTimer != null) {
      clearTimeout(leg.negotiateTimer);
      leg.negotiateTimer = undefined;
    }
  }

  /** Inbound per-pair ICE candidate from `from` (buffered until the leg has a
   *  remote description, mirroring the 1:1 path). */
  async onPeerIce(from: string, signal: CallSignal): Promise<void> {
    const leg = this.legs.get(from);
    if (!leg || !signal.candidate) return;
    if (leg.pc.remoteDescription) {
      try {
        await leg.pc.addIceCandidate(signal.candidate);
      } catch {
        if (!leg.ignoreOffer) {
          /* a candidate we can't add yet; ignore (the offer may have been ignored) */
        }
      }
    } else {
      leg.pendingIce.push(signal.candidate);
    }
  }

  /** Reconnect after the WebSocket came back (e.g. a Wi-Fi↔cellular handoff): re-affirm our
   *  room membership so the server cancels its grace eviction and re-broadcasts the roster to
   *  the others, then re-gather ICE on every leg. No members → no re-ring. */
  async rejoin(): Promise<void> {
    if (!this.local) return; // already torn down
    await sendLive({ t: 'call-join', roomId: this.roomId, kind: this.kind });
    await this.recover();
  }

  /** Per-leg ICE recovery: re-gather on any leg that isn't healthy. */
  async recover(): Promise<void> {
    for (const leg of this.legs.values()) {
      if (leg.pc.connectionState !== 'connected') await this.restartLegIce(leg);
    }
  }

  /** Restart a leg's ICE with FRESH TURN credentials (spec 0004 FR-034): on a long call the
   *  creds the PC was built with may have expired, so re-fetch (getTurnConfig refreshes) and
   *  setConfiguration before re-gathering — otherwise the restart re-gathers with dead creds.
   *  Uses the same setting-aware callRtcConfig as buildLeg so a restart can never flip the
   *  transport policy away from what the leg was built with (spec 1043). */
  private async restartLegIce(leg: PeerLeg): Promise<void> {
    try {
      leg.pc.setConfiguration(await callRtcConfig());
    } catch {
      /* couldn't refresh creds — fall through and restart with what we have */
    }
    try {
      leg.pc.restartIce();
    } catch {
      /* not supported / already restarting */
    }
  }

  /** Tear down every leg and stop metering. */
  leave(): void {
    // Tell the SERVER we've left so it removes us from the room and broadcasts the new roster:
    // that's how the others learn we're gone (their onRoster closes our leg → our tile waves
    // off and they stop trying to reconnect to us). Without this the server only finds out via
    // our socket disconnecting (after the grace window) — or never, if the socket stays up —
    // leaving a hung tile + reconnect attempts on every other client. (Server is the membership
    // orchestrator; the roster is the authoritative "who's in".)
    void sendLive({ t: 'call-leave', roomId: this.roomId });
    this.stopDiag();
    this.stopAudioMonitor();
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    const peers = [...this.legs.keys()];
    for (const peerId of peers) this.closeLeg(peerId);
    // Drop any ephemeral call-scoped sessions opened to non-contact co-participants, so an
    // ad-hoc call leaves no ratchet (or contact) behind. No-op for real contacts.
    for (const peerId of peers) void clearCallSession(peerId);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.remote.clear();
  }

  /* ---- outgoing video: fan out across every leg ---- */

  /** Replace the outgoing video track on every leg (camera flip / screen share /
   *  quality). Returns true if at least one leg had a video sender. No renegotiation.
   *  While the camera is off the senders stay detached — the swap is accepted for
   *  local state only and setCameraOff(false) attaches whatever track is current. */
  async replaceVideoTrack(track: MediaStreamTrack): Promise<boolean> {
    if (this.cameraOff) return this.legs.size > 0;
    let any = false;
    for (const leg of this.legs.values()) {
      const sender = this.videoSenderOf(leg);
      if (sender) {
        await sender.replaceTrack(track);
        any = true;
      }
    }
    if (any) for (const leg of this.legs.values()) void this.applyLegEncoding(leg);
    return any;
  }

  /** The user's camera toggle (spec 2029): detach/re-attach the video sender on every
   *  leg so camera-off truly stops sending (peers' tracks mute → their tiles show our
   *  avatar) instead of streaming black frames. Camera-on skips legs adaptation has
   *  suspended (tier 'off' owns those; it re-attaches on recovery) and does nothing
   *  while the call is held — resume() honors the flag when it re-attaches. */
  async setCameraOff(off: boolean): Promise<void> {
    this.cameraOff = off;
    // The sealed camoff/camon fans out per leg even while paused — the state must be
    // truthful whenever the peer next renders our tile (spec 2029).
    for (const leg of this.legs.values()) {
      void this.send('call-ice', leg.peerId, { callId: this.roomId, type: off ? 'camoff' : 'camon', roomId: this.roomId });
    }
    if (this.paused) return;
    for (const leg of this.legs.values()) {
      const sender = this.videoSenderOf(leg);
      if (!sender) continue;
      if (off) {
        if (sender.track) await sender.replaceTrack(null).catch(() => {});
      } else if (!leg.videoSuspended && !this.heldPeers.has(leg.peerId)) {
        const v = this.local?.getVideoTracks()[0];
        if (v && v.readyState === 'live') await sender.replaceTrack(v).catch(() => {});
      }
    }
    if (!off) for (const leg of this.legs.values()) void this.applyLegEncoding(leg);
  }

  /** A peer's sealed camera-state signal (spec 2029): authoritative for their tile's
   *  video-vs-avatar choice; the receiver-track mute fallback covers older senders.
   *  camon also clears any track-side dark state — the signal outranks a stale track
   *  reading in browsers that under-report unmute. */
  onPeerCameraState(peerId: string, on: boolean): void {
    if (on) {
      const changed = this.signalDark.delete(peerId) || this.trackDark.delete(peerId);
      if (changed) this.emitVideoMuted();
      return;
    }
    if (this.signalDark.has(peerId)) return;
    this.signalDark.add(peerId);
    this.emitVideoMuted();
  }

  /** Add a video track to every leg (audio→video upgrade). Triggers per-leg
   *  renegotiation via onnegotiationneeded. */
  async addVideoTrack(track: MediaStreamTrack): Promise<void> {
    for (const leg of this.legs.values()) {
      const existing = this.videoSenderOf(leg);
      if (existing) await existing.replaceTrack(track);
      else leg.pc.addTrack(track, this.local ?? new MediaStream([track]));
    }
    for (const leg of this.legs.values()) void this.applyLegEncoding(leg);
  }

  /** Remove our video from every leg (video→audio). removeTrack + renegotiation so
   *  the peer's stream loses the track and shows our avatar (not a black tile). */
  async removeVideoTrack(): Promise<void> {
    for (const leg of this.legs.values()) {
      const sender = this.videoSenderOf(leg);
      if (sender) leg.pc.removeTrack(sender);
    }
  }

  hasVideo(): boolean {
    for (const leg of this.legs.values()) {
      if (leg.pc.getSenders().some((s) => s.track?.kind === 'video')) return true;
    }
    return false;
  }

  /** A representative video sender (for callers that just need one). */
  videoSender(): RTCRtpSender | null {
    for (const leg of this.legs.values()) {
      const s = this.videoSenderOf(leg);
      if (s) return s;
    }
    return null;
  }

  /** The effective per-leg quality ceiling: the manual pin / data-saver clamp, lowered by the
   *  per-peer mesh ceiling (more peers ⇒ N parallel encodes ⇒ a lower cap to keep CPU/uplink
   *  sane). The adaptive controller climbs toward this and backs off below it on congestion. */
  private effectiveCeiling(): Tier {
    return tierMin(this.clampTier, clampForPeers(this.legs.size));
  }

  /** Set the upper-bound quality tier (from the manual pin + data-saver). Immediately brings
   *  any leg currently above the new ceiling down to it; climbing back up is the controller's job. */
  setQualityClamp(clamp: Tier): void {
    this.clampTier = clamp;
    const ceilingIdx = TIERS.indexOf(this.effectiveCeiling());
    const now = Date.now();
    for (const leg of this.legs.values()) {
      if (TIERS.indexOf(leg.qc.tier) > ceilingIdx) {
        leg.qc = { tier: TIERS[ceilingIdx], healthyStreak: 0, unhealthyStreak: 0 };
        void this.applyLegEncoding(leg);
      }
      // spec 0007 US3: the manual pin folds into what we ASK each peer for, so a low/medium pin caps
      // INCOMING too — push an updated report immediately instead of waiting for the next ~2s tick.
      this.pushLegHealth(leg, now);
    }
  }

  /** Compute this leg's requested ceiling (downlink ∧ manual clamp ∧ tile target) and, if it changed
   *  or the cadence elapsed, send a sealed `qos` to the peer. Shared by the periodic poll and the
   *  immediate pin-change path. */
  private pushLegHealth(leg: PeerLeg, now: number): void {
    // Only report health for a CONNECTED leg. Before that there's no downlink to assess, and — more
    // importantly — a qos seal/open competes for the SAME per-chat sessionMutex as the offer/ICE
    // handshake, so emitting it during setup delays ICE delivery and (on a slow CI runner) blows the
    // connection timeout. Gating on `connected` keeps the call-ice channel clear until media is up.
    if (leg.pc.connectionState !== 'connected') return;
    const h = leg.health;
    const tile = this.tileTargets.get(leg.peerId) ?? this.defaultTile;
    const requested = requestedTierOf(h.downlink, this.clampTier, tile);
    if (requested === h.lastSentTier && now - h.lastSentAt < MESH_HEALTH_INTERVAL_MS) return;
    h.lastSentTier = requested;
    h.lastSentAt = now;
    h.seq += 1;
    void this.send('call-ice', leg.peerId, {
      callId: this.roomId,
      type: 'qos',
      qos: { requestedTier: requested, downlinkClass: h.downlink, seq: h.seq },
      roomId: this.roomId,
    });
  }

  /** Apply a leg's current controller tier to its video sender (serialized per the
   *  getParameters/setParameters caveat). No-op until the leg has a negotiated video sender. */
  private applyLegEncoding(leg: PeerLeg): Promise<void> {
    this.qualityChain = this.qualityChain
      .then(() => this.setLegTier(leg))
      .catch((err) => console.warn('[mesh] could not apply video quality', err));
    return this.qualityChain;
  }

  /** Apply the leg's current tier to its video sender. setParameters() rejects with
   *  InvalidModificationError when the params snapshot went stale between getParameters() and
   *  setParameters() — a renegotiation in between (a peer's late join, a camera toggle) bumps
   *  the sender's transactionId / RTCP config, so the object we'd send back no longer matches.
   *  That's transient: re-fetch fresh params and retry once; if it still races, the next ~2s
   *  adapt cycle reapplies it, so we don't even warn for the one-off. */
  private async setLegTier(leg: PeerLeg, retry = true): Promise<void> {
    const sender = this.videoSenderOf(leg);
    if (!sender) return;
    // Tier 'off' is a REAL pause for this leg (spec 2025 FR-005): detach the track so
    // nothing is encoded — the old 1 bps cap left a zombie encode whose own "bandwidth
    // limited" reading kept the leg congested forever. Held legs are left alone: hold
    // owns the detached state (and adaptation is suspended while WE are held).
    if (leg.qc.tier === 'off') {
      if (!leg.videoSuspended && sender.track && !this.paused && !this.heldPeers.has(leg.peerId)) {
        leg.videoSuspended = true;
        await sender.replaceTrack(null).catch(() => {});
      }
      return;
    }
    // Leaving the floor: re-attach ONLY what adaptation itself detached — and never
    // while the user's camera is off (their toggle owns the sender then, spec 2029).
    if (leg.videoSuspended) {
      leg.videoSuspended = false;
      const v = this.local?.getVideoTracks()[0];
      if (v && v.readyState === 'live' && !this.paused && !this.heldPeers.has(leg.peerId) && !this.cameraOff) {
        await sender.replaceTrack(v).catch(() => {});
      }
    }
    // iOS/WebKit: tier by BITRATE ONLY (`avoidEncoderScaling`) — never scaleResolutionDownBy/
    // maxFramerate, which stall the old iPhone H.264 encoder (spec 0005). maxBitrate alone is honored
    // and safe, so per-receiver + manual quality caps (spec 0007) still apply on iOS. Non-iOS gets the
    // full per-tier encoding.
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return;
    const enc = tierEncoding(leg.qc.tier, isWebKitVideo);
    const e = params.encodings[0];
    e.maxBitrate = enc.maxBitrate;
    e.scaleResolutionDownBy = enc.scaleResolutionDownBy;
    if (enc.maxFramerate == null) delete e.maxFramerate;
    else e.maxFramerate = enc.maxFramerate;
    try {
      await sender.setParameters(params);
    } catch (err) {
      if (retry && (err as DOMException)?.name === 'InvalidModificationError') {
        await this.setLegTier(leg, false); // re-read fresh params (post-renegotiation) and retry
        return;
      }
      throw err;
    }
  }

  /** One adaptive step for a leg from a fresh getStats report: update the controller state toward
   *  the clamp — bounded by what this receiver asked for (spec 0007 US2) — and apply the resulting
   *  tier. Per-receiver — driven by THIS leg's link AND this receiver's reported downlink. */
  private adaptLeg(leg: PeerLeg, report: RTCStatsReport): void {
    if (!this.videoSenderOf(leg)) return; // audio-only leg → nothing to tier
    const snap = snapshotFromReport(report);
    const before = leg.qc.tier;
    leg.qc = nextTier(leg.qc, snap, this.effectiveCeiling(), this.legPeerCeiling(leg, Date.now()));
    if (leg.qc.tier !== before) void this.applyLegEncoding(leg);
  }

  /** This receiver's fresh requested ceiling for the leg, or undefined if absent/stale (→ send-side
   *  fallback, FR-004). */
  private legPeerCeiling(leg: PeerLeg, now: number): Tier | undefined {
    const pr = leg.health.peerReq;
    if (!pr || now - pr.at > MESH_HEALTH_STALE_MS) return undefined;
    return pr.tier;
  }

  /** Assess OUR downlink for this leg from its inbound video and (rate-limited) send a sealed `qos`
   *  report to the peer: requestedTier = min(downlink, manual clamp, tile target). Coarse enums only,
   *  carried over the existing call-ice frame (spec 0007 US2). */
  private reportLegHealth(leg: PeerLeg, report: RTCStatsReport, now: number): void {
    let lost = 0;
    let recv = 0;
    let drop = 0;
    let frames = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    report.forEach((st: any) => {
      if (st.type === 'inbound-rtp' && st.kind === 'video') {
        lost += st.packetsLost ?? 0;
        recv += st.packetsReceived ?? 0;
        drop += st.framesDropped ?? 0;
        frames += st.framesReceived ?? st.framesDecoded ?? 0;
      }
    });
    const h = leg.health;
    const dLost = Math.max(0, lost - h.inPrevLost);
    const dRecv = Math.max(0, recv - h.inPrevRecv);
    const dDrop = Math.max(0, drop - h.inPrevDrop);
    const dFrames = Math.max(0, frames - h.inPrevFrames);
    h.inPrevLost = lost;
    h.inPrevRecv = recv;
    h.inPrevDrop = drop;
    h.inPrevFrames = frames;
    const fractionLost = dRecv + dLost > 0 ? dLost / (dRecv + dLost) : 0;
    // packets: the window's evidence size — a near-empty interval must not move the class
    // (spec 2025 FR-006; 1 lost of 3 packets reads as 33% "loss").
    h.downlink = downlinkClassFrom(
      { fractionLost, framesDropped: dDrop, framesReceived: dFrames, packets: dRecv + dLost },
      h.downlink,
    );
    // requestedTier = downlink ∧ manual clamp ∧ tile target — sent (if changed/cadence) by pushLegHealth.
    this.pushLegHealth(leg, now);
  }

  /** A peer's sealed health report arrived (spec 0007 US2): keep the newest (by seq) for that leg;
   *  adaptLeg applies it as a ceiling on what we send them. */
  onPeerHealth(from: string, qos: { requestedTier: Tier; downlinkClass: Tier; seq: number }): void {
    const leg = this.legs.get(from);
    if (!leg) return;
    const pr = leg.health.peerReq;
    if (!pr || qos.seq > pr.seq) {
      leg.health.peerReq = { tier: qos.requestedTier, seq: qos.seq, at: Date.now() };
    }
  }

  /** Spec 0007 US4: set the rendered tile size (CSS px, larger dimension) for a peer's video, so our
   *  requested ceiling to them reflects how big we're actually showing them. Rate-limited by the
   *  ~2s report cadence; an immediate change is picked up on the next tick. */
  setTileTarget(peerId: string, tile: Tier): void {
    this.tileTargets.set(peerId, tile);
  }

  /** Spec 0007 US4: the uniform group grid renders every remote at the same size — set the tier that
   *  size is worth for ALL legs (and future joiners). When it shrinks/grows (more peers, resize), the
   *  next report asks each peer for correspondingly less/more. */
  setAllTileTargets(tile: Tier): void {
    if (tile === this.defaultTile) return;
    this.defaultTile = tile;
    const now = Date.now();
    for (const leg of this.legs.values()) this.pushLegHealth(leg, now);
  }

  /** Stats from a representative connected leg (for the bitrate readout). */
  stats(): Promise<RTCStatsReport> | null {
    for (const leg of this.legs.values()) {
      if (leg.pc.connectionState === 'connected') return leg.pc.getStats();
    }
    const first = this.legs.values().next().value as PeerLeg | undefined;
    return first ? first.pc.getStats() : null;
  }

  /** Test/diagnostic introspection: total inbound video frames decoded across ALL legs, and
   *  each leg's current adaptive tier. The mesh has one PeerConnection per peer, so the 1:1
   *  `inboundVideoFrames()` (which reads a single `pc`) can't see group video — this sums
   *  every leg. Tiers let a test confirm the per-receiver controller climbs/backs off. */
  async meshDiag(): Promise<{
    inboundVideoFrames: number;
    tiers: Record<string, Tier>;
    legs: Record<string, { tier: Tier; requestedByPeer?: Tier; downlink: Tier; limitation?: string }>;
  }> {
    let inboundVideoFrames = 0;
    const tiers: Record<string, Tier> = {};
    const legs: Record<string, { tier: Tier; requestedByPeer?: Tier; downlink: Tier; limitation?: string }> = {};
    for (const leg of this.legs.values()) {
      const short = leg.peerId.slice(0, 8);
      tiers[short] = leg.qc.tier;
      let limitation: string | undefined;
      try {
        (await leg.pc.getStats()).forEach((r) => {
          const s = r as { type: string; kind?: string; framesDecoded?: number; qualityLimitationReason?: string };
          if (s.type === 'inbound-rtp' && s.kind === 'video') inboundVideoFrames += s.framesDecoded ?? 0;
          if (s.type === 'outbound-rtp' && s.kind === 'video' && s.qualityLimitationReason && s.qualityLimitationReason !== 'none') {
            limitation = s.qualityLimitationReason;
          }
        });
      } catch {
        /* a leg mid-teardown can't report; skip it */
      }
      // spec 0007 US5: expose the controller's decision + the peer's reported ceiling for tests/ⓘ.
      legs[short] = { tier: leg.qc.tier, requestedByPeer: leg.health.peerReq?.tier, downlink: leg.health.downlink, limitation };
    }
    return { inboundVideoFrames, tiers, legs };
  }

  /** Every 2s, snapshot each leg's video RTP for the on-screen ⓘ call-stats panel: the
   *  negotiated codec and, per peer, the in/out bitrate + frames decoded. Mesh media is
   *  native DTLS-SRTP, so there is no per-frame E2EE transform / decrypt tally to report. */
  private startDiag(): void {
    if (this.diagTimer != null) return;
    const fmt = (n: number): string =>
      n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
    this.diagTimer = setInterval(() => {
      void (async () => {
        const lines: string[] = [`mesh peers=${this.legs.size} · native DTLS-SRTP (no xform/keys)`];
        for (const leg of this.legs.values()) {
          const short = leg.peerId.slice(0, 8);
          try {
            const report = await leg.pc.getStats();
            this.adaptLeg(leg, report); // per-receiver adaptive quality (spec 0004 US4)
            this.reportLegHealth(leg, report, Date.now()); // tell this peer our downlink (spec 0007 US2)
            const codecs = new Map<string, string>();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            report.forEach((st: any) => {
              if (st.type === 'codec') codecs.set(st.id, String(st.mimeType || '').replace(/^(video|audio)\//, ''));
            });
            const codecOf = (id?: string): string => (id && codecs.get(id)) || '?';
            let out = 'out -';
            let inl = 'in -';
            let lim = '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            report.forEach((st: any) => {
              if (st.type === 'outbound-rtp' && st.kind === 'video') {
                out = `out ${codecOf(st.codecId)} b=${fmt(st.bytesSent || 0)} enc=${st.framesEncoded ?? 0}`;
                if (st.qualityLimitationReason && st.qualityLimitationReason !== 'none') lim = st.qualityLimitationReason;
              }
              if (st.type === 'inbound-rtp' && st.kind === 'video') {
                inl = `in ${codecOf(st.codecId)} pt=${st.payloadType ?? '?'} recv=${st.packetsReceived ?? 0} frm=${st.framesReceived ?? 0} dec=${st.framesDecoded ?? 0} key=${st.keyFramesDecoded ?? 0} drop=${st.framesDropped ?? 0} b=${fmt(st.bytesReceived || 0)}`;
              }
            });
            // spec 0007 US5: make the controller's decision observable — the tier we're sending this
            // peer, why we're limited (if at all), and what THEY asked us for (their downlink/ceiling).
            const pr = leg.health.peerReq;
            const qual = `tier=${leg.qc.tier}${lim ? ' lim:' + lim : ''}${pr ? ` req:${pr.tier}` : ''} dl:${leg.health.downlink}`;
            lines.push(`[${short}] ${leg.pc.connectionState} | ${qual} | ${out} | ${inl}`);
          } catch {
            lines.push(`[${short}] stats error`);
          }
        }
        if (this.legs.size === 0) lines.push('(waiting for peers to join…)');
        setDiagSnapshot(lines);
      })();
    }, 2000);
  }

  private stopDiag(): void {
    if (this.diagTimer != null) {
      clearInterval(this.diagTimer);
      this.diagTimer = null;
    }
  }

  /** Latest measured RMS per tile key (for tests/diagnostics). */
  audioLevels(): Record<string, number> {
    return Object.fromEntries(this.levels);
  }

  remoteTrackCount(): number {
    let n = 0;
    for (const s of this.remote.values()) n += s.getTracks().length;
    return n;
  }

  /* ---- per-leg lifecycle ---- */

  private async buildLeg(peerId: string): Promise<PeerLeg> {
    const existing = this.legs.get(peerId);
    if (existing) return existing;
    // Fetch fresh TURN credentials for THIS leg (spec 0004 FR-034): callRtcConfig's
    // getTurnConfig caches and refreshes ~30s before expiry, so a leg built late in a long
    // call still gets valid, non-expired relay creds — a once-cached per-session snapshot
    // would go stale and the late joiner's ICE would never gather relay candidates. This
    // await is also the only one before the leg is reserved below, so two roster updates
    // racing to open the SAME leg could both get past the check above; re-check and hand
    // back the winner (two PCs to one peer would glare against itself and wedge the leg).
    const cfg = await callRtcConfig();
    const raced = this.legs.get(peerId);
    if (raced) return raced;
    const pc = new RTCPeerConnection(cfg);
    const leg: PeerLeg = {
      pc,
      peerId,
      polite: this.selfId > peerId, // larger id rolls back on glare
      makingOffer: false,
      ignoreOffer: false,
      pendingIce: [],
      pendingLocalIce: [],
      negotiated: false,
      offerAttempts: 0,
      qc: initialController(), // mesh legs start medium (N parallel encoders); the controller climbs
      videoSuspended: false, // spec 2025 FR-005
      health: freshLegHealth(), // spec 0007 US2
    };
    this.legs.set(peerId, leg);

    // Publish our tracks (no E2EE transform, no codec munging — native DTLS-SRTP).
    if (this.local) for (const track of this.local.getTracks()) pc.addTrack(track, this.local);
    // Camera off: keep the video m-line (addTrack above) but detach the sender so a
    // late joiner gets our avatar, not video the user turned off — and tell them so
    // their tile renders the avatar deterministically (spec 2029).
    if (this.cameraOff) {
      const vs = this.videoSenderOf(leg);
      if (vs?.track) void vs.replaceTrack(null).catch(() => {});
      void this.send('call-ice', peerId, { callId: this.roomId, type: 'camoff', roomId: this.roomId });
    }

    // Perfect negotiation: either side may (re)offer; collisions resolve by polite/impolite.
    pc.onnegotiationneeded = async () => {
      // First negotiation only: just ONE side offers (the impolite peer). The mesh seals
      // each leg's SDP over that pair's 1:1 ratchet, and if BOTH sides offer at once on a
      // never-messaged pair they both run X3DH as initiator simultaneously, producing two
      // divergent, unpaired sessions — every later sealed answer/ICE then fails to decrypt
      // and the leg deadlocks. Letting only the impolite peer open the leg means the polite
      // peer first *receives* a packet (establishing a paired responder session) before it
      // ever seals one, and its local tracks ride out in the answer. Once the leg has
      // negotiated once, both sides may renegotiate freely (camera toggle) — a session now
      // exists, so there's no X3DH race and ordinary perfect negotiation applies.
      if (!leg.negotiated && leg.polite) return;
      await this.sendOffer(leg);
      // After the impolite peer's first offer, guard against it being lost in transit.
      if (!leg.negotiated) this.armNegotiationWatchdog(leg);
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const candidate = e.candidate.toJSON();
      // Hold local ICE until this leg's first offer/answer has been exchanged. Each frame
      // is sealed over the pair's 1:1 ratchet, and until the session is confirmed the
      // initiator stamps EVERY outgoing frame with the X3DH prekey preamble. Trickling a
      // flood of preamble-stamped candidates (a video offer yields many) races the offer
      // through the responder's "a prekey packet means (re)establish the session" path and
      // diverges the ratchet, so subsequent frames fail to decrypt. Buffering until the leg
      // has negotiated keeps the offer the ONLY preamble packet — exactly like the 1:1 path
      // — and the candidates then follow as ordinary ratchet messages.
      if (!leg.negotiated) {
        leg.pendingLocalIce.push(candidate);
        return;
      }
      void this.send('call-ice', peerId, { callId: this.roomId, type: 'ice', candidate, roomId: this.roomId });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      pushDiag(`ontrack ${e.track.kind} from ${peerId.slice(0, 8)}`);
      this.remote.set(peerId, stream);
      // A track being added/removed within the stream (camera on/off) must re-emit so
      // the tiles recompute (and show video vs avatar).
      stream.addEventListener('addtrack', () => this.emitRemote());
      stream.addEventListener('removetrack', () => {
        this.refreshVideoMuted(peerId, stream);
        this.emitRemote();
      });
      // The peer's camera-off/adaptive-pause reaches us ONLY as a mute on the
      // receiver track (their sender detached; RTP stopped) — mirror it into the
      // muted set so their tile shows the avatar instead of a dark frame.
      if (e.track.kind === 'video') {
        e.track.addEventListener('mute', () => this.refreshVideoMuted(peerId, stream));
        e.track.addEventListener('unmute', () => this.refreshVideoMuted(peerId, stream));
        this.refreshVideoMuted(peerId, stream);
      }
      this.emitRemote();
      this.emitStreamMap();
    };
    pc.onconnectionstatechange = () => this.onLegState(leg);

    // A new leg starts at its own low tier and adapts independently; apply it once a video
    // sender exists (no-op until then).
    void this.applyLegEncoding(leg);
    this.emitStreamMap();
    return leg;
  }

  private closeLeg(peerId: string): void {
    const leg = this.legs.get(peerId);
    if (leg) {
      this.clearNegotiationWatchdog(leg);
      leg.pc.onicecandidate = null;
      leg.pc.ontrack = null;
      leg.pc.onconnectionstatechange = null;
      leg.pc.onnegotiationneeded = null;
      try {
        leg.pc.close();
      } catch {
        /* already closed */
      }
    }
    this.legs.delete(peerId);
    this.remote.delete(peerId);
    const hadDark = this.signalDark.delete(peerId);
    if (this.trackDark.delete(peerId) || hadDark) this.emitVideoMuted();
    this.emitRemote();
    this.emitStreamMap();
  }

  private async drainIce(leg: PeerLeg): Promise<void> {
    for (const c of leg.pendingIce.splice(0)) {
      try {
        await leg.pc.addIceCandidate(c);
      } catch {
        /* stale/duplicate */
      }
    }
  }

  /** Send any local ICE candidates that were held until the leg's session was paired. */
  private flushLocalIce(leg: PeerLeg): void {
    if (!leg.negotiated) return;
    for (const candidate of leg.pendingLocalIce.splice(0)) {
      void this.send('call-ice', leg.peerId, {
        callId: this.roomId,
        type: 'ice',
        candidate,
        roomId: this.roomId,
      });
    }
  }

  private videoSenderOf(leg: PeerLeg): RTCRtpSender | null {
    return this.senderOfKind(leg, 'video');
  }

  /** The leg's sender for a media kind, matched by the TRANSCEIVER (its receiver track kind
   *  survives our own replaceTrack(null), so a paused/held leg's sender is still found —
   *  avoids adding a duplicate m-line on resume). */
  private senderOfKind(leg: PeerLeg, kind: 'audio' | 'video'): RTCRtpSender | null {
    const tx = leg.pc
      .getTransceivers()
      .find((t) => t.receiver?.track?.kind === kind || t.sender?.track?.kind === kind);
    return tx?.sender ?? null;
  }

  /** Hold this call (spec 0005): detach every leg's audio+video senders (replaceTrack(null))
   *  so we send nothing, and tell each peer we paused so they pause their outgoing to us too —
   *  media stops in BOTH directions. The PeerConnections + ICE stay up so resume is instant;
   *  adaptive sampling is suspended while held. */
  async pause(): Promise<void> {
    if (this.paused) return;
    this.paused = true;
    this.stopDiag();
    for (const leg of this.legs.values()) {
      for (const k of ['audio', 'video'] as const) {
        const s = this.senderOfKind(leg, k);
        if (s?.track) await s.replaceTrack(null).catch(() => {});
      }
      void this.send('call-ice', leg.peerId, { callId: this.roomId, type: 'hold', roomId: this.roomId });
    }
  }

  /** Resume a held call: re-attach the (shared) local tracks to every leg's senders, tell each
   *  peer we resumed, and restart adaptation (from the low tier). `stream` is the call's single
   *  shared camera/mic — the active call owns the live tracks (call waiting). */
  async resume(stream: MediaStream): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    this.local = stream;
    const a = stream.getAudioTracks()[0] ?? null;
    const v = stream.getVideoTracks()[0] ?? null;
    for (const leg of this.legs.values()) {
      const aSender = this.senderOfKind(leg, 'audio');
      if (aSender) await aSender.replaceTrack(a).catch(() => {});
      const vSender = this.senderOfKind(leg, 'video');
      // Resume never resurrects video the user turned off (spec 2029) — camera-on
      // re-attaches via setCameraOff(false) when they choose to.
      if (vSender && v && !this.cameraOff) await vSender.replaceTrack(v).catch(() => {});
      leg.videoSuspended = false; // resume re-attached video; adaptation re-pauses if still needed
      void this.send('call-ice', leg.peerId, { callId: this.roomId, type: 'resume', roomId: this.roomId });
    }
    this.startDiag();
  }

  /** A peer put US on hold (received their sealed `hold`): stop OUR outgoing to that one leg
   *  (the rest of the mesh is untouched — the other members keep talking) and mark the peer
   *  "on hold" for the tile. Mirrors the holder pausing their leg to us. */
  async onPeerHold(from: string): Promise<void> {
    const leg = this.legs.get(from);
    if (!leg) return;
    for (const k of ['audio', 'video'] as const) {
      const s = this.senderOfKind(leg, k);
      if (s?.track) await s.replaceTrack(null).catch(() => {});
    }
    this.heldPeers.add(from);
    this.cb.onHeldPeers?.([...this.heldPeers]);
  }

  /** A peer resumed (received their sealed `resume`): restore OUR outgoing to that leg. */
  async onPeerResume(from: string): Promise<void> {
    const leg = this.legs.get(from);
    if (!leg || !this.local) return;
    const a = this.local.getAudioTracks()[0] ?? null;
    const v = this.local.getVideoTracks()[0] ?? null;
    const aSender = this.senderOfKind(leg, 'audio');
    if (aSender) await aSender.replaceTrack(a).catch(() => {});
    const vSender = this.senderOfKind(leg, 'video');
    if (vSender && v) await vSender.replaceTrack(v).catch(() => {});
    leg.videoSuspended = false; // their resume re-attached our video; adaptation re-pauses if needed
    this.heldPeers.delete(from);
    this.cb.onHeldPeers?.([...this.heldPeers]);
  }

  private onLegState(leg: PeerLeg): void {
    // Per-leg recovery: a single failed leg re-gathers (with refreshed creds), not ending the call.
    if (leg.pc.connectionState === 'failed') void this.restartLegIce(leg);
    const states = [...this.legs.values()].map((l) => l.pc.connectionState);
    const anyConnected = states.some((s) => s === 'connected');
    const allDead = states.length > 0 && states.every((s) => s === 'failed' || s === 'closed');
    let overall: RTCPeerConnectionState | null = null;
    if (anyConnected) {
      this.everConnected = true;
      overall = 'connected';
    } else if (allDead) {
      overall = 'failed';
    } else if (this.everConnected) {
      overall = 'disconnected'; // had peers, lost them all → grace, not teardown
    }
    if (overall && overall !== this.lastEmittedState) {
      this.lastEmittedState = overall;
      this.cb.onConnectionState(overall);
    }
  }

  private async send(
    frameType: 'call-offer' | 'call-answer' | 'call-ice',
    peerId: string,
    signal: CallSignal,
  ): Promise<void> {
    const chatId = await meshSessionChatId(peerId);
    await sendSealedSignal(frameType, chatId, peerId, this.roomId, signal, this.roomId);
  }

  private emitVideoMuted(): void {
    this.cb.onVideoMutedPeers?.([...new Set([...this.signalDark, ...this.trackDark])]);
  }

  /** Recompute one peer's TRACK-side dark state from its stream and emit on change. */
  private refreshVideoMuted(peerId: string, stream: MediaStream): void {
    const vids = stream.getVideoTracks();
    const dark = vids.length > 0 && vids.every((t) => t.muted);
    if (dark === this.trackDark.has(peerId)) return;
    if (dark) this.trackDark.add(peerId);
    else this.trackDark.delete(peerId);
    this.emitVideoMuted();
  }

  private emitRemote(): void {
    this.cb.onRemoteStreams([...this.remote.values()]);
    this.syncAudioMonitors();
  }

  private emitStreamMap(): void {
    const map: Record<string, string> = {};
    for (const [peerId, stream] of this.remote) map[stream.id] = peerId;
    this.cb.onStreamMap(map);
  }

  /* ---- active-speaker metering (lifted verbatim from the SFU client) ---- */

  private ensureAudioCtx(): AudioContext | null {
    if (!this.audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.audioCtx = new Ctor();
      } catch {
        return null;
      }
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    return this.audioCtx;
  }

  private syncAudioMonitors(): void {
    const desired = new Map<string, MediaStream>();
    if (this.local?.getAudioTracks().length) desired.set(SELF_KEY, this.local);
    // Key remote feeds by stream id (the tile key), so the speaking highlight lines up.
    for (const s of this.remote.values()) if (s.getAudioTracks().length) desired.set(s.id, s);

    if (desired.size === 0) {
      this.stopAudioMonitor();
      return;
    }
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;

    for (const [key, stream] of desired) {
      if (this.analysers.has(key)) continue;
      try {
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        an.smoothingTimeConstant = 0.3;
        src.connect(an); // analysis only — never to destination (no echo)
        this.analysers.set(key, { src, an, buf: new Uint8Array(new ArrayBuffer(an.fftSize)) });
      } catch {
        /* stream may carry no audio yet — retried on the next reconcile */
      }
    }
    for (const [key, node] of [...this.analysers]) {
      if (desired.has(key)) continue;
      try {
        node.src.disconnect();
        node.an.disconnect();
      } catch {
        /* already gone */
      }
      this.analysers.delete(key);
      this.levels.delete(key);
      if (this.speaking.delete(key)) this.cb.onActiveSpeakers([...this.speaking]);
      this.lastLoud.delete(key);
    }

    if (this.levelTimer == null && this.analysers.size > 0) {
      this.levelTimer = setInterval(() => this.sampleLevels(), SAMPLE_MS);
    }
  }

  private sampleLevels(): void {
    const now = Date.now();
    let changed = false;
    for (const [key, { an, buf }] of this.analysers) {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      this.levels.set(key, rms);
      if (rms > SPEAK_THRESH) {
        this.lastLoud.set(key, now);
        if (!this.speaking.has(key)) {
          this.speaking.add(key);
          changed = true;
        }
      } else if (this.speaking.has(key) && now - (this.lastLoud.get(key) ?? 0) > SPEAK_HOLD_MS) {
        this.speaking.delete(key);
        changed = true;
      }
    }
    if (changed) this.cb.onActiveSpeakers([...this.speaking]);
  }

  private stopAudioMonitor(): void {
    if (this.levelTimer != null) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    for (const node of this.analysers.values()) {
      try {
        node.src.disconnect();
        node.an.disconnect();
      } catch {
        /* already gone */
      }
    }
    this.analysers.clear();
    this.levels.clear();
    if (this.speaking.size) {
      this.speaking.clear();
      this.cb.onActiveSpeakers([]);
    }
    this.lastLoud.clear();
  }
}
