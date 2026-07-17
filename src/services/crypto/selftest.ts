/**
 * Crypto/sync self-tests: pure-client assertions runnable with no backend.
 * Phase 0 covers primitives + envelope; later phases append their own checks
 * (ratchet, outbox, tombstones, classification). The dev-only self-test screen
 * calls `runSelfTest()` and renders the results.
 */
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
  type SecretBundle,
} from './identity';
import {
  x3dhInitiator,
  x3dhResponder,
  ratchetInitAlice,
  ratchetInitBob,
  type RatchetState,
} from './ratchet';
import { sealMessage, openMessage } from './message';
import {
  createSenderKey,
  distributionFrom,
  receivingFromDistribution,
  groupEncrypt,
  groupDecrypt,
} from './senderkeys';
import {
  encryptBlob,
  decryptBlob,
  prepareOutgoingMedia,
  receiveIncomingMedia,
  downloadBlob,
} from '@/services/media-transfer';

export interface CheckResult {
  name: string;
  ok: boolean;
  error?: string;
}

type Check = { name: string; fn: () => void | Promise<void> };

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// Bridge libsodium's Uint8Array<ArrayBufferLike> to the DOM Blob's BlobPart.
const bp = (b: Uint8Array): BlobPart => b as unknown as BlobPart;

function phase0Checks(): Check[] {
  return [
    {
      name: 'base64url round-trips arbitrary bytes',
      fn: () => {
        const b = randomBytes(40);
        assert(equalBytes(b64urlToBytes(bytesToB64url(b)), b), 'b64url mismatch');
        assert(bytesToUtf8(utf8ToBytes('héllo ✓')) === 'héllo ✓', 'utf8 mismatch');
      },
    },
    {
      name: 'AEAD seal/open round-trips with AAD',
      fn: () => {
        const key = randomBytes(KEY_BYTES);
        const msg = utf8ToBytes('the quick brown fox');
        const aad = utf8ToBytes('chat:42');
        const { nonce, ct } = aeadSeal(key, msg, aad);
        assert(equalBytes(aeadOpen(key, nonce, ct, aad), msg), 'plaintext mismatch');
      },
    },
    {
      name: 'AEAD rejects tampered ciphertext',
      fn: () => {
        const key = randomBytes(KEY_BYTES);
        const { nonce, ct } = aeadSeal(key, utf8ToBytes('secret'));
        ct[0] ^= 0xff;
        assert(throws(() => aeadOpen(key, nonce, ct)), 'tamper not detected');
      },
    },
    {
      name: 'AEAD rejects wrong AAD',
      fn: () => {
        const key = randomBytes(KEY_BYTES);
        const { nonce, ct } = aeadSeal(key, utf8ToBytes('secret'), utf8ToBytes('a'));
        assert(throws(() => aeadOpen(key, nonce, ct, utf8ToBytes('b'))), 'AAD swap not detected');
      },
    },
    {
      name: 'X25519 agreement matches on both sides',
      fn: () => {
        const a = x25519Keypair();
        const b = x25519Keypair();
        const ab = x25519(a.privateKey, b.publicKey);
        const ba = x25519(b.privateKey, a.publicKey);
        assert(equalBytes(ab, ba), 'DH shared secrets differ');
      },
    },
    {
      name: 'Ed25519 sign/verify; rejects forgery',
      fn: () => {
        const kp = ed25519Keypair();
        const msg = utf8ToBytes('signed prekey');
        const sig = sign(kp.privateKey, msg);
        assert(verify(kp.publicKey, msg, sig), 'valid signature rejected');
        sig[0] ^= 0xff;
        assert(!verify(kp.publicKey, msg, sig), 'forged signature accepted');
      },
    },
    {
      name: 'HKDF is deterministic and context-separated',
      fn: () => {
        const ikm = randomBytes(32);
        const salt = randomBytes(16);
        const k1 = hkdf(ikm, 32, salt, utf8ToBytes('ctx-1'));
        const k1b = hkdf(ikm, 32, salt, utf8ToBytes('ctx-1'));
        const k2 = hkdf(ikm, 32, salt, utf8ToBytes('ctx-2'));
        assert(equalBytes(k1, k1b), 'HKDF not deterministic');
        assert(!equalBytes(k1, k2), 'HKDF info not separating outputs');
        assert(hkdf(ikm, 64, salt).length === 64, 'HKDF length wrong');
      },
    },
    {
      name: 'Argon2id derives a stable key from PIN+salt',
      fn: () => {
        const salt = randomBytes(ARGON_SALT_BYTES);
        // Keep the cost low in the test by reusing defaults; this is the slow check.
        const k1 = argon2id('1234', salt);
        const k2 = argon2id('1234', salt);
        const k3 = argon2id('9999', salt);
        assert(equalBytes(k1, k2), 'Argon2id not deterministic');
        assert(!equalBytes(k1, k3), 'different PIN gave same key');
      },
    },
    {
      name: 'Envelope seal/open + JSON round-trip',
      fn: () => {
        const key = randomBytes(KEY_BYTES);
        const env = sealJson(key, { name: 'Kamran', n: 7 }, 'master');
        const back = openJson<{ name: string; n: number }>(key, env);
        assert(back.name === 'Kamran' && back.n === 7, 'json envelope mismatch');
        const raw = seal(key, utf8ToBytes('x'), 'master');
        assert(equalBytes(open(key, raw), utf8ToBytes('x')), 'raw envelope mismatch');
      },
    },
    {
      name: 'Envelope rejects unknown version',
      fn: () => {
        const key = randomBytes(KEY_BYTES);
        const env = seal(key, utf8ToBytes('x'), 'master');
        const bad: Envelope = { ...env, v: 99 };
        assert(throws(() => open(key, bad)), 'unknown version accepted');
      },
    },
    {
      name: 'Packed blob round-trips and decrypts',
      fn: () => {
        const key = randomBytes(KEY_BYTES);
        const data = randomBytes(1000);
        const { nonce, ct } = aeadSeal(key, data);
        const packed = packBlob(nonce, ct);
        const u = unpackBlob(packed);
        assert(equalBytes(aeadOpen(key, u.nonce, u.ct), data), 'blob decrypt mismatch');
      },
    },
    {
      name: 'sha256 is stable',
      fn: () => {
        const a = sha256(utf8ToBytes('abc'));
        const b = sha256(utf8ToBytes('abc'));
        assert(equalBytes(a, b) && a.length === 32, 'sha256 unstable');
      },
    },
  ];
}

