// Unit tests for group messaging via sender keys: fan-out to multiple members,
// out-of-order delivery, authentication (tamper + cross-member forgery), and key
// rotation invalidating the prior epoch.
import { describe, it, expect, beforeAll } from 'vitest';
import { ready } from './primitives';
import { utf8ToBytes, bytesToUtf8 } from './envelope';
import {
  createSenderKey,
  distributionFrom,
  receivingFromDistribution,
  groupEncrypt,
  groupDecrypt,
} from './senderkeys';

beforeAll(async () => {
  await ready();
});

const ad = utf8ToBytes('group:42');
const enc = (state: ReturnType<typeof createSenderKey>, body: string) =>
  groupEncrypt(state, utf8ToBytes(body), ad);
const dec = (recv: ReturnType<typeof receivingFromDistribution>, m: ReturnType<typeof enc>) =>
  bytesToUtf8(groupDecrypt(recv, m, ad));

describe('sender keys', () => {
  it('fans out to multiple members', () => {
    const alice = createSenderKey();
    const bob = receivingFromDistribution(distributionFrom(alice));
    const carol = receivingFromDistribution(distributionFrom(alice));
    const m1 = enc(alice, 'hello group');
    const m2 = enc(alice, 'second');
    expect(dec(bob, m1)).toBe('hello group');
    expect(dec(carol, m1)).toBe('hello group');
    expect(dec(bob, m2)).toBe('second');
    expect(dec(carol, m2)).toBe('second');
  });

  it('handles out-of-order delivery', () => {
    const alice = createSenderKey();
    const bob = receivingFromDistribution(distributionFrom(alice));
    const m1 = enc(alice, 'one');
    const m2 = enc(alice, 'two');
    const m3 = enc(alice, 'three');
    expect(dec(bob, m3)).toBe('three');
    expect(dec(bob, m1)).toBe('one');
    expect(dec(bob, m2)).toBe('two');
  });

  it('rejects tampered ciphertext and tampered signature', () => {
    const alice = createSenderKey();
    const bob = receivingFromDistribution(distributionFrom(alice));
    const m = enc(alice, 'authentic');
    const badCt = { ...m, env: { ...m.env, ct: m.env.ct.slice(0, -2) + (m.env.ct.endsWith('A') ? 'B' : 'A') } };
    expect(() => dec(bob, badCt)).toThrow();
    const badSig = { ...m, signature: m.signature.slice(0, -2) + (m.signature.endsWith('A') ? 'B' : 'A') };
    expect(() => dec(bob, badSig)).toThrow();
  });

  it('prevents one member forging another sender', () => {
    const alice = createSenderKey();
    const bobForAlice = receivingFromDistribution(distributionFrom(alice));
    const mallory = createSenderKey();
    const forged = enc(mallory, 'pretending to be alice');
    expect(() => dec(bobForAlice, forged)).toThrow();
  });

  it('invalidates the old key after rotation', () => {
    const alice1 = createSenderKey();
    const bobOld = receivingFromDistribution(distributionFrom(alice1));
    const alice2 = createSenderKey();
    const bobNew = receivingFromDistribution(distributionFrom(alice2));
    const m = enc(alice2, 'after rotation');
    expect(dec(bobNew, m)).toBe('after rotation');
    expect(() => dec(bobOld, m)).toThrow();
  });
});
