/**
 * Post crypto (spec 0003).
 *
 * A Wall post is sealed once under a fresh per-post content key (K_post). That key
 * is then wrapped to each audience member with a standard ECIES construction over
 * their X25519 public key: ephemeral X25519 → HKDF → AEAD — the very primitives X3DH
 * is built from, NOT a new scheme (constitution Principle IV). The server stores the
 * sealed payload plus one wrapped-key envelope per recipient and never holds K_post
 * or any plaintext.
 *
 * Deliberately NOT a ratchet: each post (and each engagement item) carries its own
 * independent key, so there is no chain. Forward secrecy across posts comes from
 * per-post keys + expiry, and the ratchet-specific failure modes (out-of-order,
 * skipped-key) do not apply here by construction (see research.md R3). These are pure
 * functions, fully testable without IndexedDB; the stateful wiring (fetching a
 * recipient's public key, persistence) lives in services/posts.ts.
 */
import { randomBytes, x25519Keypair, x25519, hkdf, KEY_BYTES } from './primitives';
import {
  seal,
  open,
  sealJson,
  openJson,
  bytesToB64url,
  b64urlToBytes,
  utf8ToBytes,
  type Envelope,
} from './envelope';

/** Decrypted content carried inside a post, sealed under K_post. For non-text posts
 *  the full media-ref (blob id + per-file key + mime/dimensions) rides sealed inside
 *  the payload, so the server never sees it. */
export interface PostPayload {
  kind: 'text' | 'voice' | 'video' | 'image';
  body?: string;
  media?: import('./message').MediaRef;
}

/** Generate a fresh per-post content key. */
export function genPostKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

/** Seal a post payload under K_post → Envelope (uploaded as the post blob). */
export function sealPost(kPost: Uint8Array, payload: PostPayload): Envelope {
  return sealJson(kPost, payload, 'post');
}

/** Open a post payload sealed by {@link sealPost}. */
export function openPost(kPost: Uint8Array, env: Envelope): PostPayload {
  return openJson<PostPayload>(kPost, env);
}

/** Seal an engagement item (reaction/comment) under the post's K_post. Every audience
 *  member holds K_post (they unwrapped it to read the post), so they can both seal
 *  their own engagement and open everyone else's; the server, which lacks K_post,
 *  cannot read the emoji or comment text. */
export function sealEngagement(kPost: Uint8Array, value: unknown): Envelope {
  return sealJson(kPost, value, 'posteng');
}

/** Open an engagement item sealed by {@link sealEngagement}. */
export function openEngagement<T>(kPost: Uint8Array, env: Envelope): T {
  return openJson<T>(kPost, env);
}

/** A per-recipient wrapped K_post: the ephemeral X25519 public key + the sealed key. */
export interface WrappedPostKey {
  eph: string; // b64url ephemeral X25519 public key
  env: Envelope; // K_post sealed under the ECDH-derived wrap key
}

// Domain-separated HKDF info + a fixed all-zero salt (the ephemeral DH already
// provides the randomness; the salt is constant by design, as in the ratchet's KDF).
const WRAP_INFO = utf8ToBytes('ring/post/keywrap/v1');
const ZERO_SALT = new Uint8Array(32);

function wrapKeyFrom(shared: Uint8Array): Uint8Array {
  return hkdf(shared, KEY_BYTES, ZERO_SALT, WRAP_INFO);
}

/**
 * Wrap K_post to a recipient's X25519 public key (ECIES). Pure: the caller supplies
 * the recipient's published public key. A fresh ephemeral key per call means two
 * wraps of the same K_post differ on the wire.
 */
export function wrapPostKey(kPost: Uint8Array, recipientPub: Uint8Array): WrappedPostKey {
  const eph = x25519Keypair();
  const shared = x25519(eph.privateKey, recipientPub);
  const env = seal(wrapKeyFrom(shared), kPost, 'postkey');
  return { eph: bytesToB64url(eph.publicKey), env };
}

/**
 * Unwrap K_post with the recipient's X25519 private key. Throws if the wrap was for a
 * different recipient or was tampered with (the AEAD tag fails to verify).
 */
export function unwrapPostKey(wrapped: WrappedPostKey, recipientPriv: Uint8Array): Uint8Array {
  const shared = x25519(recipientPriv, b64urlToBytes(wrapped.eph));
  return open(wrapKeyFrom(shared), wrapped.env);
}
