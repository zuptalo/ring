// Unit tests for the crypto primitives (libsodium wrappers). These mirror and
// extend the in-app self-test (selftest.ts) so the same guarantees are checked in
// CI with no backend. Everything here is pure — Node environment, no DOM.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  ready,
  randomBytes,
  aeadSeal,
  aeadOpen,
  x25519Keypair,
  x25519,
  ed25519Keypair,
  sign,
  verify,
  hkdf,
  argon2id,
  sha256,
  equalBytes,
  KEY_BYTES,
  ARGON_SALT_BYTES,
} from './primitives';
import { utf8ToBytes } from './envelope';

beforeAll(async () => {
  await ready();
});

describe('AEAD', () => {
  it('seals and opens with associated data', () => {
    const key = randomBytes(KEY_BYTES);
    const msg = utf8ToBytes('the quick brown fox');
    const aad = utf8ToBytes('chat:42');
    const { nonce, ct } = aeadSeal(key, msg, aad);
    expect(equalBytes(aeadOpen(key, nonce, ct, aad), msg)).toBe(true);
  });

  it('rejects tampered ciphertext', () => {
    const key = randomBytes(KEY_BYTES);
    const { nonce, ct } = aeadSeal(key, utf8ToBytes('secret'));
    ct[0] ^= 0xff;
    expect(() => aeadOpen(key, nonce, ct)).toThrow();
  });

  it('rejects a wrong AAD', () => {
    const key = randomBytes(KEY_BYTES);
    const { nonce, ct } = aeadSeal(key, utf8ToBytes('secret'), utf8ToBytes('a'));
    expect(() => aeadOpen(key, nonce, ct, utf8ToBytes('b'))).toThrow();
  });

  it('rejects a wrong key', () => {
    const { nonce, ct } = aeadSeal(randomBytes(KEY_BYTES), utf8ToBytes('secret'));
    expect(() => aeadOpen(randomBytes(KEY_BYTES), nonce, ct)).toThrow();
  });
});

describe('X25519', () => {
  it('produces an identical shared secret on both sides', () => {
    const a = x25519Keypair();
    const b = x25519Keypair();
    expect(equalBytes(x25519(a.privateKey, b.publicKey), x25519(b.privateKey, a.publicKey))).toBe(true);
  });
});

describe('Ed25519', () => {
  it('verifies a valid signature and rejects a forgery', () => {
    const kp = ed25519Keypair();
    const msg = utf8ToBytes('signed prekey');
    const sig = sign(kp.privateKey, msg);
    expect(verify(kp.publicKey, msg, sig)).toBe(true);
    sig[0] ^= 0xff;
    expect(verify(kp.publicKey, msg, sig)).toBe(false);
  });
});

describe('HKDF', () => {
  it('is deterministic, context-separated, and length-correct', () => {
    const ikm = randomBytes(32);
    const salt = randomBytes(16);
    const k1 = hkdf(ikm, 32, salt, utf8ToBytes('ctx-1'));
    const k1b = hkdf(ikm, 32, salt, utf8ToBytes('ctx-1'));
    const k2 = hkdf(ikm, 32, salt, utf8ToBytes('ctx-2'));
    expect(equalBytes(k1, k1b)).toBe(true);
    expect(equalBytes(k1, k2)).toBe(false);
    expect(hkdf(ikm, 64, salt).length).toBe(64);
  });
});

describe('Argon2id', () => {
  it('derives a stable key from PIN+salt and varies with the PIN', () => {
    const salt = randomBytes(ARGON_SALT_BYTES);
    const k1 = argon2id('1234', salt);
    const k2 = argon2id('1234', salt);
    const k3 = argon2id('9999', salt);
    expect(equalBytes(k1, k2)).toBe(true);
    expect(equalBytes(k1, k3)).toBe(false);
  });
});

describe('sha256', () => {
  it('is stable and 32 bytes', () => {
    const a = sha256(utf8ToBytes('abc'));
    const b = sha256(utf8ToBytes('abc'));
    expect(equalBytes(a, b)).toBe(true);
    expect(a.length).toBe(32);
  });
});

describe('randomBytes / equalBytes', () => {
  it('returns the requested length and differs between draws', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    expect(a.length).toBe(32);
    expect(equalBytes(a, b)).toBe(false);
    expect(equalBytes(a, a)).toBe(true);
  });
});