function phase1Checks(): Check[] {
  return [
    {
      name: 'identity material: signed prekey chains to identity key',
      fn: () => {
        const b = generateIdentityMaterial(3);
        assert(verifySignedPreKey(b), 'signed prekey signature invalid');
        assert(b.oneTimePreKeys.length === 3, 'prekey count wrong');
        assert(b.masterKey.length === KEY_BYTES, 'master key size wrong');
      },
    },
    {
      name: 'PIN wrap/unwrap restores the full bundle',
      fn: () => {
        const b = generateIdentityMaterial(2);
        const { salt, env } = wrapSecret(b, '1234');
        const back = unwrapSecret(env, salt, '1234');
        assert(equalBytes(back.masterKey, b.masterKey), 'master key not restored');
        assert(equalBytes(back.ed.privateKey, b.ed.privateKey), 'ed priv not restored');
        assert(back.oneTimePreKeys.length === 2, 'prekeys not restored');
      },
    },
    {
      name: 'wrong PIN fails to unwrap',
      fn: () => {
        const b = generateIdentityMaterial(1);
        const { salt, env } = wrapSecret(b, '1234');
        assert(throws(() => unwrapSecret(env, salt, '9999')), 'wrong PIN accepted');
      },
    },
    {
      name: 'recovery code restores identity + master key',
      fn: () => {
        const b = generateIdentityMaterial(1);
        const code = generateRecoveryCode();
        const { salt, env } = wrapRecovery(b, code);
        const r = unwrapRecovery(env, salt, code);
        assert(equalBytes(r.masterKey, b.masterKey), 'recovery master mismatch');
        assert(equalBytes(r.x.privateKey, b.x.privateKey), 'recovery x priv mismatch');
        assert(throws(() => unwrapRecovery(env, salt, 'WRONG-CODE')), 'wrong recovery code accepted');
      },
    },
    {
      name: 'public bundle exposes only public material; fingerprint stable',
      fn: () => {
        const b = generateIdentityMaterial(2);
        const pub = publicBundleOf(b);
        assert(pub.edPub === bytesToB64url(b.ed.publicKey), 'edPub mismatch');
        assert(pub.oneTimePreKeys.length === 2, 'otk count mismatch');
        // No private fields should be present anywhere in the serialized bundle.
        assert(!JSON.stringify(pub).includes(bytesToB64url(b.ed.privateKey)), 'private key leaked');
        assert(fingerprintOf(b) === fingerprintOf(b), 'fingerprint unstable');
      },
    },
  ];
}

// Establish a fresh Alice↔Bob pair via X3DH, returning ready ratchet states.
function setupPair(): { alice: RatchetState; bob: RatchetState; ad: Uint8Array; bobSK: Uint8Array; aliceSK: Uint8Array } {
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
  return { alice, bob, ad: utf8ToBytes('alice|bob'), bobSK, aliceSK: init.sk };
}

