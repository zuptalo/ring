/**
 * Group messaging via sender keys (Signal's group protocol).
 *
 * Each member has, per group, a "sender key": a symmetric chain key that
 * ratchets forward per message (forward secrecy within the group) plus an
 * Ed25519 signing keypair so other members can authenticate the sender without
 * pairwise crypto. To send, the author derives a message key from their chain
 * key, encrypts, and signs the ciphertext; each recipient who holds the
 * author's sender-key state derives the same message key (skip-tolerant) and
 * verifies the signature.
 *
 * Distribution: a member's public sender-key (current chain key + iteration +
 * signing pub) is sent to every other member ENCRYPTED over the established 1:1
 * Double Ratchet sessions (Phase 4). Rotation on membership change = generate a
 * fresh sender key and redistribute, so a departed member can't read new
 * messages.
 *
 * The crypto core is pure (no IndexedDB) so it's fully self-testable; the
 * `senderkeys` store persistence is the thin layer at the bottom.
 */
import {
  randomBytes,
  ed25519Keypair,
  sign,
  verify,
  hmacSha256,
  hkdf,
  KEY_BYTES,
} from './primitives';
import {
  seal,
  open,
  bytesToB64url,
  b64urlToBytes,
  utf8ToBytes,
  type Envelope,
} from './envelope';
import { get, put } from '@/db/idb';

const MAX_SKIP = 2000;

/* ---- chain KDF (same construction as the 1:1 ratchet's chain step) ---- */
const deriveMessageKey = (ck: Uint8Array) => hmacSha256(ck, Uint8Array.of(0x01));
const deriveNextChainKey = (ck: Uint8Array) => hmacSha256(ck, Uint8Array.of(0x02));
const aeadKey = (mk: Uint8Array) => hkdf(mk, KEY_BYTES, new Uint8Array(32), utf8ToBytes('ring/sk/msg'));

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// What the sender signs: binds iteration + ciphertext + associated data.
function signData(iteration: number, env: Envelope, ad: Uint8Array): Uint8Array {
  return concat(utf8ToBytes(String(iteration)), b64urlToBytes(env.nonce), b64urlToBytes(env.ct), ad);
}

function header(iteration: number): Uint8Array {
  return utf8ToBytes(JSON.stringify({ iteration }));
}

/* ---- state shapes ---- */

/** Our own sending sender-key for a group. */
export interface SenderKeyState {
  chainKey: Uint8Array;
  iteration: number;
  signPub: Uint8Array;
  signPriv: Uint8Array;
}

/** A peer's sender-key as we hold it for decrypting their group messages. */
export interface ReceivingSenderKey {
  chainKey: Uint8Array;
  iteration: number;
  signPub: Uint8Array;
  skipped: Map<number, Uint8Array>;
}

/** The public part shared with other members (over their 1:1 session). */
export interface SenderKeyDistribution {
  chainKey: string; // b64url
  iteration: number;
  signPub: string; // b64url
}

export interface GroupMessage {
  iteration: number;
  env: Envelope;
  signature: string; // b64url (Ed25519 over signData)
}

/* ---- core ---- */

/** Create a fresh sender key (also used to rotate on membership change). */
export function createSenderKey(): SenderKeyState {
  const s = ed25519Keypair();
  return { chainKey: randomBytes(KEY_BYTES), iteration: 0, signPub: s.publicKey, signPriv: s.privateKey };
}

/** Public distribution message for the current sender-key state. */
export function distributionFrom(state: SenderKeyState): SenderKeyDistribution {
  return {
    chainKey: bytesToB64url(state.chainKey),
    iteration: state.iteration,
    signPub: bytesToB64url(state.signPub),
  };
}

/** Build a receiving state from a peer's distribution message. */
export function receivingFromDistribution(d: SenderKeyDistribution): ReceivingSenderKey {
  return {
    chainKey: b64urlToBytes(d.chainKey),
    iteration: d.iteration,
    signPub: b64urlToBytes(d.signPub),
    skipped: new Map(),
  };
}

