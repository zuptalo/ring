/**
 * Messaging orchestration: turns the on-device identity + a peer's published
 * prekeys into real end-to-end-encrypted 1:1 messages over the relay.
 *
 * Crypto-only by design: this module establishes/advances Double Ratchet
 * sessions and (de)serializes the wire packet, but never touches the chats /
 * contacts / messages stores. The data-layer orchestration (creating the chat,
 * writing message rows) lives in db/queries.ts, which calls into here. That
 * keeps the dependency one-directional (queries → messaging) with no cycle.
 *
 * Wire packet (the opaque `ciphertext` field of a relay msg frame):
 *   - First message(s) from an initiator carry a `prekey` preamble (sender
 *     identity + ephemeral + which of the recipient's prekeys were used) so the
 *     responder can run X3DH. Subsequent messages are `normal` (ratchet only).
 *   - The initiator keeps sending the preamble until it hears back from the
 *     peer (proof the session is established), to tolerate a lost first message.
 */
import { get, put, remove } from '@/db/idb';
import { verify } from './crypto/primitives';
import { bytesToB64url, b64urlToBytes } from './crypto/envelope';
import {
  x3dhInitiator,
  x3dhResponder,
  ratchetInitAlice,
  ratchetInitBob,
  loadSession,
  saveSession,
  type RatchetState,
  type PreKeyBundlePub,
} from './crypto/ratchet';
import { sealMessage, openMessage, openMessagePreview, type MessagePayload, type WireMessage } from './crypto/message';
import { sessionRecord, type SerializedSession } from './crypto/ratchet';
import { withSessionLock, LockTimeoutError } from './cross-lock';
import {
  getIdentityKeys,
  getSignedPreKey,
  getOneTimePreKeyById,
  getPublicBundle,
  replenishOneTimePreKeys,
  isUnlockedNow,
} from './crypto/identity';
import { publishPreKeys, preKeyCount, addOneTimeKeys, fetchPeerBundle } from './api';

interface PreKeyPreamble {
  idEd: string; // sender Ed25519 identity public (b64url)
  idX: string; // sender X25519 identity public (b64url)
  eph: string; // sender ephemeral public (b64url)
  spkId: string; // which of the recipient's signed prekeys
  otkId?: string; // which one-time prekey (if one was consumed)
}

export type WirePacket =
  | ({ v: 1; type: 'prekey'; msg: WireMessage } & PreKeyPreamble)
  | { v: 1; type: 'normal'; msg: WireMessage };

interface SessionMeta {
  peerUserId: string;
  sendPreamble: boolean; // initiator: keep prepending the preamble until peer replies
  preamble?: PreKeyPreamble;
}

/* ---- per-session serialization ----
 *
 * The Double Ratchet is a stateful, strictly-ordered protocol, and every (de)cryption is a
 * read-modify-write: loadSession → advance the ratchet → saveSession. Those three steps MUST
 * be atomic per chat. They weren't, and concurrency exposed it: a group-call mesh leg seals
 * an offer/answer and then trickles a burst of ICE candidates over the SAME pairwise ratchet,
 * so several seal/open calls for one chatId run at once. Each loads the same state, advances
 * independently, and the last saveSession wins — silently corrupting the ratchet, which only
 * surfaces messages later as "ciphertext cannot be decrypted". (Interleaved chat messages and
 * call signals on the same session hit the same race.)
 *
 * Since spec 1032 the critical sections run under withSessionLock (cross-lock.ts): the same
 * in-context FIFO as before, PLUS the cross-context Web Lock 'ring:session:<chatId>'. That
 * upgrade exists because the SW is no longer read-only — behind the sw.fullPersist flag it
 * performs the full authoritative open (openPacketStaged below, incl. DH-ratchet steps) and
 * persists the advance, so page and SW are two writers of the same session row and only a
 * cross-context lock can keep them from interleaving. Where Web Locks don't exist the helper
 * degrades to the in-context mutex — exactly the pre-1032 guarantee — and the SW drain gate
 * keeps full-persist off. Out-of-order delivery is still handled by the ratchet's own
 * skipped-key mechanism. */

