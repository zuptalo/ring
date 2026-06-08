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
  attachSenderE2EE,
  attachReceiverE2EE,
  keyToB64,
  keyFromB64,
} from '@/services/call/e2ee';
import { sendSealedKey } from '@/services/call/signalling';
import type { CallKind } from '@/services/call/types';

export interface GroupCallbacks {
  /** Called whenever the set of remote streams changes. */
  onRemoteStreams: (streams: MediaStream[]) => void;
  /** Called when the local stream is ready. */
  onLocalStream: (stream: MediaStream) => void;
  /** Called when the PC reaches connected/failed. */
  onConnectionState: (state: RTCPeerConnectionState) => void;
}

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
  private epoch = 0;
  private currentRaw: Uint8Array | null = null; // raw bytes of the epoch we minted (master), for resends
  private lastKeyReqAt = 0; // throttle outbound key-requests
  private members: string[]; // initiator-only: group members to ring on the first join
  private cb: GroupCallbacks;

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
      video: this.kind === 'video',
    });
    this.cb.onLocalStream(this.local);

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
  private async buildPeerConnection(): Promise<void> {
    const turn = await getTurnConfig();
    if (!this.local) return; // torn down while we awaited TURN creds → abort

    // Relay-only, matching the SFU side: under the 443-only deployment the only
    // reachable path to the SFU is via the TURN relay. encodedInsertableStreams
    // enables the per-frame E2EE transforms.
    this.pc = new RTCPeerConnection({
      iceServers: turn.iceServers,
      iceTransportPolicy: 'relay',
      encodedInsertableStreams: true,
    } as any);

    for (const track of this.local!.getTracks()) {
      const sender = this.pc.addTrack(track, this.local!);
      attachSenderE2EE(sender, this.keyring);
    }

    this.pc.ontrack = (e) => {
      attachReceiverE2EE(e.receiver, this.keyring, (epoch) => this.onMissingKey(epoch));
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

  /** Roster update from the server → (re)key if we're the key master. */
  async onRoster(members: string[]): Promise<void> {
    this.roster = members;
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
    await this.keyring.set(this.epoch, raw);
    const b64 = keyToB64(raw);
    for (const m of members) {
      if (m === this.selfId) continue;
      await sendSealedKey(m, this.roomId, this.epoch, b64);
    }
  }

  /** Inbound group media key (from the master) → add to our keyring. */
  async onKey(epoch: number, keyB64: string): Promise<void> {
    await this.keyring.set(epoch, keyFromB64(keyB64));
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
    this.pc = null;
    this.local = null;
    this.remote.clear();
  }

  private emitRemote(): void {
    this.cb.onRemoteStreams([...this.remote.values()]);
  }
}
