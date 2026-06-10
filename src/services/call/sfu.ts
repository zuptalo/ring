/**
 * Group-call client. Each participant keeps ONE PeerConnection to the server's
 * SFU; the SFU forwards everyone's RTP to everyone else. Media is end-to-end
 * encrypted from the SFU via insertable streams (services/call/e2ee), keyed by a
 * per-call group media key distributed peer-to-peer (never to the server).
 *
 * Negotiation is server-offers-only: we publish our tracks, then only ever
 * answer the SFU's offers and trickle ICE, no glare.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { sendLive } from '@/composables/useSync';
import { getSelfUserId } from '@/services/auth';
import { getTurnConfig } from '@/services/call/turn';
import {
  Keyring,
  supportsMediaE2EE,
  getTransformAPI,
  attachSenderE2EE,
  attachReceiverE2EE,
  keyToB64,
  keyFromB64,
} from '@/services/call/e2ee';
import { sendSealedKey, sendSealedStreamId } from '@/services/call/signalling';
import type { CallKind } from '@/services/call/types';

export interface GroupCallbacks {
  /** Called whenever the set of remote streams changes. */
  onRemoteStreams: (streams: MediaStream[]) => void;
  /** Called when the local stream is ready. */
  onLocalStream: (stream: MediaStream) => void;
  /** Called when the PC reaches connected/failed. */
  onConnectionState: (state: RTCPeerConnectionState) => void;
  /** Called when the streamId→userId map (for labelling tiles) changes. */
  onStreamMap: (map: Record<string, string>) => void;
  /** Called when the set of active speakers changes. Each entry is a tile key: a
   *  remote stream id, or SELF_KEY for our own tile. */
  onActiveSpeakers: (keys: string[]) => void;
}

// Tile key for our own outgoing feed - must match the self tile's key in
// CallActivePage so the speaking highlight lines up.
const SELF_KEY = '__self__';
// Active-speaker detection tuning. Web Audio RMS (0..1) above SPEAK_THRESH marks a
// participant as speaking; the highlight then lingers SPEAK_HOLD_MS past the last
// loud sample so it doesn't strobe on the natural gaps between syllables.
const SPEAK_THRESH = 0.05;
const SPEAK_HOLD_MS = 700;
const SAMPLE_MS = 120;

export class GroupSession {
  readonly roomId: string;
  readonly kind: CallKind;
  private selfId: string;
  private keyring = new Keyring();
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private remote = new Map<string, MediaStream>(); // streamId → stream
  private pendingIce: RTCIceCandidateInit[] = [];
  private roster: string[] = [];
  private distributedFor = ''; // roster signature we last keyed for
  private announcedTo = ''; // roster signature we last announced our stream id for
  private streamOwners = new Map<string, string>(); // remote userId → their stream id
  private epoch = 0;
  private currentRaw: Uint8Array | null = null; // raw bytes of the epoch we minted (master), for resends
  private lastKeyReqAt = 0; // throttle outbound key-requests
  private members: string[]; // initiator-only: group members to ring on the first join
  private cb: GroupCallbacks;
  // Per-frame E2EE transport: Chromium uses insertable streams on the main thread;
  // Safari/iOS uses the standard worker-based RTCRtpScriptTransform (one shared
  // worker per session, fed the keyring's keys). Both emit identical frames.
  private transformApi = getTransformAPI();
  private worker: Worker | null = null;
  // Active-speaker detection: one AnalyserNode per audible feed (local + each remote),
  // sampled on a timer. We measure the DECODED audio via Web Audio rather than the RTP
  // audio-level header extension because the SFU strips header extensions, so that
  // signal isn't available here; the decoded path also works identically for E2EE.
  private audioCtx: AudioContext | null = null;
  private analysers = new Map<
    string,
    { src: MediaStreamAudioSourceNode; an: AnalyserNode; buf: Uint8Array<ArrayBuffer> }
  >();
  private levels = new Map<string, number>(); // key → latest RMS (exposed for tests)
  private speaking = new Set<string>(); // keys currently considered speaking
  private lastLoud = new Map<string, number>(); // key → last time above threshold (hold)
  private levelTimer: ReturnType<typeof setInterval> | null = null;

  constructor(roomId: string, kind: CallKind, cb: GroupCallbacks, members: string[] = []) {
    this.roomId = roomId;
    this.kind = kind;
    this.selfId = getSelfUserId() ?? '';
    this.members = members;
    this.cb = cb;
  }

