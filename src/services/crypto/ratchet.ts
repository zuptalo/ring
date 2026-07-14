/**
 * X3DH key agreement + Double Ratchet (Signal-style) for 1:1 sessions.
 *
 * Faithful to the Double Ratchet spec, built on the libsodium primitives:
 *   - X3DH derives an initial shared secret from identity + prekeys.
 *   - The ratchet then provides forward secrecy and post-compromise security:
 *     a symmetric chain ratchet per message, plus a DH ratchet whenever the
 *     other side introduces a new ratchet public key. Out-of-order messages are
 *     handled by caching skipped message keys.
 *
 * The core (X3DH + ratchet) is pure (no IndexedDB) so it's exhaustively
 * self-testable with a two-party Alice↔Bob simulation. Session persistence
 * (the `sessions` store) is the thin layer at the bottom.
 */
import {
  x25519,
  x25519Keypair,
  hmacSha256,
  hkdf,
  equalBytes,
  KEY_BYTES,
  type KeyPair,
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

const MAX_SKIP = 1000;

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/* ---- KDFs ---- */

// Root KDF: (rk, dh) -> (rk', ck). HKDF, salt=rk.
function kdfRK(rk: Uint8Array, dhOut: Uint8Array): [Uint8Array, Uint8Array] {
  const out = hkdf(dhOut, 64, rk, utf8ToBytes('ring/dr/root'));
  return [out.slice(0, 32), out.slice(32, 64)];
}

// Chain KDF: ck -> (ck', mk) via HMAC with constant inputs.
function kdfCK(ck: Uint8Array): [Uint8Array, Uint8Array] {
  const mk = hmacSha256(ck, Uint8Array.of(0x01));
  const nck = hmacSha256(ck, Uint8Array.of(0x02));
  return [nck, mk];
}

// Message key -> AEAD content key.
function msgKey(mk: Uint8Array): Uint8Array {
  return hkdf(mk, KEY_BYTES, new Uint8Array(32), utf8ToBytes('ring/dr/msg'));
}

/* ---- X3DH ---- */

export interface PreKeyBundlePub {
  identityX: Uint8Array; // X25519 identity public key
  signedPreKey: Uint8Array; // X25519 signed-prekey public (also Bob's initial ratchet key)
  oneTimePreKey?: Uint8Array;
}

const X3DH_INFO = utf8ToBytes('ring/x3dh/v1');

/** Initiator (Alice): derive SK + a fresh ephemeral key from the responder's bundle. */
export function x3dhInitiator(
  identityXPriv: Uint8Array,
  bundle: PreKeyBundlePub,
): { sk: Uint8Array; ephemeral: KeyPair } {
  const eph = x25519Keypair();
  const parts = [
    x25519(identityXPriv, bundle.signedPreKey), // DH1
    x25519(eph.privateKey, bundle.identityX), // DH2
    x25519(eph.privateKey, bundle.signedPreKey), // DH3
  ];
  if (bundle.oneTimePreKey) parts.push(x25519(eph.privateKey, bundle.oneTimePreKey)); // DH4
  const sk = hkdf(concat(...parts), KEY_BYTES, new Uint8Array(32), X3DH_INFO);
  return { sk, ephemeral: eph };
}

/** Responder (Bob): derive the same SK from the initiator's identity + ephemeral. */
export function x3dhResponder(params: {
  identityXPriv: Uint8Array;
  signedPreKeyPriv: Uint8Array;
  oneTimePreKeyPriv?: Uint8Array;
  initiatorIdentityX: Uint8Array;
  initiatorEphemeral: Uint8Array;
}): Uint8Array {
  const parts = [
    x25519(params.signedPreKeyPriv, params.initiatorIdentityX), // DH1
    x25519(params.identityXPriv, params.initiatorEphemeral), // DH2
    x25519(params.signedPreKeyPriv, params.initiatorEphemeral), // DH3
  ];
  if (params.oneTimePreKeyPriv) parts.push(x25519(params.oneTimePreKeyPriv, params.initiatorEphemeral)); // DH4
  return hkdf(concat(...parts), KEY_BYTES, new Uint8Array(32), X3DH_INFO);
}

/* ---- Double Ratchet ---- */

export interface Header {
  dh: string; // sender's current ratchet public key (b64url)
  pn: number; // # messages in the previous sending chain
  n: number; // message number in the current sending chain
}

export interface RatchetState {
  DHs: KeyPair;
  DHr: Uint8Array | null;
  RK: Uint8Array;
  CKs: Uint8Array | null;
  CKr: Uint8Array | null;
  Ns: number;
  Nr: number;
  PN: number;
  skipped: Map<string, Uint8Array>; // `${dhPubB64}:${n}` -> message key
}

/** Alice (initiator) starts with the shared secret and Bob's ratchet public key. */
export function ratchetInitAlice(sk: Uint8Array, bobRatchetPub: Uint8Array): RatchetState {
  const DHs = x25519Keypair();
  const [RK, CKs] = kdfRK(sk, x25519(DHs.privateKey, bobRatchetPub));
  return { DHs, DHr: bobRatchetPub, RK, CKs, CKr: null, Ns: 0, Nr: 0, PN: 0, skipped: new Map() };
}

/** Bob (responder) starts with the shared secret and his signed-prekey keypair. */
export function ratchetInitBob(sk: Uint8Array, bobRatchetKeypair: KeyPair): RatchetState {
  return {
    DHs: bobRatchetKeypair,
    DHr: null,
    RK: sk,
    CKs: null,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    skipped: new Map(),
  };
}

function headerBytes(h: Header): Uint8Array {
  return utf8ToBytes(JSON.stringify(h));
}

export function ratchetEncrypt(state: RatchetState, plaintext: Uint8Array, ad: Uint8Array): {
  header: Header;
  env: Envelope;
} {
  if (!state.CKs) throw new Error('ratchet has no sending chain yet');
  const [CKs, mk] = kdfCK(state.CKs);
  state.CKs = CKs;
  const header: Header = { dh: bytesToB64url(state.DHs.publicKey), pn: state.PN, n: state.Ns };
  state.Ns += 1;
  const env = seal(msgKey(mk), plaintext, 'dr', concat(ad, headerBytes(header)));
  return { header, env };
}

export function ratchetDecrypt(
  state: RatchetState,
  header: Header,
  env: Envelope,
  ad: Uint8Array,
): Uint8Array {
  // 1) skipped message key?
  const skKey = `${header.dh}:${header.n}`;
  const skipped = state.skipped.get(skKey);
  if (skipped) {
    state.skipped.delete(skKey);
    return open(msgKey(skipped), env, concat(ad, headerBytes(header)));
  }
  // 2) new ratchet key from the other side?
  const headerDh = b64urlToBytes(header.dh);
  if (!state.DHr || !equalBytes(headerDh, state.DHr)) {
    skipMessageKeys(state, header.pn);
    dhRatchet(state, headerDh);
  }
  // 3) advance the receiving chain to this message
  skipMessageKeys(state, header.n);
  const [CKr, mk] = kdfCK(state.CKr as Uint8Array);
  state.CKr = CKr;
  state.Nr += 1;
  return open(msgKey(mk), env, concat(ad, headerBytes(header)));
}

/**
 * Decrypt exactly like ratchetDecrypt, but leave the decrypted message's own key
 * RETRIEVABLE from the skipped-key cache afterwards instead of consuming it.
 *
 * This is the service-worker PREVIEW variant (spec 2015). The preview advances and
 * PERSISTS the receiving ratchet so it can move past a base that live call/`qos`
 * signalling already advanced, and so a queued backlog previews in order. But a
 * plain ratchetDecrypt of the current message consumes its message key (advances
 * the chain, leaves nothing in `skipped`) — so the page's later AUTHORITATIVE open
 * of that very message would re-derive the wrong key and the message would be lost.
 * To stay idempotent with the page, we keep this message's key in `skipped` (the
 * Double Ratchet's normal out-of-order mechanism), so openPacket re-finds it there.
 * Net effect: forward progress is persisted, but nothing this preview reads becomes
 * undecryptable for the authoritative receiver — it only ever ADDS to the cache.
 */
export function ratchetDecryptPreview(
  state: RatchetState,
  header: Header,
  env: Envelope,
  ad: Uint8Array,
): { plaintext: Uint8Array; advancedDh: boolean } {
  const skKey = `${header.dh}:${header.n}`;
  // Already in the cache (skipped over earlier): decrypt WITHOUT deleting, so the
  // key stays available for the page's authoritative open. No DH step taken.
  const cached = state.skipped.get(skKey);
  if (cached) return { plaintext: open(msgKey(cached), env, concat(ad, headerBytes(header))), advancedDh: false };
  // Otherwise advance the receiving chain up to AND INCLUDING this message, caching
  // every key (including this one) via skipMessageKeys. We deliberately reuse the
  // skip path for header.n+1 so the current message's key lands in `skipped` rather
  // than being consumed, then read it back from there.
  //
  // `advancedDh` reports whether we had to take a DH-ratchet step. A DH ratchet mints
  // a FRESH sending keypair (DHs); the caller (previewPacket) must NOT persist that
  // from the service worker, or the SW becomes a competing writer of the SENDING key
  // and the page↔SW last-write-wins race can clobber the page's authoritative
  // send-state (permanent outbound divergence — adversarial review). So the caller
  // persists ONLY same-chain advances (advancedDh === false): those are deterministic
  // and purely ADDITIVE to the skipped-key cache, hence safe to converge via LWW.
  const headerDh = b64urlToBytes(header.dh);
  let advancedDh = false;
  if (!state.DHr || !equalBytes(headerDh, state.DHr)) {
    skipMessageKeys(state, header.pn);
    dhRatchet(state, headerDh);
    advancedDh = true;
  }
  skipMessageKeys(state, header.n + 1); // caches keys Nr..n (incl. this message)
  const mk = state.skipped.get(skKey);
  if (!mk) throw new Error('preview: message key not derivable'); // unreachable in practice
  return { plaintext: open(msgKey(mk), env, concat(ad, headerBytes(header))), advancedDh };
}

function skipMessageKeys(state: RatchetState, until: number): void {
  if (state.CKr === null) return;
  if (state.Nr + MAX_SKIP < until) throw new Error('ratchet: too many skipped messages');
  const dhB64 = bytesToB64url(state.DHr as Uint8Array);
  while (state.Nr < until) {
    const [CKr, mk] = kdfCK(state.CKr);
    state.CKr = CKr;
    state.skipped.set(`${dhB64}:${state.Nr}`, mk);
    state.Nr += 1;
  }
}

function dhRatchet(state: RatchetState, headerDh: Uint8Array): void {
  state.PN = state.Ns;
  state.Ns = 0;
  state.Nr = 0;
  state.DHr = headerDh;
  [state.RK, state.CKr] = kdfRK(state.RK, x25519(state.DHs.privateKey, state.DHr));
  state.DHs = x25519Keypair();
  [state.RK, state.CKs] = kdfRK(state.RK, x25519(state.DHs.privateKey, state.DHr));
}

/* ---- (de)serialization + persistence (sessions store, keyed by chatId) ---- */

// Exported (spec 1032): the SW's atomic per-frame commit writes the advanced session
// row itself (via idb `transact`), so it needs the serialized record without this
// module persisting it. The FORMAT is a cross-context contract — an old waiting SW
// can run against a new page (registerType 'prompt') — so it must not change in the
// same release as a feature that adds a second writer; version it if it ever does.
export interface SerializedSession {
  id: string;
  dhsPub: string;
  dhsPriv: string;
  dhr: string | null;
  rk: string;
  cks: string | null;
  ckr: string | null;
  ns: number;
  nr: number;
  pn: number;
  skipped: Record<string, string>;
}

function serialize(id: string, s: RatchetState): SerializedSession {
  const skipped: Record<string, string> = {};
  for (const [k, v] of s.skipped) skipped[k] = bytesToB64url(v);
  return {
    id,
    dhsPub: bytesToB64url(s.DHs.publicKey),
    dhsPriv: bytesToB64url(s.DHs.privateKey),
    dhr: s.DHr ? bytesToB64url(s.DHr) : null,
    rk: bytesToB64url(s.RK),
    cks: s.CKs ? bytesToB64url(s.CKs) : null,
    ckr: s.CKr ? bytesToB64url(s.CKr) : null,
    ns: s.Ns,
    nr: s.Nr,
    pn: s.PN,
    skipped,
  };
}

function deserialize(j: SerializedSession): RatchetState {
  const skipped = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(j.skipped)) skipped.set(k, b64urlToBytes(v));
  return {
    DHs: { publicKey: b64urlToBytes(j.dhsPub), privateKey: b64urlToBytes(j.dhsPriv) },
    DHr: j.dhr ? b64urlToBytes(j.dhr) : null,
    RK: b64urlToBytes(j.rk),
    CKs: j.cks ? b64urlToBytes(j.cks) : null,
    CKr: j.ckr ? b64urlToBytes(j.ckr) : null,
    Ns: j.ns,
    Nr: j.nr,
    PN: j.pn,
    skipped,
  };
}

/** The sessions-store row for a state, WITHOUT persisting it — for callers that
 *  commit the advance atomically with their other writes (spec 1032 SW drain). */
export function sessionRecord(chatId: string, state: RatchetState): SerializedSession {
  return serialize(chatId, state);
}

/** Rehydrate a state from a sessions-store row (the inverse of sessionRecord).
 *  Exercised directly by the spec-2033 persistence-round-trip regression tests;
 *  production reads go through loadSession. */
export function sessionFromRecord(rec: SerializedSession): RatchetState {
  return deserialize(rec);
}

export async function loadSession(chatId: string): Promise<RatchetState | null> {
  const rec = await get<SerializedSession>('sessions', chatId);
  return rec ? deserialize(rec) : null;
}

export function saveSession(chatId: string, state: RatchetState): Promise<void> {
  return put('sessions', serialize(chatId, state));
}