/* ---- session metadata (settings store; separate from the ratchet state) ---- */

interface SettingRow<T> {
  key: string;
  value: T;
}

async function getSessionMeta(chatId: string): Promise<SessionMeta | null> {
  const r = await get<SettingRow<SessionMeta>>('settings', `smeta:${chatId}`);
  return r?.value ?? null;
}

async function setSessionMeta(chatId: string, meta: SessionMeta): Promise<void> {
  await put<SettingRow<SessionMeta>>('settings', { key: `smeta:${chatId}`, value: meta });
}

/** Drop a 1:1 ratchet session and its X3DH metadata. Used to tear down the ephemeral,
 *  call-scoped session containers a mesh call opens to non-contact co-participants once
 *  the call ends (a later call simply re-runs X3DH). A no-op if nothing is stored. */
export async function clearSession(chatId: string): Promise<void> {
  await remove('sessions', chatId);
  await remove('sessions', `${chatId}#x3dh-collision`); // spec 2033 side session, if any
  await remove('settings', `smeta:${chatId}`);
}

/* ---- outgoing ---- */

/**
 * Seal a payload for a 1:1 chat. Bootstraps an X3DH session on first use
 * (fetching + verifying the peer's bundle), advances the ratchet, and returns
 * the recipient + wire packet to relay. Returns null when the message can't be
 * sent remotely (group chat, or a local-only/demo contact with no account).
 */
export async function sealForChat(
  chatId: string,
  peerUserId: string,
  isGroup: boolean,
  payload: MessagePayload,
): Promise<{ to: string; packet: WirePacket } | null> {
  if (isGroup) return null; // group messaging (sender keys) is not relay-wired yet
  // Serialize the whole load→advance→save (incl. first-use X3DH bootstrap) per chat so
  // concurrent seals/opens — in THIS context and in the SW — can't corrupt the ratchet.
  return withSessionLock(chatId, async () => {
  let session = await loadSession(chatId);
  let meta = await getSessionMeta(chatId);

  if (!session) {
    const peer = await fetchPeerBundle(peerUserId);
    if (!peer) return null; // peer hasn't published a bundle → not a real account

    // Verify the signed prekey chains to the peer's identity key.
    const edPub = b64urlToBytes(peer.edPub);
    const spkPub = b64urlToBytes(peer.signedPreKey.pub);
    if (!verify(edPub, spkPub, b64urlToBytes(peer.signedPreKey.sig))) {
      throw new Error('peer signed prekey signature invalid');
    }

    const me = getIdentityKeys();
    const bundle: PreKeyBundlePub = {
      identityX: b64urlToBytes(peer.xPub),
      signedPreKey: spkPub,
      oneTimePreKey: peer.oneTimePreKey ? b64urlToBytes(peer.oneTimePreKey.pub) : undefined,
    };
    const { sk, ephemeral } = x3dhInitiator(me.x.privateKey, bundle);
    session = ratchetInitAlice(sk, spkPub); // peer's signed prekey is their initial ratchet key
    meta = {
      peerUserId,
      sendPreamble: true,
      preamble: {
        idEd: bytesToB64url(me.ed.publicKey),
        idX: bytesToB64url(me.x.publicKey),
        eph: bytesToB64url(ephemeral.publicKey),
        spkId: peer.signedPreKey.id,
        otkId: peer.oneTimePreKey?.id,
      },
    };
    await setSessionMeta(chatId, meta);
  }

  const wire = sealMessage(session, payload);
  await saveSession(chatId, session);

  const packet: WirePacket =
    meta?.sendPreamble && meta.preamble
      ? { v: 1, type: 'prekey', ...meta.preamble, msg: wire }
      : { v: 1, type: 'normal', msg: wire };
  return { to: peerUserId, packet };
  });
}

