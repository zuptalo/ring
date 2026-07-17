/**
 * Ciphertext envelope: one canonical, versioned, algorithm-tagged container
 * used everywhere we persist or transmit encrypted bytes (secret settings,
 * message payloads, wrapped keys, media file-keys).
 *
 * Two encodings, same fields:
 *   - JSON (for the text WebSocket and the settings store): base64url fields.
 *   - byte-packed (for media blobs): magic|v|alg|nonceLen|nonce|ct, so a
 *     `media.blob` stays a single Blob.
 *
 * Everything is language-neutral so the Go backend marshals it trivially.
 * Decoders reject unknown versions.
 */
import { aeadSeal, aeadOpen } from './primitives';

export const ENVELOPE_VERSION = 1;

/** Algorithm tags (kept short and stable for the wire). */
export const ALG = {
  XCHACHA20POLY1305: 'XC20P',
} as const;
export type Alg = (typeof ALG)[keyof typeof ALG];

export interface Envelope {
  v: number; // format version
  alg: Alg; // content algorithm
  kid: string; // key id: 'master' | conversation/file/recipient key id
  nonce: string; // base64url
  ct: string; // base64url (ciphertext || tag)
  aad?: string; // base64url additional authenticated data
}

/* ---- base64url + utf8 helpers (exported; used across crypto modules) ---- */

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
export const utf8ToBytes = (s: string): Uint8Array => enc.encode(s);
export const bytesToUtf8 = (b: Uint8Array): string => dec.decode(b);

/* ---- symmetric seal/open → Envelope (used for master-key & key-wrap data) ---- */

/** Encrypt `plaintext` under a symmetric `key`, tagging the result with `kid`. */
export function seal(key: Uint8Array, plaintext: Uint8Array, kid: string, aad?: Uint8Array): Envelope {
  const { nonce, ct } = aeadSeal(key, plaintext, aad);
  const env: Envelope = {
    v: ENVELOPE_VERSION,
    alg: ALG.XCHACHA20POLY1305,
    kid,
    nonce: bytesToB64url(nonce),
    ct: bytesToB64url(ct),
  };
  if (aad) env.aad = bytesToB64url(aad);
  return env;
}

/** Decrypt an Envelope produced by `seal` (or any XC20P envelope) under `key`. */
export function open(key: Uint8Array, env: Envelope, aad?: Uint8Array): Uint8Array {
  assertSupported(env);
  const authAad = aad ?? (env.aad ? b64urlToBytes(env.aad) : undefined);
  return aeadOpen(key, b64urlToBytes(env.nonce), b64urlToBytes(env.ct), authAad);
}

/** Convenience: seal a JSON-serializable value and return the Envelope. */
export function sealJson(key: Uint8Array, value: unknown, kid: string, aad?: Uint8Array): Envelope {
  return seal(key, utf8ToBytes(JSON.stringify(value)), kid, aad);
}

/** Convenience: open an Envelope and JSON-parse the plaintext. */
export function openJson<T>(key: Uint8Array, env: Envelope, aad?: Uint8Array): T {
  return JSON.parse(bytesToUtf8(open(key, env, aad))) as T;
}

/* ---- version guard ---- */
export function assertSupported(env: Pick<Envelope, 'v' | 'alg'>): void {
  if (env.v !== ENVELOPE_VERSION) throw new Error(`unsupported envelope version: ${env.v}`);
  if (env.alg !== ALG.XCHACHA20POLY1305) throw new Error(`unsupported envelope alg: ${env.alg}`);
}

/* ---- byte-packed form (for media blobs) ---- */

const MAGIC = utf8ToBytes('RING'); // 4 bytes
const ALG_TAG_XC20P = 1;

/** Pack a sealed blob payload into a single byte buffer: MAGIC|v|alg|nonceLen|nonce|ct. */
export function packBlob(nonce: Uint8Array, ct: Uint8Array): Uint8Array {
  const out = new Uint8Array(MAGIC.length + 1 + 1 + 1 + nonce.length + ct.length);
  let p = 0;
  out.set(MAGIC, p);
  p += MAGIC.length;
  out[p++] = ENVELOPE_VERSION;
  out[p++] = ALG_TAG_XC20P;
  out[p++] = nonce.length;
  out.set(nonce, p);
  p += nonce.length;
  out.set(ct, p);
  return out;
}

export interface UnpackedBlob {
  nonce: Uint8Array;
  ct: Uint8Array;
}

export function unpackBlob(buf: Uint8Array): UnpackedBlob {
  let p = 0;
  for (let i = 0; i < MAGIC.length; i++) {
    if (buf[p++] !== MAGIC[i]) throw new Error('bad blob magic');
  }
  const v = buf[p++];
  if (v !== ENVELOPE_VERSION) throw new Error(`unsupported blob version: ${v}`);
  const alg = buf[p++];
  if (alg !== ALG_TAG_XC20P) throw new Error(`unsupported blob alg: ${alg}`);
  const nonceLen = buf[p++];
  const nonce = buf.subarray(p, p + nonceLen);
  p += nonceLen;
  const ct = buf.subarray(p);
  return { nonce, ct };
}
