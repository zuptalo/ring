/**
 * Transport abstraction: the single network seam.
 *
 * Everything that needs the "server" (sync push/pull, message delivery,
 * receipts, key distribution later) depends ONLY on this interface. Today the
 * concrete implementation is `MockTransport`, an in-memory loopback that
 * acknowledges sends and fakes delivery receipts, reproducing the old
 * `simulateDelivery` progression while exercising the real outbox → send →
 * receipt → merge path. `WebSocketTransport` (backend, later) implements the
 * same interface with token auth, heartbeat and reconnect; nothing else changes.
 *
 * Frames are plain JSON (Go-interoperable). Message ciphertext is sealed by the
 * ratchet (see services/messaging.ts) before it reaches the transport, which
 * treats it as opaque.
 */
import { wsUrl } from './config';

export type TransportState = 'offline' | 'connecting' | 'online';

export interface MsgFrame {
  t: 'msg';
  id: string; // message id (correlation)
  to?: string; // recipient user id (set when sending)
  from?: string; // sender user id (set by the server on delivery)
  ciphertext?: unknown; // sealed wire packet, opaque to the transport
}
export interface ReceiptFrame {
  t: 'receipt';
  messageId: string;
  // 'downloaded' is recipient-originated like 'seen', but signals the media bytes are on
  // their device (not a UI tick) so the sender can delete the server blob.
  status: 'sent' | 'delivered' | 'seen' | 'downloaded';
  at: number;
  to?: string; // recipient (for client-originated seen receipts; routed by the server)
  from?: string; // server 'sent'/'delivered' receipts: WHICH recipient confirmed it
  // (scopes the sender's outbox removal: a group message has one copy per member,
  // all sharing the message id, so a receipt must only clear the confirmed copy).
}
export interface RecordsFrame {
  t: 'records';
  store: string;
  rows: unknown[];
  cursor: string | null;
}
export interface TombstoneFrame {
  t: 'tombstone';
  store: string;
  recordId: string;
  deletedAt: number;
}
export interface PullFrame {
  t: 'pull';
  cursor: string | null;
}
export interface AckFrame {
  t: 'ack';
  refId: string;
}

/* ---- presence (server-assisted) ---- */

/** Upload our presence visibility tiers (derived from the privacy settings); the
 *  server enforces them against the contact graph. */
export interface PresencePrefsFrame {
  t: 'presence-prefs';
  onlineTier: string; // 'everyone' | 'contacts' | 'nobody'
  lastSeenTier: string;
  overrides?: Record<string, 'allow' | 'deny'>; // per-contact presence overrides
}
/** Subscribe to (watch) the presence of these user ids (our contacts). */
export interface PresenceSubFrame {
  t: 'presence-sub';
  ids: string[];
}
/** Report our own foreground/background state (drives accurate online status). */
export interface PresenceSelfFrame {
  t: 'presence-self';
  active: boolean;
}
/** Server → client presence update for a watched user. `online` is omitted
 *  (→ false) when not shared; `lastSeen` is omitted (→ undefined/null) when not
 *  shared or never set. */
export interface PresenceFrame {
  t: 'presence';
  user: string;
  online?: boolean;
  lastSeen?: number;
}

/* ---- WebRTC call signalling (live-only; never durably queued) ---- */

/** Kinds of call. */
export type CallKind = 'audio' | 'video';

/**
 * 1:1 signalling frames. SDP/ICE ride encrypted in `ciphertext` (a sealed wire
 * packet, opaque to the server) exactly like a chat message. `call-ringing`,
 * `-accept`, `-reject`, `-cancel`, `-busy`, `-end` carry no payload; they're
 * liveness/control only. The server stamps `from` on delivery.
 */