/* ---- incoming ---- */

function establishResponderSession(p: PreKeyPreamble): RatchetState {
  const me = getIdentityKeys();
  const spk = getSignedPreKey();
  if (spk.id !== p.spkId) {
    throw new Error('signed prekey id mismatch (rotated?), cannot establish session');
  }
  const otk = p.otkId ? getOneTimePreKeyById(p.otkId) : null;
  if (p.otkId && !otk) throw new Error('referenced one-time prekey not in keystore');

  const sk = x3dhResponder({
    identityXPriv: me.x.privateKey,
    signedPreKeyPriv: spk.keypair.privateKey,
    oneTimePreKeyPriv: otk?.privateKey,
    initiatorIdentityX: b64urlToBytes(p.idX),
    initiatorEphemeral: b64urlToBytes(p.eph),
  });
  return ratchetInitBob(sk, spk.keypair);
}

/** The sessions-store row holding the COLLISION side session (spec 2033): when a
 *  simultaneous-initiation tie-break declares OUR X3DH the winner, the loser's
 *  in-flight frames (sealed on their doomed initiation) are decrypted with a
 *  responder session persisted under this id. It is receive-only — the send path
 *  never touches it — and is dropped the moment the peer proves convergence by
 *  sending on OUR session. */
const collisionSessionId = (chatId: string) => `${chatId}#x3dh-collision`;

/**
 * Decrypt an incoming wire packet for a (local) chat, advancing/establishing
 * the session. Returns the plaintext payload. The caller (db/queries) persists
 * the resulting message row. Throws if it can't be decrypted/authenticated.
 */
