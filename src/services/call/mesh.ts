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
import { getTurnConfig, rtcConfig, type TurnConfig } from '@/services/call/turn';
import { sendSealedSignal, chatIdForPeer } from '@/services/call/signalling';
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

interface PeerLeg {
  pc: RTCPeerConnection;
  peerId: string;
  polite: boolean; // larger user id is polite: it rolls back on offer collision
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingIce: RTCIceCandidateInit[];
}

export class MeshSession {
  readonly roomId: string;
  readonly kind: CallKind;
  private selfId: string;
  private cb: MeshCallbacks;
  private members: string[]; // initiator-only: members to ring on the first join
  private local: MediaStream | null = null;
  private turn: TurnConfig | null = null;
  private legs = new Map<string, PeerLeg>(); // peerUserId → leg
  private remote = new Map<string, MediaStream>(); // peerUserId → their stream
  private currentEnc: VideoEncoding | null = null; // applied to every leg's video sender
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
    this.turn = await getTurnConfig();
    this.syncAudioMonitors();
    // Initiator sends the member list so the server rings the group exactly once;
    // later joiners / recovery re-joins omit it.
    await sendLive({
      t: 'call-join',
      roomId: this.roomId,
      kind: this.kind,
      ...(this.members.length ? { members: this.members } : {}),
    });
  }

  /** Roster update → open a leg to each new peer, close legs to departed peers. */
  async onRoster(members: string[]): Promise<void> {
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
      await this.drainIce(leg);
      await leg.pc.setLocalDescription(); // implicit answer
      await this.send('call-answer', from, {
        callId: this.roomId,
        type: 'answer',
        sdp: leg.pc.localDescription?.sdp,
        sdpType: leg.pc.localDescription?.type,
        roomId: this.roomId,
      });
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
      await this.drainIce(leg);
    } catch (e) {
      console.warn('[mesh] answer handling failed', e);
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

  /** Per-leg ICE recovery: re-gather on any leg that isn't healthy. */
  async recover(): Promise<void> {
    for (const leg of this.legs.values()) {
      if (leg.pc.connectionState !== 'connected') {
        try {
          leg.pc.restartIce();
        } catch {
          /* not supported / already restarting */
        }
      }
    }
  }

  /** Tear down every leg and stop metering. */
  leave(): void {
    this.stopAudioMonitor();
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    for (const peerId of [...this.legs.keys()]) this.closeLeg(peerId);
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
    if (any && this.currentEnc) await this.applyVideoQuality(this.currentEnc);
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
    if (this.currentEnc) await this.applyVideoQuality(this.currentEnc);
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

  /** Apply an encoding tier to EVERY leg's video sender (the adaptive/manual path). */
  async applyVideoQuality(enc: VideoEncoding): Promise<void> {
    this.currentEnc = enc;
    for (const leg of this.legs.values()) {
      const sender = this.videoSenderOf(leg);
      if (!sender) continue;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      const e = params.encodings[0];
      if (enc.maxBitrate == null) delete e.maxBitrate;
      else e.maxBitrate = enc.maxBitrate;
      e.scaleResolutionDownBy = enc.scaleResolutionDownBy;
      if (enc.maxFramerate == null) delete e.maxFramerate;
      else e.maxFramerate = enc.maxFramerate;
      try {
        await sender.setParameters(params);
      } catch (err) {
        console.warn('[mesh] could not apply video quality', err);
      }
    }
  }

  /** Stats from a representative connected leg (for the bitrate readout). */
  stats(): Promise<RTCStatsReport> | null {
    for (const leg of this.legs.values()) {
      if (leg.pc.connectionState === 'connected') return leg.pc.getStats();
    }
    const first = this.legs.values().next().value as PeerLeg | undefined;
    return first ? first.pc.getStats() : null;
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
    const turn = this.turn ?? (this.turn = await getTurnConfig());
    const pc = new RTCPeerConnection(rtcConfig(turn));
    const leg: PeerLeg = {
      pc,
      peerId,
      polite: this.selfId > peerId, // larger id rolls back on glare
      makingOffer: false,
      ignoreOffer: false,
      pendingIce: [],
    };
    this.legs.set(peerId, leg);

    // Publish our tracks (no E2EE transform, no codec munging — native DTLS-SRTP).
    if (this.local) for (const track of this.local.getTracks()) pc.addTrack(track, this.local);

    // Perfect negotiation: either side may (re)offer; collisions resolve by polite/impolite.
    pc.onnegotiationneeded = async () => {
      try {
        leg.makingOffer = true;
        await pc.setLocalDescription(); // implicit offer
        await this.send('call-offer', peerId, {
          callId: this.roomId,
          type: 'offer',
          kind: this.kind,
          sdp: pc.localDescription?.sdp,
          sdpType: pc.localDescription?.type,
          roomId: this.roomId,
        });
      } catch (e) {
        console.warn('[mesh] negotiation failed', e);
      } finally {
        leg.makingOffer = false;
      }
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      void this.send('call-ice', peerId, {
        callId: this.roomId,
        type: 'ice',
        candidate: e.candidate.toJSON(),
        roomId: this.roomId,
      });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      this.remote.set(peerId, stream);
      // A track being added/removed within the stream (camera on/off) must re-emit so
      // the tiles recompute (and show video vs avatar).
      stream.addEventListener('addtrack', () => this.emitRemote());
      stream.addEventListener('removetrack', () => this.emitRemote());
      this.emitRemote();
      this.emitStreamMap();
    };
    pc.onconnectionstatechange = () => this.onLegState(leg);

    // A new leg that joins while we're already sending video inherits the current tier.
    if (this.currentEnc) void this.applyVideoQuality(this.currentEnc);
    this.emitStreamMap();
    return leg;
  }

  private closeLeg(peerId: string): void {
    const leg = this.legs.get(peerId);
    if (leg) {
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

  private videoSenderOf(leg: PeerLeg): RTCRtpSender | null {
    // Match by the transceiver's video direction so a sender whose track was nulled is
    // still found (avoids adding a duplicate video m-line on a later re-add).
    const tx = leg.pc
      .getTransceivers()
      .find((t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');
    return tx?.sender ?? null;
  }

  private onLegState(leg: PeerLeg): void {
    // Per-leg recovery: a single failed leg re-gathers, it doesn't end the call.
    if (leg.pc.connectionState === 'failed') {
      try {
        leg.pc.restartIce();
      } catch {
        /* unsupported */
      }
    }
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
    const chatId = await chatIdForPeer(peerId);
    if (!chatId) return;
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