// `roomId` is set ONLY for a mesh group-call leg (each pair is a direct,
// 1:1-style peer connection); its presence routes the frame to the MeshSession
// for that room instead of the singleton 1:1 path. Absent for real 1:1 calls.
export interface CallOfferFrame {
  t: 'call-offer';
  to?: string;
  from?: string;
  callId: string;
  kind?: CallKind;
  roomId?: string; // mesh group-call leg discriminator
  ciphertext?: unknown; // sealed SDP offer
}
export interface CallAnswerFrame {
  t: 'call-answer';
  to?: string;
  from?: string;
  callId: string;
  roomId?: string; // mesh group-call leg discriminator
  ciphertext?: unknown; // sealed SDP answer
}
export interface CallIceFrame {
  t: 'call-ice';
  to?: string;
  from?: string;
  callId: string;
  roomId?: string; // mesh group-call leg discriminator
  ciphertext?: unknown; // sealed ICE candidate
}
export interface CallControlFrame {
  t: 'call-ringing' | 'call-accept' | 'call-reject' | 'call-cancel' | 'call-busy' | 'call-end';
  to?: string;
  from?: string;
  callId?: string; // 1:1 call id; omitted for a group-invitee cancel, which uses roomId
  roomId?: string; // set when the caller cancels (removes) a not-yet-joined group invitee
  reason?: string; // declined|busy|timeout|hangup|unavailable|answered-elsewhere
  duration?: number; // seconds (informational, on call-end)
}

/** Caller → server: re-ring (recall) ONE group invitee who hasn't joined yet — the
 *  per-tile "ring again" button. The server re-sends the invite + restarts the reminders. */
export interface CallRingFrame {
  t: 'call-ring';
  to: string;
  roomId: string;
  kind?: CallKind;
  members?: string[]; // the full invited set (for the invite's participant list)
}

/* ---- group calls (SFU) ---- */

/** Join/leave a group call room (roomId == group chat id). */
export interface CallJoinFrame {
  t: 'call-join';
  roomId: string;
  kind?: CallKind;
  // Initiator-only: the group members to ring. The server (which has no group
  // object) fans out a call-group-invite to each. Omitted by later joiners and by
  // ICE-recovery re-joins, so only the first join rings the group.
  members?: string[];
}
/** Server → a group member not yet in the room: an incoming group call to join. */
export interface CallGroupInviteFrame {
  t: 'call-group-invite';
  roomId: string;
  from?: string; // the initiator
  kind?: CallKind;
  members?: string[]; // everyone being rung (for a participant count in the UI)
}
/** A member → the key master: please (re)send the current group media key. Live
 *  recovery path for a dropped call-key (which is never durably queued). */
export interface CallKeyRequestFrame {
  t: 'call-key-request';
  to?: string; // the key master (smallest roster id)
  from?: string;
  roomId: string;
}
export interface CallLeaveFrame {
  t: 'call-leave';
  roomId: string;
}
/** Server → members: current roster + key epoch. */
export interface CallRosterFrame {
  t: 'call-roster';
  roomId: string;
  members: string[];
  from?: string;
}
/** Peer-to-peer delivery of the group media key (sealed; never seen by server). */
export interface CallKeyFrame {
  t: 'call-key';
  to?: string;
  from?: string;
  roomId: string;
  ciphertext?: unknown; // sealed { epoch, key }
}
/** Peer-to-peer announcement of "my outgoing stream id is X" (sealed; never seen by
 *  the server). Lets each member label an incoming stream with its owner's name. */
export interface CallStreamIdFrame {
  t: 'call-streamid';
  to?: string;
  from?: string;
  roomId: string;
  ciphertext?: unknown; // sealed { streamId }
}
/** Client↔SFU negotiation (plain, the SFU is the endpoint, carries no keys). */
export interface SfuOfferFrame {
  t: 'sfu-offer';
  to?: string;
  from?: string;
  roomId: string;
  sdp?: unknown;
}
export interface SfuAnswerFrame {
  t: 'sfu-answer';
  to?: string;
  from?: string;
  roomId: string;
  sdp?: unknown;
}
export interface SfuIceFrame {
  t: 'sfu-ice';
  to?: string;
  from?: string;
  roomId: string;
  ciphertext?: unknown; // ICE candidate JSON (reuses the ciphertext slot as opaque carrier)
}
/** Client → SFU: my tracks changed mid-call (camera on/off) — please re-offer. */
export interface SfuRenegotiateFrame {
  t: 'sfu-renegotiate';
  roomId: string;
}
/** 1:1 audio<->video upgrade consent (no SDP; relayed like the other call control
 *  frames): the requester asks, the other party accepts or rejects, and only then do
 *  both sides add their cameras + renegotiate. */
