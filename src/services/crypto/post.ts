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
  // An album post (spec 1022, FR-019) seals an ORDERED set of image/video media-refs here
  // instead of the single `media`. Every ref rides sealed under K_post, so the server still
  // sees only opaque ciphertext regardless of how many media a post carries.
  album?: import('./message').MediaRef[];
  // A game-challenge post (spec 0009). Additive: kind stays 'text' and `body`
  // carries fallback copy, so pre-0009 audiences see a harmless text post while
  // new clients render the live challenge/board instead of the body.
  // hostName/hostAvatar: the challenger's own display info, SEALED to the
  // audience like everything else, so viewers who don't hold the challenger as
  // a contact still see who is playing (the avatar is a small thumbnail).
  game?: { gameType: string; theme?: string; hostName?: string; hostAvatar?: string };
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

/* ---- reactions: constant-size, so the server cannot tell what they target ---- */

/** A reaction, on a post or on one of its comments (spec 1065). */
export interface ReactionValue {
  emoji: string;
  at: number;
  remove?: boolean;
  /** Engagement id of the comment this reacts to. Absent = the post itself.
   *  Sealed, so the server cannot reconstruct which comment anything targets. */
  parent?: string;
}

/**
 * Why reactions are padded.
 *
 * A comment reaction and a post reaction are the same `kind` on the wire, by
 * design: introducing a new kind would tell the server that a reaction targets a
 * comment, which is exactly what sealing the parent is meant to prevent. But the
 * sealed payloads are tiny and uniform, so a `parent` field would make comment
 * reactions roughly forty bytes longer, and length is visible even when content
 * is not. Padding every reaction to one constant plaintext length closes that
 * channel. Ring already does the same thing for push previews.
 *
 * The budget is generous enough that no legitimate reaction can reach it, and
 * `MAX_REACTION_EMOJI_LEN` keeps the emoji itself bounded so the guarantee does
 * not depend on the caller being reasonable.
 */
export const REACTION_PLAINTEXT_BYTES = 320;

/** A grapheme cluster can be long (a family emoji is 11 code points), but not
 *  unbounded. Well clear of anything a picker produces. */
export const MAX_REACTION_EMOJI_LEN = 64;

/** Seal a reaction at a constant plaintext size. Throws rather than emit an
 *  unpadded or truncated payload — either would defeat the point. */
export function sealReaction(kPost: Uint8Array, value: ReactionValue): Envelope {
  if (value.emoji.length > MAX_REACTION_EMOJI_LEN) {
    throw new Error(`reaction emoji too large: ${value.emoji.length} > ${MAX_REACTION_EMOJI_LEN}`);
  }
  const body = JSON.stringify(value);
  const used = utf8ToBytes(body).length;
  const emptyPadded = JSON.stringify({ ...value, p: '' });
  const wrapperBytes = utf8ToBytes(emptyPadded).length - used;
  if (used + wrapperBytes > REACTION_PLAINTEXT_BYTES) {
    throw new Error(`reaction payload too large: ${used} > ${REACTION_PLAINTEXT_BYTES}`);
  }
  const padded = { ...value, p: ' '.repeat(REACTION_PLAINTEXT_BYTES - used - wrapperBytes) };
  return sealJson(kPost, padded, 'posteng');
}

/** Open a reaction sealed by {@link sealReaction}. The padding field is ignored. */
export function openReaction(kPost: Uint8Array, env: Envelope): ReactionValue {
  const { p: _pad, ...rest } = openJson<ReactionValue & { p?: string }>(kPost, env);
  return rest;
}

export interface ActivityPreviewValue {
  id: string;
  actor: string;
  title: string;
  body: string;
}

const ACTIVITY_PREVIEW_PLAINTEXT_BYTES = 512;

/** Sender-composed Wall notification wording, sealed under K_post and padded so
 *  the push service and server learn neither its text nor whether it contains an
 *  emoji. The addressed recipient already holds K_post as a post audience member. */
export function sealActivityPreview(kPost: Uint8Array, value: ActivityPreviewValue): Envelope {
  const body = JSON.stringify(value);
  const emptyPadded = JSON.stringify({ ...value, p: '' });
  const used = utf8ToBytes(body).length;
  const wrapper = utf8ToBytes(emptyPadded).length - used;
  if (used + wrapper > ACTIVITY_PREVIEW_PLAINTEXT_BYTES) throw new Error('activity preview too large');
  return sealJson(kPost, { ...value, p: ' '.repeat(ACTIVITY_PREVIEW_PLAINTEXT_BYTES - used - wrapper) }, 'postact');
}

export function openActivityPreview(kPost: Uint8Array, env: Envelope): ActivityPreviewValue {
  const { p: _pad, ...value } = openJson<ActivityPreviewValue & { p?: string }>(kPost, env);
  return value;
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
