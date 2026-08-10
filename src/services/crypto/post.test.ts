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
import {
  genPostKey, sealPost, openPost, wrapPostKey, unwrapPostKey, sealReaction, openReaction,
  sealActivityPreview, openActivityPreview, MAX_REACTION_EMOJI_LEN, type PostPayload,
} from './post';
import { b64urlToBytes } from './envelope';

beforeAll(async () => {
  await ready();
});

describe('sender-sealed Wall activity previews (spec 1065 FR-031e)', () => {
  it('round-trips sender-composed wording without exposing it outside the envelope', () => {
    const k = genPostKey();
    const preview = { id: 'eng-1', actor: 'alice', title: 'Alice', body: 'replied to you' };
    const sealed = sealActivityPreview(k, preview);
    expect(JSON.stringify(sealed)).not.toContain('replied to you');
    expect(openActivityPreview(k, sealed)).toEqual(preview);
  });

  it('has one constant wire size for replies and emoji reactions', () => {
    const k = genPostKey();
    const reply = sealActivityPreview(k, { id: '1', actor: 'alice', title: 'Alice', body: 'replied to you' });
    const reaction = sealActivityPreview(k, { id: '2', actor: 'bob', title: 'Bob', body: 'reacted 🎉 to your comment' });
    expect(JSON.stringify(reply).length).toBe(JSON.stringify(reaction).length);
  });
});

const textPost: PostPayload = { kind: 'text', body: 'hello wall' };
const mediaPost: PostPayload = {
  kind: 'image',
  body: 'caption',
  media: { blobId: 'cap123', fileKey: 'AAAA', mime: 'image/jpeg', size: 1024, name: 'p.jpg' },
};

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

/* ---- spec 1065: constant-length reaction payloads ---- */

describe('reaction payload padding (spec 1065 FR-031d)', () => {
  const key = () => genPostKey();

  it('makes a post reaction and a comment reaction the same size on the wire', () => {
    // This is the whole point. `parent` is sealed, and no new `kind` is used, so
    // the ONLY way the server could tell a comment reaction from a post reaction
    // is by noticing the ciphertext is ~40 bytes longer. Padding closes that.
    const k = key();
    const post = sealReaction(k, { emoji: '👍', at: 1 });
    const comment = sealReaction(k, { emoji: '👍', at: 1, parent: '11111111-1111-1111-1111-111111111111' });
    expect(JSON.stringify(post).length).toBe(JSON.stringify(comment).length);
  });

  it('is the same size whatever the emoji', () => {
    const k = key();
    const short = sealReaction(k, { emoji: '👍', at: 1 });
    const long = sealReaction(k, { emoji: '👨‍👩‍👧‍👦', at: 1 });
    expect(JSON.stringify(short).length).toBe(JSON.stringify(long).length);
  });

  it('is the same size with and without a removal flag', () => {
    const k = key();
    expect(JSON.stringify(sealReaction(key(), { emoji: '👍', at: 1 })).length).toBe(
      JSON.stringify(sealReaction(k, { emoji: '👍', at: 1, remove: true })).length,
    );
  });

  it('round-trips every field, padding included', () => {
    const k = key();
    const parent = '22222222-2222-2222-2222-222222222222';
    const opened = openReaction(k, sealReaction(k, { emoji: '🎉', at: 42, parent, remove: true }));
    expect(opened.emoji).toBe('🎉');
    expect(opened.at).toBe(42);
    expect(opened.parent).toBe(parent);
    expect(opened.remove).toBe(true);
  });

  it('refuses an over-budget payload rather than sending it unpadded or truncated', () => {
    // A silent truncation would corrupt the parent reference; sending it unpadded
    // would leak the very distinction the padding exists to hide. Neither is an
    // acceptable failure, so this throws.
    const k = key();
    expect(() => sealReaction(k, { emoji: '🙂'.repeat(200), at: 1 })).toThrow(/too large/i);
  });

  it('bounds the emoji so ordinary input can never reach the budget', () => {
    expect(() => sealReaction(key(), { emoji: '🙂'.repeat(MAX_REACTION_EMOJI_LEN + 1), at: 1 })).toThrow();
  });
});
