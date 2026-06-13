// Unit tests for the 1:1 session: X3DH agreement + the Double Ratchet (via
// message.ts seal/open). Covers the happy path both directions (incl. a DH ratchet
// step), out-of-order delivery (skipped message keys), and authentication.
import { describe, it, expect, beforeAll } from 'vitest';
import { ready, equalBytes } from './primitives';
import { utf8ToBytes } from './envelope';
import {
  x3dhInitiator,
  x3dhResponder,
  ratchetInitAlice,
  ratchetInitBob,
  type RatchetState,
} from './ratchet';
import { sealMessage, openMessage } from './message';
import { generateIdentityMaterial, type SecretBundle } from './identity';

beforeAll(async () => {
  await ready();
});

// Establish a fresh Alice<->Bob pair via X3DH, returning ready ratchet states and
// the shared secrets each side derived (so the test can assert they match).
function setupPair(): {
  alice: RatchetState;
  bob: RatchetState;
  ad: Uint8Array;
  aliceSK: Uint8Array;
  bobSK: Uint8Array;
} {
  const a: SecretBundle = generateIdentityMaterial(2);
  const b: SecretBundle = generateIdentityMaterial(2);
  const init = x3dhInitiator(a.x.privateKey, {
    identityX: b.x.publicKey,
    signedPreKey: b.signedPreKey.keypair.publicKey,
    oneTimePreKey: b.oneTimePreKeys[0].keypair.publicKey,
  });
  const bobSK = x3dhResponder({
    identityXPriv: b.x.privateKey,
    signedPreKeyPriv: b.signedPreKey.keypair.privateKey,
    oneTimePreKeyPriv: b.oneTimePreKeys[0].keypair.privateKey,
    initiatorIdentityX: a.x.publicKey,
    initiatorEphemeral: init.ephemeral.publicKey,
  });
  const alice = ratchetInitAlice(init.sk, b.signedPreKey.keypair.publicKey);
  const bob = ratchetInitBob(bobSK, b.signedPreKey.keypair);
  return { alice, bob, ad: utf8ToBytes('alice|bob'), aliceSK: init.sk, bobSK };
}

const msg = (body: string) => ({ body, kind: 'text', timestamp: 1 });

describe('X3DH', () => {
  it('initiator and responder derive the same shared secret', () => {
    const { aliceSK, bobSK } = setupPair();
    expect(equalBytes(aliceSK, bobSK)).toBe(true);
  });
});

describe('Double Ratchet', () => {
  it('round-trips both directions, including a DH ratchet step', () => {
    const { alice, bob, ad } = setupPair();
    expect(openMessage(bob, sealMessage(alice, msg('hi bob'), ad), ad).body).toBe('hi bob');
    expect(openMessage(bob, sealMessage(alice, msg('still alice'), ad), ad).body).toBe('still alice');
    // Bob replies -> triggers a DH ratchet on Alice's side.
    expect(openMessage(alice, sealMessage(bob, msg('hey alice'), ad), ad).body).toBe('hey alice');
    expect(openMessage(bob, sealMessage(alice, msg('after ratchet'), ad), ad).body).toBe('after ratchet');
  });

  it('handles out-of-order delivery (skipped message keys)', () => {
    const { alice, bob, ad } = setupPair();
    const w1 = sealMessage(alice, msg('first'), ad);
    const w2 = sealMessage(alice, msg('second'), ad);
    const w3 = sealMessage(alice, msg('third'), ad);
    expect(openMessage(bob, w3, ad).body).toBe('third');
    expect(openMessage(bob, w1, ad).body).toBe('first');
    expect(openMessage(bob, w2, ad).body).toBe('second');
  });

  it('rejects tampered ciphertext', () => {
    const { alice, bob, ad } = setupPair();
    const w = sealMessage(alice, msg('secret'), ad);
    const tampered = {
      ...w,
      env: { ...w.env, ct: w.env.ct.slice(0, -2) + (w.env.ct.endsWith('A') ? 'B' : 'A') },
    };
    expect(() => openMessage(bob, tampered, ad)).toThrow();
  });

  it('enforces associated-data binding', () => {
    const { alice, bob } = setupPair();
    const w = sealMessage(alice, msg('bound'), utf8ToBytes('ad-1'));
    expect(() => openMessage(bob, w, utf8ToBytes('ad-2'))).toThrow();
  });
});
