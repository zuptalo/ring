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
import { sealMessage, openMessage, type MessagePayload, type WireMessage } from './crypto/message';
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

  let session = await loadSession(chatId);
  const hadExistingSession = !!session;
  if (!session) {
    if (packet.type !== 'prekey') {
      throw new Error('no session for incoming message and no prekey preamble');
    }
    session = establishResponderSession(packet);
  }

  let payload: MessagePayload;
  try {
    payload = openMessage(session, packet.msg);
  } catch (e) {
    // The existing session couldn't open this. If it's a prekey packet, the peer
    // RE-INITIATED a fresh session, most commonly because they deleted the chat
    // (which tears down their ratchet) and started a new one, so the new chat
    // re-runs X3DH. Establish a new responder session from this preamble and
    // decrypt with it, replacing the stale ratchet. (A replayed old prekey could
    // also land here; it can only reset our state, never decrypt our traffic.)
    if (hadExistingSession && packet.type === 'prekey') {
      const fresh = establishResponderSession(packet);
      payload = openMessage(fresh, packet.msg); // throws if this also fails
      session = fresh;
    } else {
      throw e;
    }
  }
  await saveSession(chatId, session);

  // If we were the initiator awaiting the peer, the session is now confirmed,
  // so stop prepending the prekey preamble to our outgoing messages.
  const meta = await getSessionMeta(chatId);
  if (meta?.sendPreamble) {
    meta.sendPreamble = false;
    await setSessionMeta(chatId, meta);
  }

  return payload;
}

/**
 * Decrypt an incoming packet for PREVIEW ONLY (service-worker notifications).
 * Unlike openPacket it does NOT persist the advanced ratchet, consume prekeys, or
 * clear the send-preamble, so it never disturbs the session state the page will
 * advance for real when it next drains the relay. Safe to run in the service
 * worker: the ratchet advance happens on an in-memory copy that's discarded.
 * Throws if it can't decrypt/authenticate.
 */
export async function previewPacket(chatId: string, raw: unknown): Promise<MessagePayload> {
  const packet = raw as WirePacket;
  if (!packet || (packet.type !== 'prekey' && packet.type !== 'normal')) {
    throw new Error('malformed wire packet');
  }
  let session = await loadSession(chatId);
  const hadExistingSession = !!session;
  if (!session) {
    if (packet.type !== 'prekey') throw new Error('no session for incoming message and no prekey preamble');
    session = establishResponderSession(packet);
  }
  try {
    return openMessage(session, packet.msg);
  } catch (e) {
    if (hadExistingSession && packet.type === 'prekey') {
      return openMessage(establishResponderSession(packet), packet.msg);
    }
    throw e;
  }
  // Deliberately NO saveSession / session-meta writes (read-only preview).
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