export interface CallUpgradeFrame {
  t: 'call-upgrade-request' | 'call-upgrade-accept' | 'call-upgrade-reject';
  to?: string;
  from?: string;
  callId: string;
}

export type CallFrame =
  | CallOfferFrame
  | CallAnswerFrame
  | CallIceFrame
  | CallControlFrame
  | CallJoinFrame
  | CallLeaveFrame
  | CallRosterFrame
  | CallKeyFrame
  | CallStreamIdFrame
  | CallGroupInviteFrame
  | CallKeyRequestFrame
  | CallRingFrame
  | SfuOfferFrame
  | SfuAnswerFrame
  | SfuIceFrame
  | SfuRenegotiateFrame
  | CallUpgradeFrame;

/** Connect-request notifications (server -> client): an incoming request, or an
 *  update (accepted/rejected) to a request we sent. The client re-reads the
 *  authoritative state from GET /v1/connections on either. */
export interface ConnectReqFrame {
  t: 'connect-req';
  from: string;
}
export interface ConnectUpdateFrame {
  t: 'connect-update';
  from: string;
  state: string; // 'accepted' | 'rejected'
}

/** Content-free nudge that a Wall post addressed to us arrived (spec 0003). Carries
 *  only the author id; the client reconciles by pulling GET /v1/posts. */
export interface PostNewFrame {
  t: 'post-new';
  from: string;
}

/** Content-free nudge that engagement (a reaction) landed on a post we can see; the
 *  client reconciles by pulling that post's engagement. */
export interface PostEngagementFrame {
  t: 'post-engagement';
  post: string;
}

/** Content-free nudge that the author revoked a post from us (e.g. they dropped us from
 *  close friends); the client deletes its local copy of that post. */
export interface PostRevokeFrame {
  t: 'post-revoke';
  post: string;
}

/* ---- ephemeral activity indicators (spec 1009): typing / recording ---- */

/** What a peer is doing in a conversation right now (sealed on the wire). */
export type ActivityKind = 'typing' | 'recording-audio' | 'recording-video';

/** Whether the activity just started/continues (`active`) or ended (`stopped`). */
export type ActivityState = 'active' | 'stopped';

/** Activity tunables — one source of truth (see specs/1009-activity-indicators). */
export const ACTIVITY = {
  /** Re-emit cadence while continuously composing (must be < EXPIRY_MS). */
  KEEPALIVE_MS: 3000,
  /** Auto-clear a peer's indicator this long after its last signal. */
  EXPIRY_MS: 6000,
  /** Max recipients a single client fans group activity out to. */
  GROUP_FANOUT_CAP: 50,
} as const;

/**
 * Ephemeral "is typing / recording" indicator (spec 1009). A live-only relay
 * frame modeled on read receipts: client-originated and addressed {to: peer};
 * the server stamps `from` and relays only to the peer's live sockets — never
 * durably queued, persisted, or pushed. The activity KIND + conversation ride
 * sealed in `ciphertext`, so the server sees only {t, to, from}.
 */
export interface ActivityFrame {
  t: 'activity';
  to?: string; // recipient (client→server); omitted server→client
  from?: string; // server stamps the authenticated sender (server→client)
  ciphertext?: unknown; // sealed { conversationId, kind, state } — opaque to the server
}

export type Frame =
  | MsgFrame
  | ReceiptFrame
  | RecordsFrame
  | TombstoneFrame
  | PullFrame
  | AckFrame
  | PresencePrefsFrame
  | PresenceSubFrame
  | PresenceSelfFrame
  | PresenceFrame
  | ActivityFrame
  | ConnectReqFrame
  | ConnectUpdateFrame
  | PostNewFrame
  | PostEngagementFrame
  | PostRevokeFrame
  | CallFrame;

export interface Transport {
  connect(token: string): Promise<void>;
  disconnect(): void;
  send(frame: Frame): Promise<void>;
  /** Subscribe to inbound frames; returns an unsubscribe fn. */
  onMessage(cb: (frame: Frame) => void): () => void;
  /** Subscribe to connection-state changes; returns an unsubscribe fn. */
  onStateChange(cb: (s: TransportState) => void): () => void;
  readonly state: TransportState;
}

