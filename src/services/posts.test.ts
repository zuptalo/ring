// Round-trip test for the post orchestration (spec 0003): a built post is openable
// by an audience member with their X25519 private key, and the blob/envelopes carry
// no plaintext a non-member could read.
import { describe, it, expect, beforeAll } from 'vitest';
import { ready, x25519Keypair } from './crypto/primitives';
import { buildPost, openReceivedPost } from './posts';
import { bytesToUtf8 } from './crypto/envelope';
import type { PostPayload } from './crypto/post';

beforeAll(async () => {
  await ready();
});

const payload: PostPayload = {
  kind: 'image',
  body: 'sunset',
  media: { blobId: 'cap9', fileKey: 'ZmtleQ', mime: 'image/png', size: 99, name: 's.png' },
};

describe('buildPost / openReceivedPost', () => {
  it('an audience member recovers the exact payload', () => {
    const bob = x25519Keypair();
    const built = buildPost(payload, [{ userId: 'bob', pubKey: bob.publicKey }]);
    expect(built.envelopes).toHaveLength(1);
    expect(built.envelopes[0].recipient).toBe('bob');
    const got = openReceivedPost(built.blob, built.envelopes[0].wrappedKey, bob.privateKey);
    expect(got).toEqual(payload);
  });

  it('each audience member gets a distinct wrapped key but recovers the same payload', () => {
    const bob = x25519Keypair();
    const carol = x25519Keypair();
    const built = buildPost(payload, [
      { userId: 'bob', pubKey: bob.publicKey },
      { userId: 'carol', pubKey: carol.publicKey },
    ]);
    expect(built.envelopes[0].wrappedKey).not.toEqual(built.envelopes[1].wrappedKey);
    expect(openReceivedPost(built.blob, built.envelopes[0].wrappedKey, bob.privateKey)).toEqual(payload);
    expect(openReceivedPost(built.blob, built.envelopes[1].wrappedKey, carol.privateKey)).toEqual(payload);
  });

  it('a non-member cannot open the post (wrong key)', () => {
    const bob = x25519Keypair();
    const outsider = x25519Keypair();
    const built = buildPost(payload, [{ userId: 'bob', pubKey: bob.publicKey }]);
    expect(() => openReceivedPost(built.blob, built.envelopes[0].wrappedKey, outsider.privateKey)).toThrow();
  });

  it('the blob carries no plaintext (body is not present in the clear)', () => {
    const bob = x25519Keypair();
    const built = buildPost(payload, [{ userId: 'bob', pubKey: bob.publicKey }]);
    expect(bytesToUtf8(built.blob)).not.toContain('sunset');
    expect(bytesToUtf8(built.blob)).not.toContain('cap9');
  });
});