/** Encrypt + sign a group message; mutates `state` (advances the chain). */
export function groupEncrypt(state: SenderKeyState, plaintext: Uint8Array, ad: Uint8Array): GroupMessage {
  const iteration = state.iteration;
  const mk = deriveMessageKey(state.chainKey);
  state.chainKey = deriveNextChainKey(state.chainKey);
  state.iteration += 1;
  const env = seal(aeadKey(mk), plaintext, 'sk', concat(ad, header(iteration)));
  const signature = bytesToB64url(sign(state.signPriv, signData(iteration, env, ad)));
  return { iteration, env, signature };
}

/** Verify + decrypt a group message; mutates `recv` (advances / caches skips). */
export function groupDecrypt(recv: ReceivingSenderKey, msg: GroupMessage, ad: Uint8Array): Uint8Array {
  // Authenticate the sender first (prevents a member forging another's message).
  if (!verify(recv.signPub, signData(msg.iteration, msg.env, ad), b64urlToBytes(msg.signature))) {
    throw new Error('sender-key signature invalid');
  }
  let mk: Uint8Array;
  if (msg.iteration < recv.iteration) {
    const cached = recv.skipped.get(msg.iteration);
    if (!cached) throw new Error('sender-key: message key unavailable (too old)');
    recv.skipped.delete(msg.iteration);
    mk = cached;
  } else {
    if (recv.iteration + MAX_SKIP < msg.iteration) throw new Error('sender-key: too many skipped');
    while (recv.iteration < msg.iteration) {
      recv.skipped.set(recv.iteration, deriveMessageKey(recv.chainKey));
      recv.chainKey = deriveNextChainKey(recv.chainKey);
      recv.iteration += 1;
    }
    mk = deriveMessageKey(recv.chainKey);
    recv.chainKey = deriveNextChainKey(recv.chainKey);
    recv.iteration += 1;
  }
  return open(aeadKey(mk), msg.env, concat(ad, header(msg.iteration)));
}

/* ---- persistence (senderkeys store) ---- */

const ownId = (groupId: string) => `${groupId}:self`;
const recvId = (groupId: string, memberId: string) => `${groupId}:${memberId}`;

interface OwnRecord {
  id: string;
  chainKey: string;
  iteration: number;
  signPub: string;
  signPriv: string;
}
interface RecvRecord {
  id: string;
  chainKey: string;
  iteration: number;
  signPub: string;
  skipped: Record<string, string>;
}

export async function saveOwnSenderKey(groupId: string, s: SenderKeyState): Promise<void> {
  await put<OwnRecord>('senderkeys', {
    id: ownId(groupId),
    chainKey: bytesToB64url(s.chainKey),
    iteration: s.iteration,
    signPub: bytesToB64url(s.signPub),
    signPriv: bytesToB64url(s.signPriv),
  });
}

export async function loadOwnSenderKey(groupId: string): Promise<SenderKeyState | null> {
  const r = await get<OwnRecord>('senderkeys', ownId(groupId));
  if (!r) return null;
  return {
    chainKey: b64urlToBytes(r.chainKey),
    iteration: r.iteration,
    signPub: b64urlToBytes(r.signPub),
    signPriv: b64urlToBytes(r.signPriv),
  };
}

export async function saveReceivingSenderKey(
  groupId: string,
  memberId: string,
  r: ReceivingSenderKey,
): Promise<void> {
  const skipped: Record<string, string> = {};
  for (const [k, v] of r.skipped) skipped[String(k)] = bytesToB64url(v);
  await put<RecvRecord>('senderkeys', {
    id: recvId(groupId, memberId),
    chainKey: bytesToB64url(r.chainKey),
    iteration: r.iteration,
    signPub: bytesToB64url(r.signPub),
    skipped,
  });
}

export async function loadReceivingSenderKey(
  groupId: string,
  memberId: string,
): Promise<ReceivingSenderKey | null> {
  const r = await get<RecvRecord>('senderkeys', recvId(groupId, memberId));
  if (!r) return null;
  const skipped = new Map<number, Uint8Array>();
  for (const [k, v] of Object.entries(r.skipped)) skipped.set(Number(k), b64urlToBytes(v));
  return { chainKey: b64urlToBytes(r.chainKey), iteration: r.iteration, signPub: b64urlToBytes(r.signPub), skipped };
}