/* ---- mock loopback ---- */

const SENT_MS = 500;
const DELIVERED_MS = 1600;
const READ_MS = 3200;

export class MockTransport implements Transport {
  state: TransportState = 'offline';
  private msgCbs = new Set<(f: Frame) => void>();
  private stateCbs = new Set<(s: TransportState) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  async connect(_token: string): Promise<void> {
    this.setState('connecting');
    // Next tick → online, mimicking a real handshake.
    await Promise.resolve();
    this.setState('online');
  }

  disconnect(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.setState('offline');
  }

  async send(frame: Frame): Promise<void> {
    if (this.state !== 'online') throw new Error('transport offline');
    // Acknowledge anything with a correlation id.
    if (frame.t === 'msg') {
      this.emit({ t: 'ack', refId: frame.id });
      // Fake the recipient/server receipts that a real backend would deliver. Stamp
      // `from` with the recipient so the at-least-once outbox's recipient-scoped
      // removal works if this loopback is ever swapped back in for the real transport.
      this.schedule(SENT_MS, () => this.emit({ t: 'receipt', messageId: frame.id, status: 'sent', at: Date.now(), from: frame.to }));
      this.schedule(DELIVERED_MS, () => this.emit({ t: 'receipt', messageId: frame.id, status: 'delivered', at: Date.now(), from: frame.to }));
      this.schedule(READ_MS, () => this.emit({ t: 'receipt', messageId: frame.id, status: 'seen', at: Date.now(), from: frame.to }));
    } else if (frame.t === 'tombstone') {
      this.emit({ t: 'ack', refId: `${frame.store}:${frame.recordId}` });
    } else if (frame.t === 'pull') {
      // No server data in the mock; a real transport would stream `records`.
      this.emit({ t: 'records', store: '', rows: [], cursor: frame.cursor });
    }
  }

  onMessage(cb: (f: Frame) => void): () => void {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  onStateChange(cb: (s: TransportState) => void): () => void {
    this.stateCbs.add(cb);
    cb(this.state); // emit current immediately
    return () => this.stateCbs.delete(cb);
  }

  private setState(s: TransportState): void {
    this.state = s;
    this.stateCbs.forEach((cb) => cb(s));
  }

  private emit(frame: Frame): void {
    this.msgCbs.forEach((cb) => cb(frame));
  }

  private schedule(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
}

/* ---- real WebSocket transport ---- */

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

/**
 * Talks to the Go relay over a WebSocket. Frames are JSON, one per message.
 * Reconnects with exponential backoff while a token is present (i.e. until
 * disconnect() is called on sign-out). The sync engine drains the outbox on
 * each transition to 'online', so anything queued offline flushes on reconnect.
 */
export class WebSocketTransport implements Transport {
  state: TransportState = 'offline';
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private msgCbs = new Set<(f: Frame) => void>();
  private stateCbs = new Set<(s: TransportState) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private closedByUs = false;

  async connect(token: string): Promise<void> {
    this.token = token;
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    if (this.ws || !this.token) return;
    this.setState('connecting');
    const ws = new WebSocket(wsUrl(this.token));
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.setState('online');
    };
    ws.onmessage = (ev) => {
      let frame: Frame;
      try {
        frame = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as Frame;
      } catch {
        return;
      }
      this.msgCbs.forEach((cb) => cb(frame));
    };
    ws.onclose = () => {
      this.ws = null;
      this.setState('offline');
      if (!this.closedByUs) this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose will follow and drive reconnect; nothing extra needed here.
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByUs || !this.token) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  disconnect(): void {
    this.closedByUs = true;
    this.token = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // don't trigger reconnect
      this.ws.close();
      this.ws = null;
    }
    this.setState('offline');
  }

  async send(frame: Frame): Promise<void> {
    if (this.state !== 'online' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('transport offline');
    }
    this.ws.send(JSON.stringify(frame));
  }

  onMessage(cb: (f: Frame) => void): () => void {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  onStateChange(cb: (s: TransportState) => void): () => void {
    this.stateCbs.add(cb);
    cb(this.state);
    return () => this.stateCbs.delete(cb);
  }

  private setState(s: TransportState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateCbs.forEach((cb) => cb(s));
  }
}
