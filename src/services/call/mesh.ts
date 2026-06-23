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
import { getTurnConfig, rtcConfig } from '@/services/call/turn';
import { sendSealedSignal, meshSessionChatId, clearCallSession } from '@/services/call/signalling';
import { pushDiag, setDiagSnapshot } from '@/services/call/diag';
import {
  type Tier,
  type ControllerState,
  TIERS,
  TIER_ENCODING,
  initialController,
  nextTier,
  snapshotFromReport,
  clampForPeers,
  tierMin,
} from '@/services/call/quality';
import type { CallKind } from '@/services/call/types';
import type { CallSignal } from '@/services/crypto/message';

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
}

export class MeshSession {
  readonly roomId: string;
  readonly kind: CallKind;
  private selfId: string;
  private cb: MeshCallbacks;
  private members: string[]; // initiator-only: members to ring on the first join
  private local: MediaStream | null = null;
  private legs = new Map<string, PeerLeg>(); // peerUserId → leg
  private remote = new Map<string, MediaStream>(); // peerUserId → their stream
  // Roster updates apply one at a time (see onRoster): a burst of joins must not interleave.
  private rosterChain: Promise<void> = Promise.resolve();
  // Per-sender setParameters is serialized (interleaving getParameters/setParameters on the
  // SAME sender trips "getParameters() has never been called").
  private qualityChain: Promise<void> = Promise.resolve();
  // Upper-bound tier from the manual quality pin + "use less data" (spec 0004 US4). The
  // adaptive controller may go BELOW this to keep a call alive, but never above it.
  private clampTier: Tier = 'hd';
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

  constructor(roomId: string, kind: CallKind, cb: MeshCallbacks, members: string[] = []) {
    this.roomId = roomId;
    this.kind = kind;
    this.selfId = getSelfUserId() ?? '';
    this.members = members;
    this.cb = cb;
  }