export async function openPacket(chatId: string, raw: unknown): Promise<MessagePayload> {
  const packet = raw as WirePacket;
  if (!packet || (packet.type !== 'prekey' && packet.type !== 'normal')) {
    throw new Error('malformed wire packet');
  }
  // Serialize per chat with the matching seals — see withSessionLock.
  return withSessionLock(chatId, async () => {
  const sideId = collisionSessionId(chatId);
  let session = await loadSession(chatId);
  const hadExistingSession = !!session;
  if (!session) {
    if (packet.type !== 'prekey') {
      throw new Error('no session for incoming message and no prekey preamble');
    }
    session = establishResponderSession(packet);
  }

  // Which state actually opened the packet decides ALL the bookkeeping below:
  //   main    — our existing/fresh-first-contact session worked.
  //   adopted — the peer's initiation replaced ours (re-init, or we lost the tie-break).
  //   side    — WE won a simultaneous-initiation tie-break; their frame was read
  //             with the receive-only collision session and our own initiation stands.
  let openedWith: 'main' | 'adopted' | 'side' = 'main';
  let payload: MessagePayload;
  try {
    payload = openMessage(session, packet.msg);
  } catch (e) {
    const meta0 = await getSessionMeta(chatId);
    // (spec 2033) SIMULTANEOUS INITIATION: the failing packet is a DIFFERENT
    // X3DH initiation while our own initiation is still unconfirmed (we hold a
    // live preamble). Pre-2033 both sides ADOPTED the other's session here — a
    // criss-cross (each sending on the session the other just abandoned) whose
    // every later normal frame was undecryptable, and whose rekey recoveries
    // re-raced the same collision. The fix is a deterministic tie-break BOTH
    // sides compute identically from values both possess (each side sees its
    // own preamble and the peer's): compare the two X3DH ephemeral keys; the
    // larger b64url string wins. The loser adopts the winner's session; the
    // winner keeps its initiation and reads the loser's in-flight frames via
    // the persisted receive-only side session.
    const collision =
      hadExistingSession && packet.type === 'prekey' && !!meta0?.sendPreamble && !!meta0.preamble;
    if (collision && (meta0.preamble as PreKeyPreamble).eph > (packet as PreKeyPreamble & { type: 'prekey' }).eph) {
      // WE WIN: our session + preamble stay untouched. Their colliding frames
      // (all prekey-wrapped — the loser keeps its preamble until it hears back,
      // and by then it has adopted OURS) decrypt with the side session.
      let side = await loadSession(sideId);
      if (side) {
        try {
          payload = openMessage(side, packet.msg);
        } catch {
          // A DIFFERENT initiation than the side session's (e.g. the peer rekeyed
          // mid-collision): re-establish from THIS preamble. Throws if bad.
          side = establishResponderSession(packet);
          payload = openMessage(side, packet.msg);
        }
      } else {
        side = establishResponderSession(packet);
        payload = openMessage(side, packet.msg); // throws if this also fails
      }
      await saveSession(sideId, side);
      openedWith = 'side';
    } else if (hadExistingSession && packet.type === 'prekey') {
      // The peer RE-INITIATED (they deleted the chat and re-ran X3DH), or this
      // is a collision WE LOSE: establish a responder session from the preamble
      // and decrypt with it, replacing our ratchet. (A replayed old prekey could
      // also land here; it can only reset our state, never decrypt our traffic —
      // and with the tie-break an unconfirmed initiator is no longer resettable
      // by a losing replay at all.)
      const fresh = establishResponderSession(packet);
      payload = openMessage(fresh, packet.msg); // throws if this also fails
      session = fresh;
      openedWith = 'adopted';
    } else if (packet.type === 'normal') {
      // Belt-and-braces: a loser's straggler that arrives as a NORMAL packet
      // (possible if their preamble cleared early) still opens on the side
      // session when a collision is pending.
      const side = await loadSession(sideId);
      if (!side) throw e;
      try {
        payload = openMessage(side, packet.msg);
      } catch {
        throw e; // surface the MAIN session's failure, not the side probe's
      }
      await saveSession(sideId, side);
      openedWith = 'side';
    } else {
      throw e;
    }
  }
  if (openedWith !== 'side') await saveSession(chatId, session);

  const meta = await getSessionMeta(chatId);
  if (openedWith === 'main') {
    // The peer sent on OUR session — it is confirmed. Stop prepending the
    // preamble, and drop any collision side state: the loser has converged.
    if (meta?.sendPreamble) {
      meta.sendPreamble = false;
      await setSessionMeta(chatId, meta);
    }
    await remove('sessions', sideId);
  } else if (openedWith === 'adopted') {
    // We are the responder of THEIR session now; our own initiation (if any)
    // is dead — never advertise its preamble again. Any side state belonged
    // to an abandoned collision.
    if (meta?.sendPreamble) {
      await setSessionMeta(chatId, { ...meta, sendPreamble: false, preamble: undefined });
    }
    await remove('sessions', sideId);
  }
  // openedWith === 'side': deliberately NOTHING else — our initiation stands,
  // the preamble keeps riding our outgoing frames (the loser needs it to adopt),
  // and the side session waits for more stragglers.

  return payload;
  });
}