  /** getUserMedia + PeerConnection + publish, then join the room. */
  async start(): Promise<void> {
    if (!supportsMediaE2EE()) {
      throw new Error('encrypted group calls are not supported in this browser');
    }
    // Resolve our id now (post-unlock), not at construction time, since an empty id
    // would corrupt key-master election (members.sort()[0] === selfId).
    this.selfId = getSelfUserId() ?? '';
    if (!this.selfId) throw new Error('not signed in');

    this.local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      // Explicit facingMode (not a bare `true`) is more reliable on older iOS Safari.
      video: this.kind === 'video' ? { facingMode: { ideal: 'user' } } : false,
    });
    this.cb.onLocalStream(this.local);
    this.syncAudioMonitors(); // start metering our own mic for the speaking highlight

    await this.buildPeerConnection();
    // Send the member list ONLY on this initial join, so the server rings the group
    // exactly once (the initiator); later joiners / ICE-recovery re-joins omit it.
    await sendLive({
      t: 'call-join',
      roomId: this.roomId,
      kind: this.kind,
      ...(this.members.length ? { members: this.members } : {}),
    });
  }

  /** (Re)create the PeerConnection, publish our (E2EE) tracks and wire its events.
   *  Shared by start() and recover() so an ICE failure can rebuild the transport
   *  without a fresh getUserMedia or dropping the keyring. */
  /** One shared E2EE worker for the RTCRtpScriptTransform path (Safari/iOS); created
   *  lazily, fed key updates, and asked to report missing-key epochs. */
  private ensureWorker(): Worker | null {
    if (this.transformApi !== 'script') return null;
    if (!this.worker) {
      this.worker = new Worker(new URL('./e2ee-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'missing' && typeof e.data.epoch === 'number') this.onMissingKey(e.data.epoch);
      };
      // Seed any keys we already hold (e.g. on an ICE-recovery rebuild).
      for (const [epoch, raw] of this.rawKeys) this.worker.postMessage({ type: 'key', epoch, raw: raw.slice() });
    }
    return this.worker;
  }

  /** Attach the per-frame E2EE transform to a sender (encrypt) or receiver (decrypt),
   *  using whichever transform API this browser exposes. */
  private attachE2EE(rtp: RTCRtpSender | RTCRtpReceiver, op: 'encrypt' | 'decrypt'): void {
    if (this.transformApi === 'script') {
      const w = this.ensureWorker();
      if (w) (rtp as any).transform = new (globalThis as any).RTCRtpScriptTransform(w, { operation: op });
      return;
    }
    if (op === 'encrypt') attachSenderE2EE(rtp as RTCRtpSender, this.keyring);
    else attachReceiverE2EE(rtp as RTCRtpReceiver, this.keyring, (epoch) => this.onMissingKey(epoch));
  }

  /** Set a group key both locally (insertable path / epoch tracking) and in the
   *  worker (script path), so whichever transform runs has it. */
  private rawKeys = new Map<number, Uint8Array>(); // epoch -> raw (to seed a rebuilt worker)
  private async applyKey(epoch: number, raw: Uint8Array): Promise<void> {
    await this.keyring.set(epoch, raw);
    this.rawKeys.set(epoch, raw.slice());
    if (this.transformApi === 'script') this.ensureWorker()?.postMessage({ type: 'key', epoch, raw: raw.slice() });
  }

  private async buildPeerConnection(): Promise<void> {
    const turn = await getTurnConfig();
    if (!this.local) return; // torn down while we awaited TURN creds → abort

    // Relay-only, matching the SFU side: under the 443-only deployment the only
    // reachable path to the SFU is via the TURN relay. encodedInsertableStreams is the
    // Chromium insertable-streams flag; the standard RTCRtpScriptTransform (Safari)
    // needs no PC flag, so only set it for the insertable path.
    this.pc = new RTCPeerConnection({
      iceServers: turn.iceServers,
      iceTransportPolicy: 'relay',
      ...(this.transformApi === 'insertable' ? { encodedInsertableStreams: true } : {}),
    } as any);

    for (const track of this.local!.getTracks()) {
      const sender = this.pc.addTrack(track, this.local!);
      this.attachE2EE(sender, 'encrypt');
    }

    this.pc.ontrack = (e) => {
      this.attachE2EE(e.receiver, 'decrypt');
      const stream = e.streams[0];
      if (stream) {
        this.remote.set(stream.id, stream);
        stream.addEventListener('removetrack', () => {
          if (stream.getTracks().length === 0) {
            this.remote.delete(stream.id);
            this.emitRemote();
          }
        });
        this.emitRemote();
      }
    };
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        void sendLive({ t: 'sfu-ice', roomId: this.roomId, ciphertext: e.candidate.toJSON() });
      }
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc) this.cb.onConnectionState(this.pc.connectionState);
    };
  }

  /** Recover from an ICE failure: rebuild the PC and re-join the room. The server's
   *  Join is idempotent (it drops our stale PC and re-offers), and we keep the local
   *  stream + keyring so media resumes (no re-key needed while the roster is stable). */
  async recover(): Promise<void> {
    if (!this.local) return; // already torn down
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {
        /* already closed */
      }
    }
    this.pendingIce.length = 0;
    this.remote.clear();
    this.emitRemote(); // tiles will repopulate from the rebuilt connection's ontrack
    await this.buildPeerConnection();
    if (!this.pc || !this.local) return; // torn down mid-rebuild → don't re-join
    await sendLive({ t: 'call-join', roomId: this.roomId, kind: this.kind });
  }

  /** Roster update from the server → announce our stream id, then (re)key if we're the
   *  key master. */
  async onRoster(members: string[]): Promise<void> {
    this.roster = members;
    await this.announceStreamId(members);
    const master = members.slice().sort()[0];
    if (master !== this.selfId) return;
    const sig = members.slice().sort().join(',');
    if (sig === this.distributedFor) return; // already keyed this roster
    this.distributedFor = sig;

    // New epoch + fresh key, set locally (for our own encryption) and fan out
    // to every other member over their 1:1 ratchet. The epoch is a monotonic
    // timestamp so a NEW master after a handover always picks a higher epoch than
    // the previous one (later wall-clock wins), no cross-master collision. Also
    // clamp above the highest epoch we've already SEEN (keyring.current), so even
    // under backward clock skew the rekey strictly supersedes the old key.
    this.epoch = Math.max(Date.now(), this.epoch + 1, this.keyring.current + 1);
    const raw = crypto.getRandomValues(new Uint8Array(32));
    this.currentRaw = raw; // kept so we can answer a key-request resend
    await this.applyKey(this.epoch, raw);
    const b64 = keyToB64(raw);
    for (const m of members) {
      if (m === this.selfId) continue;
      await sendSealedKey(m, this.roomId, this.epoch, b64);
    }
  }

  /** Inbound group media key (from the master) → add to our keyring (+ the worker). */
  async onKey(epoch: number, keyB64: string): Promise<void> {
    await this.applyKey(epoch, keyFromB64(keyB64));
  }

  /** Tell every other member which stream id is ours, so they can label our tile with
   *  our name/avatar. Unlike keying (master only), EVERY member announces its own id.
   *  Re-announced on each roster change so a new joiner learns existing members' ids
   *  and we (re)learn nobody's — prune departed members from our local map too. */
  private async announceStreamId(members: string[]): Promise<void> {
    // Drop mappings for anyone who has left, so a stale tile label can't linger.
    const present = new Set(members);
    let pruned = false;
    for (const id of [...this.streamOwners.keys()]) {
      if (!present.has(id)) {
        this.streamOwners.delete(id);
        pruned = true;
      }
    }
    if (pruned) this.emitStreamMap();

    if (!this.local) return; // not publishing yet → nothing to announce
    const sig = members.slice().sort().join(',');
    if (sig === this.announcedTo) return; // already announced for this roster
    this.announcedTo = sig;
    const streamId = this.local.id;
    for (const m of members) {
      if (m === this.selfId) continue;
      await sendSealedStreamId(m, this.roomId, streamId);
    }
  }

  /** Inbound stream-id announcement from a peer → remember which stream is theirs. */
  onStreamId(fromUserId: string, streamId: string): void {
    if (!fromUserId || !streamId || fromUserId === this.selfId) return;
    if (this.streamOwners.get(fromUserId) === streamId) return;
    this.streamOwners.set(fromUserId, streamId);
    this.emitStreamMap();
  }

  /** Publish the current streamId→userId mapping (the shape the UI wants). */
  private emitStreamMap(): void {
    const map: Record<string, string> = {};
    for (const [userId, streamId] of this.streamOwners) map[streamId] = userId;
    this.cb.onStreamMap(map);
  }

  /** We received media for an epoch we have no key for → ask the master to resend
   *  (throttled). The call-key frame is live-only and never queued, so a momentary
   *  blip when the key was fanned out would otherwise leave us medialess forever. */
  private onMissingKey(_epoch: number): void {
    const now = Date.now();
    if (now - this.lastKeyReqAt < 2000) return; // throttle
    const master = this.roster.slice().sort()[0];
    if (!master || master === this.selfId) return; // no roster yet, or WE are the master
    this.lastKeyReqAt = now;
    void sendLive({ t: 'call-key-request', to: master, roomId: this.roomId });
  }

  /** Master only: re-send the current group key to a member who requested it. */
  async resendKeyTo(member: string): Promise<void> {
    if (!this.currentRaw || !member || member === this.selfId) return;
    const master = this.roster.slice().sort()[0];
    if (master !== this.selfId) return; // only the master holds the authoritative key
    await sendSealedKey(member, this.roomId, this.epoch, keyToB64(this.currentRaw));
  }

  /** Answer an SFU offer (server-offers-only model). */
  async onSfuOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(sdp);
    for (const c of this.pendingIce.splice(0)) {
      try {
        await this.pc.addIceCandidate(c);
      } catch {
        /* ignore */
      }
    }
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await sendLive({ t: 'sfu-answer', roomId: this.roomId, sdp: { type: answer.type, sdp: answer.sdp } });
  }

  async onSfuIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.pc?.remoteDescription) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        /* ignore */
      }
    } else {
      this.pendingIce.push(candidate);
    }
  }

  /** Replace the outgoing video track in place (camera flip / screen share). Keeps
   *  the sender (so its E2EE transform stays attached) and needs no renegotiation.
   *  Returns false if this session has no video sender (an audio-only group call),
   *  since adding video would require an SFU re-offer we don't drive from the client.
   *  Only the sender is touched here; the caller updates the local-preview stream. */
  async replaceVideoTrack(track: MediaStreamTrack): Promise<boolean> {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) return false;
    await sender.replaceTrack(track);
    return true;
  }

  /** Whether we're currently publishing a video track. */
  hasVideo(): boolean {
    return !!this.pc?.getSenders().some((s) => s.track?.kind === 'video');
  }

  /** The outgoing video sender (for applying quality/encoding params), or null when
   *  this is an audio-only group call with nothing to publish yet. */
  videoSender(): RTCRtpSender | null {
    return this.pc?.getSenders().find((s) => s.track?.kind === 'video') ?? null;
  }

  /** Add a video track mid-call (audio->video) and ask the SFU to re-offer so it's
   *  negotiated and forwarded. E2EE is attached to the new sender. */
  async addVideoTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.pc) return;
    const sender = this.pc.addTrack(track, this.local ?? new MediaStream([track]));
    // Use the API-aware helper (like buildPeerConnection), NOT attachSenderE2EE: the
    // latter is insertable-streams only (createEncodedStreams), which is undefined on
    // iOS Safari and threw here, so turning video on mid-call silently failed on iPhone
    // (no self preview, nothing published) while audio + receive kept working.
    this.attachE2EE(sender, 'encrypt');
    await sendLive({ t: 'sfu-renegotiate', roomId: this.roomId });
  }

  /** Remove our video track mid-call (video->audio) and ask the SFU to re-offer. */
  async removeVideoTrack(): Promise<void> {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'video');
    if (this.pc && sender) {
      sender.track?.stop();
      this.pc.removeTrack(sender);
    }
    await sendLive({ t: 'sfu-renegotiate', roomId: this.roomId });
  }

  remoteTrackCount(): number {
    let n = 0;
    for (const s of this.remote.values()) n += s.getTracks().length;
    return n;
  }

  /** Stats for the SFU connection (for bitrate / packet-loss readouts). */
  stats(): Promise<RTCStatsReport> | null {
    return this.pc ? this.pc.getStats() : null;
  }

  /** Leave the room and tear down. */
  leave(): void {
    void sendLive({ t: 'call-leave', roomId: this.roomId });
    this.local?.getTracks().forEach((t) => t.stop());
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {
        /* already closed */
      }
    }
    this.stopAudioMonitor();
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.pc = null;
    this.local = null;
    this.remote.clear();
    this.streamOwners.clear();
    this.announcedTo = '';
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.rawKeys.clear();
  }

  private emitRemote(): void {
    this.cb.onRemoteStreams([...this.remote.values()]);
    this.syncAudioMonitors(); // (re)wire analysers as participants come and go
  }

  /** Latest measured RMS per tile key (for tests/diagnostics). */
  audioLevels(): Record<string, number> {
    return Object.fromEntries(this.levels);
  }

  private ensureAudioCtx(): AudioContext | null {
    if (!this.audioCtx) {
      const Ctor =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.audioCtx = new Ctor();
      } catch {
        return null;
      }
    }
    // A call starts from a user gesture, but the context can still come up suspended.
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    return this.audioCtx;
  }

  /** Reconcile the per-feed AnalyserNodes with the current audible streams (local +
   *  remotes), then make sure the sampling timer is running. Idempotent. */
  private syncAudioMonitors(): void {
    const desired = new Map<string, MediaStream>();
    if (this.local?.getAudioTracks().length) desired.set(SELF_KEY, this.local);
    for (const [id, s] of this.remote) if (s.getAudioTracks().length) desired.set(id, s);

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
        src.connect(an); // analysis only - never connected to destination (no echo)
        this.analysers.set(key, { src, an, buf: new Uint8Array(new ArrayBuffer(an.fftSize)) });
      } catch {
        /* stream may carry no audio yet - retried on the next reconcile */
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
      // RMS of the waveform around its 128 midpoint, normalised to 0..1.
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
