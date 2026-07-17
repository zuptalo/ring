// Unit tests for identity material: generation, the signed-prekey signature chain,
// PIN wrap/unwrap, recovery-code wrap/unwrap, and the public-bundle projection
// (which must never leak private key material).
import { describe, it, expect, beforeAll } from 'vitest';
import { ready, equalBytes, KEY_BYTES } from './primitives';
import { bytesToB64url } from './envelope';
import {
  generateIdentityMaterial,
  verifySignedPreKey,
  wrapSecret,
  unwrapSecret,
  generateRecoveryCode,
  wrapRecovery,
  unwrapRecovery,
  publicBundleOf,
  fingerprintOf,
} from './identity';

beforeAll(async () => {
  await ready();
});

describe('generateIdentityMaterial', () => {
  it('produces a master key, prekeys, and a valid signed prekey', () => {
    const b = generateIdentityMaterial(3);
    expect(verifySignedPreKey(b)).toBe(true);
    expect(b.oneTimePreKeys.length).toBe(3);
    expect(b.masterKey.length).toBe(KEY_BYTES);
  });
});

describe('PIN wrap/unwrap', () => {
  it('restores the full bundle with the right PIN', () => {
    const b = generateIdentityMaterial(2);
    const { salt, env } = wrapSecret(b, '1234');
    const back = unwrapSecret(env, salt, '1234');
    expect(equalBytes(back.masterKey, b.masterKey)).toBe(true);
    expect(equalBytes(back.ed.privateKey, b.ed.privateKey)).toBe(true);
    expect(back.oneTimePreKeys.length).toBe(2);
  });

  it('fails with the wrong PIN', () => {
    const b = generateIdentityMaterial(1);
    const { salt, env } = wrapSecret(b, '1234');
    expect(() => unwrapSecret(env, salt, '9999')).toThrow();
  });
});

describe('recovery code', () => {
  it('restores identity + master key, and rejects a wrong code', () => {
    const b = generateIdentityMaterial(1);
    const code = generateRecoveryCode();
    const { salt, env } = wrapRecovery(b, code);
    const r = unwrapRecovery(env, salt, code);
    expect(equalBytes(r.masterKey, b.masterKey)).toBe(true);
    expect(equalBytes(r.x.privateKey, b.x.privateKey)).toBe(true);
    expect(() => unwrapRecovery(env, salt, 'WRONG-CODE')).toThrow();
  });
});

describe('public bundle + fingerprint', () => {
  it('exposes only public material and a stable fingerprint', () => {
    const b = generateIdentityMaterial(2);
    const pub = publicBundleOf(b);
    expect(pub.edPub).toBe(bytesToB64url(b.ed.publicKey));
    expect(pub.oneTimePreKeys.length).toBe(2);
    // No private key bytes should appear anywhere in the serialized public bundle.
    expect(JSON.stringify(pub).includes(bytesToB64url(b.ed.privateKey))).toBe(false);
    expect(fingerprintOf(b)).toBe(fingerprintOf(b));
  });
});