/**
 * Decrypt an incoming packet for PREVIEW ONLY (service-worker notifications).
 *
 * Since spec 1032 this is the SW's FALLBACK path: with sw.fullPersist on (and Web
 * Locks available, device unlockable, no live page claiming the drain) the SW runs
 * the authoritative openPacketStaged below instead. The preview remains the whole
 * story for: the flag off, PIN/passkey-locked devices, deferred frame types
 * (first-contact, cards, reactions, controls), and any lock-timeout/failure
 * degrade — so its conservative rules below still matter.
 *
 * Unlike openPacket this never consumes one-time prekeys, never persists a newly
 * ESTABLISHED responder (X3DH) session, and never clears the initiator send-
 * preamble — first-contact/X3DH and the preamble stay strictly the page's job.
 *
 * It DOES, however, persist the RECEIVING-ratchet advance (incl. the skipped
 * message keys it generates) when an ALREADY-ESTABLISHED session decrypts a
 * NORMAL packet. This is required, not cosmetic: 1:1 call signalling (offer/ICE
 * and spec-0007 `qos`) rides the SAME pairwise ratchet as chat but is sent LIVE
 * over the WebSocket and never queued in the relay. While the app is open those
 * live signals are opened by openPacket, which advances + persists the receiving
 * ratchet — moving the persisted base PAST a chat message still sitting in the
 * relay queue. A purely read-only preview would reload that over-advanced base
 * and re-derive the wrong key for the queued message ("ciphertext cannot be
 * decrypted") → the notification degrades to generic. Persisting the advance lets
 * the preview move forward and caches the skipped keys, so a queued message behind
 * the base stays reachable and a backlog previews in order (FR-001/FR-002).
 *
 * Persisting from the SW is safe because the advance is idempotent with the page's
 * later authoritative open: the Double Ratchet's skipped-key cache (the protocol's
 * own out-of-order mechanism) means openPacket re-finds each key it needs in the
 * persisted cache. Page and SW are different contexts; their writes converge via
 * last-write-wins + that cache — exactly the idempotency the protocol already
 * relies on. The per-chat sessionMutex serializes the load→advance→save so two
 * concurrent background push handlers can't interleave (FR-006).
 *
 * Throws if it can't decrypt/authenticate.
 */
// How long a PREVIEW waits for the cross-context session lock before falling back
// to a fully read-only decrypt. The preview is the SW's no-persist fallback path;
// it must never park behind a lock a frozen page holds (security review F1) — a
// hung preview inside sw.ts's straggler loop would block the notify chain for the
// rest of the SW instance's life, silencing every later push.
const PREVIEW_LOCK_TIMEOUT_MS = 3000;

export async function previewPacket(chatId: string, raw: unknown): Promise<MessagePayload> {
  const packet = raw as WirePacket;
  if (!packet || (packet.type !== 'prekey' && packet.type !== 'normal')) {
    throw new Error('malformed wire packet');
  }
  // Serialize with the matching seals/opens AND with other background previews —
  // now that this path persists, two concurrent SW push handlers must not interleave
  // a load→advance→save on the same session. Bounded: if the lock can't be had
  // promptly (a frozen page can hold it indefinitely), decrypt READ-ONLY instead —
  // persisting nothing is always safe without the lock, and a rich notification
  // still beats a generic one. (Read-only can't advance the persisted base, so a
  // very long backlog may degrade to generic past MAX_SKIP — the pre-2015 behavior,
  // only under lock contention.)
  try {
    return await withSessionLock(chatId, () => previewOpen(chatId, packet, true), {
      timeoutMs: PREVIEW_LOCK_TIMEOUT_MS,
    });
  } catch (e) {
    if (e instanceof LockTimeoutError) return previewOpen(chatId, packet, false);
    throw e;
  }
}

/** The preview decrypt body. `persistAdvance` is true only under the session lock;
 *  without it this is PURE read-only (loads a fresh session copy, writes nothing),
 *  which needs no serialization at all. */
