// Unit tests for the envelope layer: base64url/utf8 codecs and the versioned
// seal/open (raw + JSON) used to wrap data at rest and on the wire.
import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomBytes, aeadSeal, aeadOpen, equalBytes, KEY_BYTES } from './primitives';
import {
  seal,
  open,
  sealJson,
  openJson,
  packBlob,
  unpackBlob,
  bytesToB64url,
  b64urlToBytes,
  utf8ToBytes,
  bytesToUtf8,
  type Envelope,
} from './envelope';

beforeAll(async () => {
  await ready();
});

describe('codecs', () => {
  it('base64url round-trips arbitrary bytes', () => {
    const b = randomBytes(40);
    expect(equalBytes(b64urlToBytes(bytesToB64url(b)), b)).toBe(true);
  });

  it('utf8 round-trips multi-byte text', () => {
    expect(bytesToUtf8(utf8ToBytes('héllo ✓ 🌍'))).toBe('héllo ✓ 🌍');
  });
});

describe('envelope seal/open', () => {
  it('round-trips raw bytes', () => {
    const key = randomBytes(KEY_BYTES);
    const raw = seal(key, utf8ToBytes('x'), 'master');
    expect(equalBytes(open(key, raw), utf8ToBytes('x'))).toBe(true);
  });

  it('round-trips JSON', () => {
    const key = randomBytes(KEY_BYTES);
    const env = sealJson(key, { name: 'Kamran', n: 7 }, 'master');
    const back = openJson<{ name: string; n: number }>(key, env);
    expect(back).toEqual({ name: 'Kamran', n: 7 });
  });

  it('rejects an unknown version', () => {
    const key = randomBytes(KEY_BYTES);
    const env = seal(key, utf8ToBytes('x'), 'master');
    const bad: Envelope = { ...env, v: 99 };
    expect(() => open(key, bad)).toThrow();
  });

  it('rejects a wrong key', () => {
    const env = seal(randomBytes(KEY_BYTES), utf8ToBytes('x'), 'master');
    expect(() => open(randomBytes(KEY_BYTES), env)).toThrow();
  });
});

describe('packBlob / unpackBlob', () => {
  it('packs a nonce+ciphertext that still decrypts', () => {
    const key = randomBytes(KEY_BYTES);
    const data = randomBytes(1000);
    const { nonce, ct } = aeadSeal(key, data);
    const u = unpackBlob(packBlob(nonce, ct));
    expect(equalBytes(aeadOpen(key, u.nonce, u.ct), data)).toBe(true);
  });
});
