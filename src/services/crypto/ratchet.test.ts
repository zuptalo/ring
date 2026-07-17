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
  ratchetDecryptPreview,
  sessionRecord,
  sessionFromRecord,
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

  it('preview reports advancedDh: false within a chain, true across a DH ratchet (spec 2015 safety gate)', () => {
    // The service-worker preview persists ONLY same-chain advances. A frame that triggers a DH
    // ratchet (which would mint a fresh sending keypair) MUST be reported so previewPacket does NOT
    // persist it — otherwise the SW could clobber the page's authoritative send-state. This asserts
    // the flag that gate relies on.
    const { alice, bob, ad } = setupPair();
    // Establish Bob's receiving chain (Alice's FIRST message triggers Bob's initial DH ratchet, so
    // it can't be the "same-chain" case). Open it authoritatively.
    openMessage(bob, sealMessage(alice, msg('m0'), ad), ad);
    // Alice's NEXT message is within the same sending chain → preview takes NO DH step.
    const same = sealMessage(alice, msg('m1'), ad);
    const r0 = ratchetDecryptPreview(bob, same.header, same.env, ad);
    expect(JSON.parse(new TextDecoder().decode(r0.plaintext)).body).toBe('m1');
    expect(r0.advancedDh).toBe(false);
    // Make Alice ratchet: she receives a reply from Bob → her next message is a NEW chain.
    openMessage(alice, sealMessage(bob, msg('reply'), ad), ad);
    const dhStep = sealMessage(alice, msg('m2 new chain'), ad);
    const r1 = ratchetDecryptPreview(bob, dhStep.header, dhStep.env, ad);
    expect(JSON.parse(new TextDecoder().decode(r1.plaintext)).body).toBe('m2 new chain');
    expect(r1.advancedDh).toBe(true);
  });

  it('responder sends many consecutive frames on a fresh session (spec 2033 FR-001, pure level)', () => {
    // The exact field shape: initiator speaks once, then the RESPONDER sends
    // back-to-back frames with nothing received in between. The pure ratchet
    // must derive every key; the field loss lived in the layer above.
    const { alice, bob, ad } = setupPair();
    expect(openMessage(bob, sealMessage(alice, msg('bob here'), ad), ad).body).toBe('bob here');
    const s1 = sealMessage(bob, msg('carol 1'), ad);
    const s2 = sealMessage(bob, msg('carol 2'), ad);
    const s3 = sealMessage(bob, msg('carol 3'), ad);
    const s4 = sealMessage(bob, msg('carol 4'), ad);
    expect(openMessage(alice, s1, ad).body).toBe('carol 1');
    expect(openMessage(alice, s2, ad).body).toBe('carol 2');
    expect(openMessage(alice, s3, ad).body).toBe('carol 3');
    expect(openMessage(alice, s4, ad).body).toBe('carol 4');
  });

  it('consecutive sends survive a serialize/deserialize round-trip between every step (spec 2033)', () => {
    // Mirror the persistence layer: every seal/open is a load→advance→save, so
    // the state crosses SerializedSession (and IndexedDB's structured clone,
    // approximated by JSON) between each frame on BOTH sides.
    const roundTrip = (s: RatchetState): RatchetState =>
      sessionFromRecord(JSON.parse(JSON.stringify(sessionRecord('t', s))));
    const { alice, bob, ad } = setupPair();
    let A = alice;
    let B = bob;
    const send = (from: 'A' | 'B', body: string) => {
      const st = from === 'A' ? A : B;
      const wire = sealMessage(st, msg(body), ad);
      if (from === 'A') A = roundTrip(A);
      else B = roundTrip(B);
      return wire;
    };
    const recv = (at: 'A' | 'B', wire: ReturnType<typeof sealMessage>, body: string) => {
      const st = at === 'A' ? A : B;
      expect(openMessage(st, wire, ad).body).toBe(body);
      if (at === 'A') A = roundTrip(A);
      else B = roundTrip(B);
    };
    recv('B', send('A', 'bob here'), 'bob here');
    const w1 = send('B', 'carol 1');
    const w2 = send('B', 'carol 2');
    recv('A', w1, 'carol 1');
    const w3 = send('B', 'carol 3');
    recv('A', w2, 'carol 2');
    recv('A', w3, 'carol 3');
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