async function previewOpen(chatId: string, packet: WirePacket, persistAdvance: boolean): Promise<MessagePayload> {
  const session = await loadSession(chatId);
  const hadExistingSession = !!session;
  if (!session) {
    // No session yet → this must be a first-contact prekey packet. Establish a
    // responder session IN MEMORY ONLY to decrypt the preview: do NOT consume the
    // one-time prekey and do NOT persist the session. X3DH stays the page's
    // authoritative job (FR-003), so the page's later openPacket still runs it.
    if (packet.type !== 'prekey') throw new Error('no session for incoming message and no prekey preamble');
    return openMessage(establishResponderSession(packet), packet.msg);
  }
  try {
    // openMessagePreview advances the receiving ratchet but keeps THIS message's key
    // in the skipped-key cache, so persisting the advance never makes the message
    // undecryptable for the page's later authoritative open (it re-finds the key in
    // the cache). A prekey re-init (the catch below) deliberately does NOT reach here.
    const { payload, advancedDh } = openMessagePreview(session, packet.msg);
    // Persist ONLY a same-receiving-chain advance (the base moves forward so a backlog previews in
    // order and can pass a point live call/`qos` signalling already advanced). A DH-ratchet step is
    // still NOT persisted here: a DH ratchet mints a fresh SENDING keypair (DHs), i.e. send-state.
    // The preview is the fallback that also runs where Web Locks are ABSENT (withSessionLock then
    // only serializes within this context), and there a page↔SW last-write-wins race could clobber
    // the page's authoritative DHs and permanently break outbound to the peer (adversarial review,
    // pre-1032). The AUTHORITATIVE persist-everything path is openPacketStaged below, which the SW
    // uses only when the cross-context lock is actually held (spec 1032). The DH-step frame still
    // decrypted in-memory for this preview; the page performs (and persists) that ratchet on drain.
    // `persistAdvance` is false on the lock-timeout fallback: no lock held → no writes at all.
    if (persistAdvance && !advancedDh) await saveSession(chatId, session);
    return payload;
  } catch (e) {
    // The established session couldn't open this. If it's a prekey packet the peer
    // likely RE-INITIATED a fresh session (e.g. they deleted the chat). Decrypt with
    // a fresh responder session IN MEMORY ONLY — do NOT persist it or consume the
    // prekey; replacing the live ratchet is the page's authoritative call (FR-003).
    if (hadExistingSession && packet.type === 'prekey') {
      return openMessage(establishResponderSession(packet), packet.msg);
    }
    throw e;
  }
  // Deliberately NO session-meta writes: the send-preamble is cleared only by
  // openPacket (FR-004), never by a preview.
}

/* ---- authoritative SW receive (spec 1032) ---- */

/** Thrown by openPacketStaged for frames the SW must NOT apply authoritatively —
 *  first contact (no session), a peer's prekey re-init, or an undecryptable frame.
 *  The caller defers the frame (preview-only notification, no ack); the page's
 *  drain remains their delivery vehicle. */
export class DeferFrame extends Error {
  constructor(public readonly why: 'no-session' | 'prekey-reinit' | 'undecryptable') {
    super(`frame deferred to the page drain: ${why}`);
    this.name = 'DeferFrame';
  }
}

/** Everything openPacketStaged decrypted but did NOT persist. The caller commits
 *  the rows in ONE idb transaction with the message row + chat update + ledger
 *  mark, so an interruption leaves either the complete result or nothing. */
export interface StagedOpen {
  payload: MessagePayload;
  /** The advanced session (incl. any DH-ratchet step) as a sessions-store row. */
  sessionRow: SerializedSession;
  /** Settings-store rows to commit alongside (the cleared send-preamble, if any). */
  metaWrites: Array<{ key: string; value: unknown }>;
}

/**
 * The service worker's AUTHORITATIVE open (spec 1032, sw.fullPersist): decrypts
 * exactly like openPacket — full consuming open, DH-ratchet steps included — but
 * persists NOTHING. It stages the advanced session + session-meta effects for the
 * caller (sw-drain.ts) to commit atomically with the message row and the
 * exactly-once ledger, so the ack that follows can never outrun a durable commit.
 *
 * This deliberately supersedes, for the locked path only, the old "the SW never
 * persists DH steps" rule: the race that rule guarded against is gone when the
 * caller holds the cross-context session lock. Hence the hard requirements:
 *
 *   - The caller MUST hold withSessionLock(chatId) across THIS CALL AND the
 *     commit of sessionRow/metaWrites. Locks are non-reentrant, so this function
 *     takes none itself; a gap between decrypt and commit would let a page seal
 *     interleave and be clobbered by the stale staged row.
 *   - First-contact X3DH and a peer's prekey re-init are NOT staged (DeferFrame):
 *     consuming a one-time prekey and replacing a live ratchet stay the page's
 *     authoritative jobs, exactly as in previewPacket.
 */
