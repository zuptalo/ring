// Spec 1055 — the bounded push-preview crypto: seal a display preview under a
// per-message key derived from the ratchet message key, peek-decrypt it without
// consuming ratchet state, and lose the ability to decrypt it once the message is
// opened authoritatively (forward secrecy). Plus buildPreview's bounding rules.
import { describe, it, expect, beforeAll } from 'vitest';
import { ready } from './primitives';
import { utf8ToBytes, bytesToUtf8 } from './envelope';
import {
  x3dhInitiator,
  x3dhResponder,
  ratchetInitAlice,
  ratchetInitBob,
  ratchetEncryptWithPreview,
  ratchetOpenPreview,
  sessionRecord,
  sessionFromRecord,
  type RatchetState,
} from './ratchet';
import { openMessage, type MessagePayload } from './message';
import { generateIdentityMaterial, type SecretBundle } from './identity';
import { buildPreview, truncateUtf8, PREVIEW_BODY_BUDGET } from './push-preview';
import { notifyPreview } from '@/utils/notify-preview';

beforeAll(async () => {
  await ready();
});

function setupPair(): { alice: RatchetState; bob: RatchetState; ad: Uint8Array } {
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
  return { alice, bob, ad: utf8ToBytes('alice|bob') };
}

const full = (body: string): MessagePayload => ({ body, kind: 'text', timestamp: 1 });
const clone = (s: RatchetState) => sessionFromRecord(sessionRecord('c', s)); // fresh, discardable copy
const sealBoth = (alice: RatchetState, payload: MessagePayload, preview: MessagePayload, ad: Uint8Array) =>
  ratchetEncryptWithPreview(alice, utf8ToBytes(JSON.stringify(payload)), utf8ToBytes(JSON.stringify(preview)), ad);

describe('spec 1055: ratchet push-preview seal/open', () => {
  it('peek-decrypts the preview AND opens the full message from one chain step', () => {
    const { alice, bob, ad } = setupPair();
    const payload = full('the full message body');
    const { header, env, previewEnv } = sealBoth(alice, payload, buildPreview(payload), ad);
    // Peek the preview on a discarded copy — the real bob state is untouched.
    const preview = JSON.parse(bytesToUtf8(ratchetOpenPreview(clone(bob), header, previewEnv, ad))) as MessagePayload;
    expect(preview.body).toBe('the full message body');
    // The full message still opens authoritatively.
    expect(openMessage(bob, { header, env }, ad).body).toBe('the full message body');
  });

  it('peek consumes nothing: the same message opens authoritatively afterwards', () => {
    const { alice, bob, ad } = setupPair();
    const { header, env, previewEnv } = sealBoth(alice, full('hi'), buildPreview(full('hi')), ad);
    // Peek repeatedly on copies — bob is never mutated.
    ratchetOpenPreview(clone(bob), header, previewEnv, ad);
    ratchetOpenPreview(clone(bob), header, previewEnv, ad);
    expect(openMessage(bob, { header, env }, ad).body).toBe('hi'); // still decrypts
  });

  it('a preview sealed for one frame cannot be opened against a different frame (header-bound AAD)', () => {
    const { alice, bob, ad } = setupPair();
    const m1 = sealBoth(alice, full('one'), buildPreview(full('one')), ad);
    const m2 = sealBoth(alice, full('two'), buildPreview(full('two')), ad);
    // m2's preview envelope opened with m1's header must fail (wrong key AND wrong AAD).
    expect(() => ratchetOpenPreview(clone(bob), m1.header, m2.previewEnv, ad)).toThrow();
  });

  it('FORWARD SECRECY (SC-006): once the message is opened authoritatively, the preview is undecryptable', () => {
    const { alice, bob, ad } = setupPair();
    const { header, env, previewEnv } = sealBoth(alice, full('secret'), buildPreview(full('secret')), ad);
    // Before authoritative open: a fresh copy CAN peek the preview.
    expect(JSON.parse(bytesToUtf8(ratchetOpenPreview(clone(bob), header, previewEnv, ad))).body).toBe('secret');
    // Authoritative open consumes mk_N and advances the chain past it.
    openMessage(bob, { header, env }, ad);
    // A fresh copy of the now-advanced state can no longer derive mk_N → preview is dead.
    expect(() => ratchetOpenPreview(clone(bob), header, previewEnv, ad)).toThrow();
  });
});

describe('spec 1055: truncateUtf8', () => {
  it('leaves a short string untouched', () => {
    expect(truncateUtf8('hello', 256)).toBe('hello');
  });
  it('truncates a long ASCII string to the byte budget', () => {
    const long = 'a'.repeat(1000);
    const out = truncateUtf8(long, 256);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(256);
    expect(out.length).toBe(256); // ASCII: 1 byte per char
  });
  it('never splits a multi-byte character (emoji stays whole)', () => {
    const emoji = '😀'.repeat(200); // 4 bytes each
    const out = truncateUtf8(emoji, 10); // fits exactly 2 emoji (8 bytes), not a partial 3rd
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(10);
    expect([...out].every((c) => c === '😀')).toBe(true); // no mojibake / lone surrogate
  });
});

describe('spec 1055: buildPreview', () => {
  it('truncates the body to the byte budget', () => {
    const p = buildPreview(full('x'.repeat(1000)));
    expect(new TextEncoder().encode(p.body).length).toBeLessThanOrEqual(PREVIEW_BODY_BUDGET);
  });

  it('drops the media reference entirely (no file key, no poster leaks in the push)', () => {
    const p = buildPreview({
      body: '',
      kind: 'image',
      timestamp: 1,
      mediaRef: { blobId: 'b', fileKey: 'SECRET_KEY', mime: 'image/jpeg', size: 9, name: 'p.jpg', poster: 'data:...' },
    });
    expect(p.mediaRef).toBeUndefined();
    // The notification still renders a kind label from `kind` alone.
    expect(notifyPreview(p)).toBe('Photo');
  });

  it('shrinks structured fields to just what the notification renders', () => {
    const p = buildPreview({
      body: '',
      kind: 'poll',
      timestamp: 1,
      poll: { question: 'Lunch?', options: [{ id: '1', text: 'Pizza' }], votes: {} } as MessagePayload['poll'],
    });
    expect(p.poll).toEqual({ question: 'Lunch?' });
    expect(notifyPreview(p)).toBe('Poll: Lunch?');
  });

  it('keeps routing + escalation fields the renderer needs', () => {
    const p = buildPreview({
      body: 'hey @you',
      kind: 'text',
      timestamp: 1,
      groupId: 'g1',
      prid: 'route',
      mentions: ['u2'],
      reply: { senderId: 'u2', messageId: 'm', body: 'quoted body that should be dropped' } as MessagePayload['reply'],
    });
    expect(p.groupId).toBe('g1');
    expect(p.prid).toBe('route');
    expect(p.mentions).toEqual(['u2']);
    expect(p.reply).toEqual({ senderId: 'u2' }); // quoted body dropped
  });
});
