/**
 * Low-level crypto primitives, the ONLY module that touches libsodium.
 *
 * Everything else in the app depends on these stable signatures, so the
 * implementation can change (e.g. swap a primitive) without rippling outward.
 *
 * Algorithm choices are deliberately the ones with first-class Go equivalents
 * in the standard library / golang.org/x/crypto, so the future Go backend
 * interoperates byte-for-byte:
 *   - AEAD:    XChaCha20-Poly1305 (IETF)  ↔ x/crypto/chacha20poly1305.NewX
 *   - DH:      X25519                     ↔ crypto/ecdh, x/crypto/curve25519
 *   - Signing: Ed25519                    ↔ crypto/ed25519
 *   - KDF:     HKDF-SHA-256 (RFC 5869)    ↔ x/crypto/hkdf
 *   - PW hash: Argon2id                   ↔ x/crypto/argon2 (IDKey)
 *
 * All inputs/outputs are raw bytes (Uint8Array). Encoding/framing lives in
 * envelope.ts, never here.
 */
import _sodium from 'libsodium-wrappers-sumo';

// libsodium loads its WASM asynchronously; nothing here works until ready.
let _ready: Promise<void> | null = null;
export function ready(): Promise<void> {
  if (!_ready) _ready = _sodium.ready;
  return _ready;
}

/** The ready sodium instance. Throws if `ready()` hasn't resolved yet. */
function lib(): typeof _sodium {
  // `_sodium.ready` resolving makes every function live on the same object.
  // We guard against accidental pre-ready use during development.
  if (typeof _sodium.crypto_aead_xchacha20poly1305_ietf_encrypt !== 'function') {
    throw new Error('crypto primitives used before ready() resolved');
  }
  return _sodium;
}

/* ---- sizes (bytes) ---- */
export const KEY_BYTES = 32; // symmetric key / X25519 key / shared secret
export const AEAD_NONCE_BYTES = 24; // XChaCha20-Poly1305 IETF nonce
export const ARGON_SALT_BYTES = 16;

/* ---- random ---- */
export function randomBytes(n: number): Uint8Array {
  return lib().randombytes_buf(n);
}

/* ---- AEAD: XChaCha20-Poly1305 (IETF) ---- */

export interface Sealed {
  nonce: Uint8Array;
  ct: Uint8Array; // ciphertext with the 16-byte Poly1305 tag appended
}

/** Encrypt `plaintext` under `key` with a fresh random nonce; `aad` is authenticated but not encrypted. */
export function aeadSeal(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Sealed {
  const nonce = randomBytes(AEAD_NONCE_BYTES);
  const ct = lib().crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad ?? null,
    null, // nsec, unused
    nonce,
    key,
  );
  return { nonce, ct };
}

/** Decrypt; throws if the tag/AAD don't verify. */
export function aeadOpen(
  key: Uint8Array,
  nonce: Uint8Array,
  ct: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  return lib().crypto_aead_xchacha20poly1305_ietf_decrypt(
    null, // nsec
    ct,
    aad ?? null,
    nonce,
    key,
  );
}

/* ---- X25519 (Diffie-Hellman key agreement) ---- */

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export function x25519Keypair(): KeyPair {
  // crypto_box keypairs are X25519 (Curve25519) keys.
  const kp = lib().crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** Raw X25519: scalar-mult of our private key with their public key → shared secret. */
export function x25519(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return lib().crypto_scalarmult(privateKey, publicKey);
}

/* ---- Ed25519 (signatures, for signed prekeys / bundle authenticity) ---- */

export function ed25519Keypair(): KeyPair {
  const kp = lib().crypto_sign_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export function sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  return lib().crypto_sign_detached(message, privateKey);
}

export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  return lib().crypto_sign_verify_detached(signature, message, publicKey);
}

/* ---- hashing (fingerprints / safety numbers) ---- */
export function sha256(data: Uint8Array): Uint8Array {
  return lib().crypto_hash_sha256(data);
}

/* ---- HMAC-SHA-256 (building block for HKDF and the ratchet chain KDF) ---- */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  // Use the streaming API so arbitrary key lengths are accepted (RFC 2104),
  // unlike the fixed-32-byte one-shot variant. These streaming functions exist
  // in the sumo build at runtime but are missing from its TS types, so we type
  // them locally here (the only place they're used).
  const s = lib() as unknown as {
    crypto_auth_hmacsha256_init(key: Uint8Array): object;
    crypto_auth_hmacsha256_update(state: object, message: Uint8Array): void;
    crypto_auth_hmacsha256_final(state: object): Uint8Array;
  };
  const state = s.crypto_auth_hmacsha256_init(key);
  s.crypto_auth_hmacsha256_update(state, message);
  return s.crypto_auth_hmacsha256_final(state);
}

/* ---- HKDF-SHA-256 (RFC 5869) ---- */

/**
 * Derive `length` bytes from input keying material. RFC 5869: extract-then-expand.
 * `salt` defaults to a zero block of hash length; `info` binds the output to a context.
 */
export function hkdf(
  ikm: Uint8Array,
  length: number,
  salt: Uint8Array = new Uint8Array(32),
  info: Uint8Array = new Uint8Array(0),
): Uint8Array {
  // Extract
  const prk = hmacSha256(salt, ikm);
  // Expand
  const out = new Uint8Array(length);
  let prev: Uint8Array = new Uint8Array(0);
  let pos = 0;
  let counter = 1;
  while (pos < length) {
    const input = new Uint8Array(prev.length + info.length + 1);
    input.set(prev, 0);
    input.set(info, prev.length);
    input[prev.length + info.length] = counter;
    prev = hmacSha256(prk, input);
    const take = Math.min(prev.length, length - pos);
    out.set(prev.subarray(0, take), pos);
    pos += take;
    counter += 1;
  }
  return out;
}

/* ---- Argon2id (PIN / recovery-code → wrapping key) ---- */

/** libsodium Argon2id (parallelism is fixed at 1, matching x/crypto/argon2.IDKey threads=1). */
export interface Argon2Params {
  opsLimit: number; // iterations  (Go: time)
  memLimitBytes: number; // memory in bytes (Go: memory in KiB = memLimitBytes/1024)
}

/** Sensible interactive defaults; tune for the platform later if needed. */
export const ARGON2_DEFAULTS: Argon2Params = {
  opsLimit: 3,
  memLimitBytes: 64 * 1024 * 1024, // 64 MiB
};

/**
 * Derive a key of `keyLen` bytes from a password + 16-byte salt using Argon2id.
 * Reproducible in Go via argon2.IDKey(pw, salt, time=opsLimit, memory=memLimitBytes/1024, threads=1, keyLen).
 */
export function argon2id(
  password: Uint8Array | string,
  salt: Uint8Array,
  keyLen: number = KEY_BYTES,
  params: Argon2Params = ARGON2_DEFAULTS,
): Uint8Array {
  return lib().crypto_pwhash(
    keyLen,
    password,
    salt,
    params.opsLimit,
    params.memLimitBytes,
    lib().crypto_pwhash_ALG_ARGON2ID13,
  );
}

/* ---- constant-time compare ---- */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  // sodium.memcmp throws on length mismatch; guard first.
  if (a.length !== b.length) return false;
  return lib().memcmp(a, b);
}
