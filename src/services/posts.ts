/**
 * Post orchestration (spec 0003) — crypto-only, like messaging.ts.
 *
 * This layer turns a post payload + an audience (each member's X25519 public key)
 * into the bytes the server stores: one sealed-payload blob + one wrapped-key envelope
 * per recipient. It NEVER touches the chats/contacts/posts IndexedDB stores — the
 * data layer (`queries.ts`) fetches the audience public keys, uploads the blob via
 * `media-transfer.ts`, calls the API, and persists the resulting `Post`. The
 * dependency stays one-directional (`queries.ts → posts.ts`), no cycle.
 */
import {
  genPostKey,
  sealPost,
  openPost,
  wrapPostKey,
  unwrapPostKey,
  sealEngagement,
  openEngagement,
  type PostPayload,
  type WrappedPostKey,
} from './crypto/post';
import { utf8ToBytes, bytesToUtf8, bytesToB64url, b64urlToBytes, type Envelope } from './crypto/envelope';

export type { PostPayload } from './crypto/post';

/** An audience member: their id + published X25519 public key (to wrap K_post to). */
export interface AudienceMember {
  userId: string;
  pubKey: Uint8Array;
}

/** One per-recipient envelope as carried on the wire (`wrappedKey` = JSON of the
 *  {@link WrappedPostKey}). */
export interface PostEnvelopeWire {
  recipient: string;
  wrappedKey: string;
}

export interface BuiltPost {
  /** The K_post-sealed payload bytes — uploaded as the opaque post blob. */
  blob: Uint8Array;
  /** One wrapped-key envelope per audience member. */
  envelopes: PostEnvelopeWire[];
  /** K_post (b64url) — the author keeps it so they can read + post engagement. */
  postKey: string;
}

/**
 * Seal a post under a fresh per-post key and wrap that key to each audience member.
 * Pure: the caller supplies the audience public keys. The returned blob is uploaded
 * once; the envelopes are sent alongside so each recipient (and only they) can recover
 * K_post; `postKey` is kept locally for engagement.
 */
export function buildPost(payload: PostPayload, audience: AudienceMember[]): BuiltPost {
  const k = genPostKey();
  const sealed = sealPost(k, payload);
  const blob = utf8ToBytes(JSON.stringify(sealed));
  const envelopes = audience.map((m) => ({
    recipient: m.userId,
    wrappedKey: JSON.stringify(wrapPostKey(k, m.pubKey)),
  }));
  return { blob, envelopes, postKey: bytesToB64url(k) };
}

/** Re-wrap an EXISTING post's content key K_post to additional audience members. Used to
 *  broaden a post's audience (close → all friends) WITHOUT rebuilding or re-sealing the
 *  payload — only new key-envelopes are produced for the added recipients. */
export function wrapForNewAudience(
  postKeyB64: string,
  audience: AudienceMember[],
): { recipient: string; wrappedKey: string }[] {
  const k = b64urlToBytes(postKeyB64);
  return audience.map((m) => ({
    recipient: m.userId,
    wrappedKey: JSON.stringify(wrapPostKey(k, m.pubKey)),
  }));
}

/**
 * Recover a received post: unwrap K_post from the caller's envelope, then open the
 * sealed payload blob. Returns the payload AND K_post (b64url) — the recipient keeps
 * the key to read + post engagement. Throws if the wrap was not for this recipient or
 * anything was tampered with (AEAD verification).
 */
export function openReceivedPost(
  blob: Uint8Array,
  wrappedKey: string,
  selfPriv: Uint8Array,
): { payload: PostPayload; postKey: string } {
  const wrapped = JSON.parse(wrappedKey) as WrappedPostKey;
  const k = unwrapPostKey(wrapped, selfPriv);
  const env = JSON.parse(bytesToUtf8(blob)) as Envelope;
  return { payload: openPost(k, env), postKey: bytesToB64url(k) };
}

/** Seal an engagement value (e.g. `{emoji}`) under a post's K_post (b64url) → the
 *  opaque wire payload string. */
export function sealPostEngagement(postKeyB64: string, value: unknown): string {
  return JSON.stringify(sealEngagement(b64urlToBytes(postKeyB64), value));
}

/** Open an engagement wire payload sealed by {@link sealPostEngagement}. */
export function openPostEngagement<T>(postKeyB64: string, payload: string): T {
  return openEngagement<T>(b64urlToBytes(postKeyB64), JSON.parse(payload) as Envelope);
}