  /** getUserMedia, then join the room. Legs are built lazily as the roster arrives. */
  async start(): Promise<void> {
    this.selfId = getSelfUserId() ?? '';
    if (!this.selfId) throw new Error('not signed in');
    this.local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: this.kind === 'video' ? { facingMode: { ideal: 'user' } } : false,
    });
    this.cb.onLocalStream(this.local);
    await getTurnConfig(); // warm the (refresh-aware) TURN-cred cache before legs build
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
   *  setConfiguration before re-gathering — otherwise the restart re-gathers with dead creds. */
  private async restartLegIce(leg: PeerLeg): Promise<void> {
    try {
      const turn = await getTurnConfig();
      leg.pc.setConfiguration(rtcConfig(turn));
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
   *  quality). Returns true if at least one leg had a video sender. No renegotiation. */
  async replaceVideoTrack(track: MediaStreamTrack): Promise<boolean> {
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
    for (const leg of this.legs.values()) {
      if (TIERS.indexOf(leg.qc.tier) > ceilingIdx) {
        leg.qc = { tier: TIERS[ceilingIdx], healthyStreak: 0 };
        void this.applyLegEncoding(leg);
      }
    }
  }

  /** Apply a leg's current controller tier to its video sender (serialized per the
   *  getParameters/setParameters caveat). No-op until the leg has a negotiated video sender. */
  private applyLegEncoding(leg: PeerLeg): Promise<void> {
    this.qualityChain = this.qualityChain
      .then(async () => {
        const sender = this.videoSenderOf(leg);
        if (!sender) return;
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) return;
        const enc = TIER_ENCODING[leg.qc.tier];
        const e = params.encodings[0];
        e.maxBitrate = enc.maxBitrate;
        e.scaleResolutionDownBy = enc.scaleResolutionDownBy;
        if (enc.maxFramerate == null) delete e.maxFramerate;
        else e.maxFramerate = enc.maxFramerate;
        await sender.setParameters(params);
      })
      .catch((err) => console.warn('[mesh] could not apply video quality', err));
    return this.qualityChain;
  }

  /** One adaptive step for a leg from a fresh getStats report: update the controller state
   *  toward the clamp and apply the resulting tier. Per-receiver — driven by THIS leg's link. */
  private adaptLeg(leg: PeerLeg, report: RTCStatsReport): void {
    if (!this.videoSenderOf(leg)) return; // audio-only leg → nothing to tier
    const snap = snapshotFromReport(report);
    const before = leg.qc.tier;
    leg.qc = nextTier(leg.qc, snap, this.effectiveCeiling());
    if (leg.qc.tier !== before) void this.applyLegEncoding(leg);
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
  async meshDiag(): Promise<{ inboundVideoFrames: number; tiers: Record<string, Tier> }> {
    let inboundVideoFrames = 0;
    const tiers: Record<string, Tier> = {};
    for (const leg of this.legs.values()) {
      tiers[leg.peerId.slice(0, 8)] = leg.qc.tier;
      try {
        (await leg.pc.getStats()).forEach((r) => {
          const s = r as { type: string; kind?: string; framesDecoded?: number };
          if (s.type === 'inbound-rtp' && s.kind === 'video') inboundVideoFrames += s.framesDecoded ?? 0;
        });
      } catch {
        /* a leg mid-teardown can't report; skip it */
      }
    }
    return { inboundVideoFrames, tiers };
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
            const codecs = new Map<string, string>();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            report.forEach((st: any) => {
              if (st.type === 'codec') codecs.set(st.id, String(st.mimeType || '').replace(/^(video|audio)\//, ''));
            });
            const codecOf = (id?: string): string => (id && codecs.get(id)) || '?';
            let out = 'out -';
            let inl = 'in -';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            report.forEach((st: any) => {
              if (st.type === 'outbound-rtp' && st.kind === 'video') {
                out = `out ${codecOf(st.codecId)} b=${fmt(st.bytesSent || 0)} enc=${st.framesEncoded ?? 0}`;
              }
              if (st.type === 'inbound-rtp' && st.kind === 'video') {
                inl = `in ${codecOf(st.codecId)} pt=${st.payloadType ?? '?'} recv=${st.packetsReceived ?? 0} frm=${st.framesReceived ?? 0} dec=${st.framesDecoded ?? 0} key=${st.keyFramesDecoded ?? 0} drop=${st.framesDropped ?? 0} b=${fmt(st.bytesReceived || 0)}`;
              }
            });
            lines.push(`[${short}] ${leg.pc.connectionState} | ${out} | ${inl}`);
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
    // Fetch fresh TURN credentials for THIS leg (spec 0004 FR-034): getTurnConfig caches and
    // refreshes ~30s before expiry, so a leg built late in a long call still gets valid,
    // non-expired relay creds — a once-cached per-session snapshot would go stale and the
    // late joiner's relay-only ICE would never gather. This await is also the only one before
    // the leg is reserved below, so two roster updates racing to open the SAME leg could both
    // get past the check above; re-check and hand back the winner (two PCs to one peer would
    // glare against itself and wedge the leg).
    const turn = await getTurnConfig();
    const raced = this.legs.get(peerId);
    if (raced) return raced;
    const pc = new RTCPeerConnection(rtcConfig(turn));
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
      qc: initialController(), // starts sending low; the controller climbs from there
    };
    this.legs.set(peerId, leg);

    // Publish our tracks (no E2EE transform, no codec munging — native DTLS-SRTP).
    if (this.local) for (const track of this.local.getTracks()) pc.addTrack(track, this.local);

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
      stream.addEventListener('removetrack', () => this.emitRemote());
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
    // Match by the transceiver's video direction so a sender whose track was nulled is
    // still found (avoids adding a duplicate video m-line on a later re-add).
    const tx = leg.pc
      .getTransceivers()
      .find((t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');
    return tx?.sender ?? null;
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