const msg = (body: string) => ({ body, kind: 'text', timestamp: 1 });

function phase4Checks(): Check[] {
  return [
    {
      name: 'X3DH: initiator and responder derive the same shared secret',
      fn: () => {
        const { aliceSK, bobSK } = setupPair();
        assert(equalBytes(aliceSK, bobSK), 'X3DH secrets differ');
      },
    },
    {
      name: 'Ratchet: 1:1 round-trip both directions (DH ratchet)',
      fn: () => {
        const { alice, bob, ad } = setupPair();
        const w1 = sealMessage(alice, msg('hi bob'), ad);
        assert(openMessage(bob, w1, ad).body === 'hi bob', 'A→B m1 failed');
        const w2 = sealMessage(alice, msg('still alice'), ad);
        assert(openMessage(bob, w2, ad).body === 'still alice', 'A→B m2 failed');
        // Bob replies → triggers a DH ratchet on Alice's side.
        const r1 = sealMessage(bob, msg('hey alice'), ad);
        assert(openMessage(alice, r1, ad).body === 'hey alice', 'B→A r1 failed');
        const w3 = sealMessage(alice, msg('after ratchet'), ad);
        assert(openMessage(bob, w3, ad).body === 'after ratchet', 'A→B post-ratchet failed');
      },
    },
    {
      name: 'Ratchet: out-of-order delivery (skipped message keys)',
      fn: () => {
        const { alice, bob, ad } = setupPair();
        const w1 = sealMessage(alice, msg('first'), ad);
        const w2 = sealMessage(alice, msg('second'), ad);
        const w3 = sealMessage(alice, msg('third'), ad);
        // Deliver out of order: 3, then 1, then 2.
        assert(openMessage(bob, w3, ad).body === 'third', 'ooo w3 failed');
        assert(openMessage(bob, w1, ad).body === 'first', 'ooo w1 failed');
        assert(openMessage(bob, w2, ad).body === 'second', 'ooo w2 failed');
      },
    },
    {
      name: 'Ratchet: tampered ciphertext is rejected',
      fn: () => {
        const { alice, bob, ad } = setupPair();
        const w = sealMessage(alice, msg('secret'), ad);
        const tampered = { ...w, env: { ...w.env, ct: w.env.ct.slice(0, -2) + (w.env.ct.endsWith('A') ? 'B' : 'A') } };
        assert(throws(() => openMessage(bob, tampered, ad)), 'tamper not detected');
      },
    },
    {
      name: 'Ratchet: wrong associated data is rejected',
      fn: () => {
        const { alice, bob } = setupPair();
        const w = sealMessage(alice, msg('bound'), utf8ToBytes('ad-1'));
        assert(throws(() => openMessage(bob, w, utf8ToBytes('ad-2'))), 'AD binding not enforced');
      },
    },
  ];
}

function phase5Checks(): Check[] {
  const ad = utf8ToBytes('group:42');
  const enc = (state: ReturnType<typeof createSenderKey>, body: string) =>
    groupEncrypt(state, utf8ToBytes(body), ad);
  const dec = (recv: ReturnType<typeof receivingFromDistribution>, m: ReturnType<typeof enc>) =>
    bytesToUtf8(groupDecrypt(recv, m, ad));

  return [
    {
      name: 'Sender keys: fan-out to multiple members',
      fn: () => {
        const alice = createSenderKey();
        const bob = receivingFromDistribution(distributionFrom(alice));
        const carol = receivingFromDistribution(distributionFrom(alice));
        const m1 = enc(alice, 'hello group');
        const m2 = enc(alice, 'second');
        assert(dec(bob, m1) === 'hello group', 'bob m1');
        assert(dec(carol, m1) === 'hello group', 'carol m1');
        assert(dec(bob, m2) === 'second', 'bob m2');
        assert(dec(carol, m2) === 'second', 'carol m2');
      },
    },
    {
      name: 'Sender keys: out-of-order delivery',
      fn: () => {
        const alice = createSenderKey();
        const bob = receivingFromDistribution(distributionFrom(alice));
        const m1 = enc(alice, 'one');
        const m2 = enc(alice, 'two');
        const m3 = enc(alice, 'three');
        assert(dec(bob, m3) === 'three', 'ooo m3');
        assert(dec(bob, m1) === 'one', 'ooo m1');
        assert(dec(bob, m2) === 'two', 'ooo m2');
      },
    },
    {
      name: 'Sender keys: tampered ciphertext and signature rejected',
      fn: () => {
        const alice = createSenderKey();
        const bob = receivingFromDistribution(distributionFrom(alice));
        const m = enc(alice, 'authentic');
        const badCt = { ...m, env: { ...m.env, ct: m.env.ct.slice(0, -2) + (m.env.ct.endsWith('A') ? 'B' : 'A') } };
        assert(throws(() => dec(bob, badCt)), 'tampered ct accepted');
        const badSig = { ...m, signature: m.signature.slice(0, -2) + (m.signature.endsWith('A') ? 'B' : 'A') };
        assert(throws(() => dec(bob, badSig)), 'tampered signature accepted');
      },
    },
    {
      name: 'Sender keys: a member cannot forge another sender',
      fn: () => {
        // Mallory has the (shared) group context but her own signing key.
        const alice = createSenderKey();
        const bobForAlice = receivingFromDistribution(distributionFrom(alice));
        const mallory = createSenderKey();
        const forged = enc(mallory, 'pretending to be alice');
        // Bob holds Alice's signing pub → Mallory's signature fails to verify.
        assert(throws(() => dec(bobForAlice, forged)), 'forged sender accepted');
      },
    },
    {
      name: 'Sender keys: rotation invalidates the old key',
      fn: () => {
        const alice1 = createSenderKey();
        const bobOld = receivingFromDistribution(distributionFrom(alice1));
        // Membership changes → Alice rotates and redistributes.
        const alice2 = createSenderKey();
        const bobNew = receivingFromDistribution(distributionFrom(alice2));
        const m = enc(alice2, 'after rotation');
        assert(dec(bobNew, m) === 'after rotation', 'new key fails');
        assert(throws(() => dec(bobOld, m)), 'old key still decrypts after rotation');
      },
    },
  ];
}