export async function openPacketStaged(chatId: string, raw: unknown): Promise<StagedOpen> {
  const packet = raw as WirePacket;
  if (!packet || (packet.type !== 'prekey' && packet.type !== 'normal')) {
    throw new Error('malformed wire packet');
  }
  const session = await loadSession(chatId);
  if (!session) throw new DeferFrame('no-session'); // first contact → page runs X3DH
  let payload: MessagePayload;
  try {
    payload = openMessage(session, packet.msg); // consuming open; mutates `session`
  } catch {
    // An established session that can't open a PREKEY packet = the peer re-initiated
    // (they deleted the chat and re-ran X3DH). Replacing the live ratchet is the
    // page's call (see openPacket's catch); anything else is simply undecryptable
    // here (e.g. we lost the session) and the page's rekey recovery handles it.
    throw new DeferFrame(packet.type === 'prekey' ? 'prekey-reinit' : 'undecryptable');
  }
  const metaWrites: StagedOpen['metaWrites'] = [];
  // Mirror openPacket: hearing from the peer confirms the session, so the initiator
  // stops prepending the prekey preamble — staged into the same commit.
  const meta = await getSessionMeta(chatId);
  if (meta?.sendPreamble) {
    metaWrites.push({ key: `smeta:${chatId}`, value: { ...meta, sendPreamble: false } });
  }
  return { payload, sessionRow: sessionRecord(chatId, session), metaWrites };
}

/* ---- own prekey publication ---- */

// The identity (edPub) we've already published this session. Keying on the
// identity (not a bare boolean) means a device that registers a NEW account
// (a different identity) re-publishes automatically, instead of being silently
// skipped by a stale `prekeysPublished=true` flag left over from a prior account
// (which left the new account un-discoverable: peers got 404 on its bundle and
// could never start a session, so friend requests/messages never reached it).
let publishedFor: string | null = null;

/** Publish this device's public bundle to the backend (so peers can start
 *  sessions with us). Publishes once per identity; re-publishes when the
 *  identity changes. Idempotent across reloads via an identity-keyed setting. */
export async function publishOwnPreKeysOnce(): Promise<void> {
  const bundle = await getPublicBundle();
  if (!bundle) return; // no identity yet, try again after the keystore is created
  if (publishedFor === bundle.edPub) return;
  const flag = await get<SettingRow<string>>('settings', 'prekeysPublishedFor');
  if (flag?.value === bundle.edPub) {
    publishedFor = bundle.edPub;
    return;
  }
  await publishPreKeys(bundle);
  await put<SettingRow<string>>('settings', { key: 'prekeysPublishedFor', value: bundle.edPub });
  publishedFor = bundle.edPub;
}

// Top the server pool back up to TARGET once it drops below LOW_WATER. Each
// one-time prekey is consumed (one per new contact who starts a session with
// us); without replenishment the pool would eventually empty and new sessions
// would fall back to signed-prekey-only X3DH.
const PREKEY_LOW_WATER = 5;
const PREKEY_TARGET = 20;

/** Replenish the server-side one-time prekey pool if it's running low. Needs the
 *  keystore unlocked (fresh private keys are persisted under the master key).
 *  Safe to call on every reconnect, a no-op while the pool is healthy. */
export async function replenishPreKeysIfLow(): Promise<void> {
  if (!isUnlockedNow()) return;
  let remaining: number;
  try {
    remaining = await preKeyCount();
  } catch {
    return; // offline / transient, retried on the next reconnect
  }
  if (remaining >= PREKEY_LOW_WATER) return;
  const fresh = await replenishOneTimePreKeys(PREKEY_TARGET - remaining);
  if (fresh.length) await addOneTimeKeys(fresh);
}
