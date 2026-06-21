// Unit tests for the post crypto (spec 0003). Posts use a fresh per-post content
// key (K_post) sealed with the existing AEAD, and an ECIES wrap of K_post per
// recipient (ephemeral X25519 → HKDF → AEAD). This is deliberately NOT a ratchet:
// each post/engagement item carries its own independent key, so the ratchet-specific
// failure modes (out-of-order, skipped-key) do not apply by construction. The
// adversarial cases that DO apply — tamper/forgery (AEAD integrity) and a non-member
// key (wrong recipient) — are covered here; replay is handled at the store layer
// (id-based idempotency), not in crypto.
import { describe, it, expect, beforeAll } from 'vitest';
import { ready, x25519Keypair } from './primitives';
import { genPostKey, sealPost, openPost, wrapPostKey, unwrapPostKey, type PostPayload } from './post';
import { b64urlToBytes } from './envelope';

beforeAll(async () => {
  await ready();
});

const textPost: PostPayload = { kind: 'text', body: 'hello wall' };
const mediaPost: PostPayload = { kind: 'image', body: 'caption', media: { blobId: 'cap123', fileKey: 'AAAA' } };

describe('post payload seal/open', () => {
  it('round-trips a text payload', () => {
    const k = genPostKey();
    const env = sealPost(k, textPost);
    expect(openPost(k, env)).toEqual(textPost);
  });

  it('round-trips a media payload (media-ref sealed inside)', () => {
    const k = genPostKey();
    const env = sealPost(k, mediaPost);
    expect(openPost(k, env)).toEqual(mediaPost);
  });

  it('rejects a tampered ciphertext (AEAD integrity / forgery)', () => {
    const k = genPostKey();
    const env = sealPost(k, textPost);
    const ctBytes = b64urlToBytes(env.ct);
    ctBytes[0] ^= 0xff;
    const forged = { ...env, ct: Buffer.from(ctBytes).toString('base64url') };
    expect(() => openPost(k, forged)).toThrow();
  });

  it('a different K_post cannot open the payload', () => {
    const env = sealPost(genPostKey(), textPost);
    expect(() => openPost(genPostKey(), env)).toThrow();
  });
});

describe('per-recipient K_post wrap/unwrap (ECIES)', () => {
  it('the intended recipient unwraps the exact K_post', () => {
    const recipient = x25519Keypair();
    const k = genPostKey();
    const wrapped = wrapPostKey(k, recipient.publicKey);
    const got = unwrapPostKey(wrapped, recipient.privateKey);
    expect(Array.from(got)).toEqual(Array.from(k));
    // and the unwrapped key actually opens a payload sealed under the original
    const env = sealPost(k, textPost);
    expect(openPost(got, env)).toEqual(textPost);
  });

  it('a non-member (wrong recipient key) cannot unwrap', () => {
    const recipient = x25519Keypair();
    const outsider = x25519Keypair();
    const wrapped = wrapPostKey(genPostKey(), recipient.publicKey);
    expect(() => unwrapPostKey(wrapped, outsider.privateKey)).toThrow();
  });

  it('a tampered wrap envelope is rejected', () => {
    const recipient = x25519Keypair();
    const wrapped = wrapPostKey(genPostKey(), recipient.publicKey);
    const ctBytes = b64urlToBytes(wrapped.env.ct);
    ctBytes[0] ^= 0xff;
    const forged = { ...wrapped, env: { ...wrapped.env, ct: Buffer.from(ctBytes).toString('base64url') } };
    expect(() => unwrapPostKey(forged, recipient.privateKey)).toThrow();
  });

  it('each wrap uses a fresh ephemeral key (distinct wraps for the same K_post)', () => {
    const recipient = x25519Keypair();
    const k = genPostKey();
    const a = wrapPostKey(k, recipient.publicKey);
    const b = wrapPostKey(k, recipient.publicKey);
    expect(a.eph).not.toEqual(b.eph);
    // both still unwrap to the same K_post
    expect(Array.from(unwrapPostKey(a, recipient.privateKey))).toEqual(
      Array.from(unwrapPostKey(b, recipient.privateKey)),
    );
  });
});