async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

function phase6Checks(): Check[] {
  return [
    {
      name: 'Media: encrypt/decrypt round-trips the blob',
      fn: async () => {
        const data = randomBytes(2048);
        const blob = new Blob([bp(data)], { type: 'image/png' });
        const { ciphertext, fileKey } = await encryptBlob(blob);
        assert(!equalBytes(await blobBytes(ciphertext), data), 'ciphertext equals plaintext');
        const back = await decryptBlob(ciphertext, fileKey, 'image/png');
        assert(equalBytes(await blobBytes(back), data), 'decrypted bytes differ');
        assert(back.type === 'image/png', 'mime not preserved');
      },
    },
    {
      name: 'Media: wrong file key fails to decrypt',
      fn: async () => {
        const { ciphertext } = await encryptBlob(new Blob([bp(randomBytes(512))]));
        let threw = false;
        try {
          await decryptBlob(ciphertext, randomBytes(KEY_BYTES), 'application/octet-stream');
        } catch {
          threw = true;
        }
        assert(threw, 'wrong key decrypted');
      },
    },
    {
      name: 'Media: prepare → receive pipeline (mock blob store)',
      fn: async () => {
        const data = randomBytes(4096);
        const blob = new Blob([bp(data)], { type: 'audio/wav' });
        const ref = await prepareOutgoingMedia(blob, 'note.wav', 5);
        assert(!!ref.blobId && !!ref.fileKey, 'ref missing fields');
        assert(ref.mime === 'audio/wav' && ref.size === blob.size && ref.durationSec === 5, 'ref metadata wrong');
        const recv = await receiveIncomingMedia(ref);
        assert(recv !== null && equalBytes(await blobBytes(recv), data), 'pipeline bytes differ');
      },
    },
    {
      name: 'Media: tampered ciphertext is rejected',
      fn: async () => {
        const blob = new Blob([bp(randomBytes(1024))], { type: 'image/png' });
        const ref = await prepareOutgoingMedia(blob, 'x.png');
        const ct = await downloadBlob(ref.blobId);
        const bytes = await blobBytes(ct as Blob);
        bytes[bytes.length - 1] ^= 0xff;
        let threw = false;
        try {
          await decryptBlob(new Blob([bp(bytes)]), b64urlToBytes(ref.fileKey), ref.mime);
        } catch {
          threw = true;
        }
        assert(threw, 'tampered ciphertext accepted');
      },
    },
    {
      name: 'Media: unknown blob id yields null',
      fn: async () => {
        const recv = await receiveIncomingMedia({
          blobId: 'does-not-exist',
          fileKey: bytesToB64url(randomBytes(KEY_BYTES)),
          mime: 'application/octet-stream',
          size: 0,
          name: 'x',
        });
        assert(recv === null, 'unknown blob did not return null');
      },
    },
  ];
}

/** Run every registered check; never throws, returns per-check results. */
export async function runSelfTest(): Promise<CheckResult[]> {
  await ready();
  const checks: Check[] = [
    ...phase0Checks(),
    ...phase1Checks(),
    ...phase4Checks(),
    ...phase5Checks(),
    ...phase6Checks(),
  ];
  const results: CheckResult[] = [];
  for (const c of checks) {
    try {
      await c.fn();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
