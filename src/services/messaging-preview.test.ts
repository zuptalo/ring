// Spec 2015 — the service-worker READ-ONLY message preview (`previewPacket`) must
// reliably decrypt queued chat messages even after the authoritative receive path
// (`openPacket`, driven by live 1:1 call signalling — offer/ICE + spec-0007 `qos`)
// has advanced AND persisted the shared pairwise Double Ratchet PAST those messages
// while the app was open.
//
// The bug lives in the load→advance→(save?) persistence dance, not the pure ratchet,
// so these tests exercise the messaging-layer functions (openPacket / previewPacket).
// We mock the three boundaries messaging.ts depends on:
//   - @/db/idb  → an in-memory record store (sessions + settings); structuredClone on
//                 write so the persisted copy can't share mutable refs with the
//                 in-memory one (otherwise read-only-vs-persisted bugs would be masked).
//   - identity  → Bob's responder key material (so establishResponderSession works).
//   - api       → never hit the network.
// The ratchet/X3DH crypto itself runs for real.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const stores: Record<string, Map<string, unknown>> = {};
function storeOf(name: string): Map<string, unknown> {
  return (stores[name] ??= new Map());
}
vi.mock('@/db/idb', () => ({
  get: vi.fn(async (store: string, key: string) => storeOf(store).get(key)),
  put: vi.fn(async (store: string, value: { id?: string; key?: string }) => {
    const k = (value.id ?? value.key) as string;
    storeOf(store).set(k, structuredClone(value));
  }),
  remove: vi.fn(async (store: string, key: string) => {
    storeOf(store).delete(key);
  }),
}));
vi.mock('./api', () => ({
  publishPreKeys: vi.fn(),
  preKeyCount: vi.fn(),
  addOneTimeKeys: vi.fn(),
  fetchPeerBundle: vi.fn(),
}));

import { ready } from './crypto/primitives';
import { bytesToB64url } from './crypto/envelope';
import {
  x3dhInitiator,
  x3dhResponder,
  ratchetInitAlice,
  ratchetInitBob,
  saveSession,
  loadSession,
  type RatchetState,
} from './crypto/ratchet';
import { sealMessage } from './crypto/message';
import { generateIdentityMaterial, type SecretBundle } from './crypto/identity';
import * as identity from './crypto/identity';
import type { WirePacket } from './messaging';

let bob: SecretBundle;
let alice: RatchetState; // the sender's ratchet, driven in-memory by the test

vi.spyOn(identity, 'getIdentityKeys').mockImplementation(() => ({ ed: bob.ed, x: bob.x }));
vi.spyOn(identity, 'getSignedPreKey').mockImplementation(() => ({
  id: bob.signedPreKey.id,
  keypair: bob.signedPreKey.keypair,
}));
vi.spyOn(identity, 'getOneTimePreKeyById').mockImplementation(
  (id: string) => bob.oneTimePreKeys.find((p) => p.id === id)?.keypair ?? null,
);

import { openPacket, previewPacket } from './messaging';

beforeAll(async () => {
  await ready();
});

const CHAT = 'chat-with-alice';
const body = (s: string) => ({ body: s, kind: 'text', timestamp: 1 });

// Build a live Alice↔Bob pair via real X3DH. `alice` (the sender) is driven in
// memory; Bob's session is persisted into the mock idb under CHAT — the on-device
// state messaging.ts loads. Returns the prekey preamble for the first packet.
async function setupPersistedPair(): Promise<{
  preamble: Omit<Extract<WirePacket, { type: 'prekey' }>, 'v' | 'type' | 'msg'>;
}> {
  bob = generateIdentityMaterial(2);
  const a: SecretBundle = generateIdentityMaterial(2);
  const otk = bob.oneTimePreKeys[0];
  const init = x3dhInitiator(a.x.privateKey, {
    identityX: bob.x.publicKey,
    signedPreKey: bob.signedPreKey.keypair.publicKey,
    oneTimePreKey: otk.keypair.publicKey,
  });
  const bobSK = x3dhResponder({
    identityXPriv: bob.x.privateKey,
    signedPreKeyPriv: bob.signedPreKey.keypair.privateKey,
    oneTimePreKeyPriv: otk.keypair.privateKey,
    initiatorIdentityX: a.x.publicKey,
    initiatorEphemeral: init.ephemeral.publicKey,
  });
  alice = ratchetInitAlice(init.sk, bob.signedPreKey.keypair.publicKey);
  await saveSession(CHAT, ratchetInitBob(bobSK, bob.signedPreKey.keypair));
  return {
    preamble: {
      idEd: bytesToB64url(a.ed.publicKey),
      idX: bytesToB64url(a.x.publicKey),
      eph: bytesToB64url(init.ephemeral.publicKey),
      spkId: bob.signedPreKey.id,
      otkId: otk.id,
    },
  };
}

const N = (b: string): WirePacket => ({ v: 1, type: 'normal', msg: sealMessage(alice, body(b)) });
const PREKEY = (
  preamble: Awaited<ReturnType<typeof setupPersistedPair>>['preamble'],
  b: string,
): WirePacket => ({ v: 1, type: 'prekey', ...preamble, msg: sealMessage(alice, body(b)) });

beforeEach(() => {
  for (const m of Object.values(stores)) m.clear();
});

describe('spec 2015: SW preview decrypts a backlog the persisted base advanced past', () => {
  // The defining repro. A purely read-only preview reloads the SAME persisted base for
  // EVERY frame, so it can only reach a frame within MAX_SKIP (1000) of that base. When
  // the relay returns a backlog longer than MAX_SKIP — exactly what builds up after the
  // app is idle a while, with live call/`qos` signalling having pushed the base forward —
  // the read-only preview hits the skip wall and fails ("ciphertext cannot be decrypted")
  // for everything past it, degrading those notifications to generic. By persisting the
  // advance, each frame is previewed from a base that has moved forward, so an arbitrarily
  // long backlog previews in order (FR-001/FR-002, edge case "a large backlog").
  it('REPRO: a backlog longer than MAX_SKIP previews in order (read-only would wall at 1000)', { timeout: 30_000 }, async () => {
    const { preamble } = await setupPersistedPair();
    await openPacket(CHAT, PREKEY(preamble, 'hi')); // establish; Nr→1

    const BACKLOG = 1050; // > MAX_SKIP (1000): enough to cross the read-only skip wall
    const frames: WirePacket[] = [];
    for (let i = 0; i < BACKLOG; i++) frames.push(N(`m${i}`));

    // Previewing past index ~1000 is the regression line: with the OLD read-only preview
    // this rejects with "ciphertext cannot be decrypted using that key"; the fix advances
    // the persisted base so it keeps going.
    for (let i = 0; i < BACKLOG; i++) {
      expect((await previewPacket(CHAT, frames[i])).body).toBe(`m${i}`);
    }
  });

  // Control: confirm the mechanism is the over-advanced base / skip wall, not the harness.
  it('control: a fresh in-order queued message still previews', async () => {
    const { preamble } = await setupPersistedPair();
    await openPacket(CHAT, PREKEY(preamble, 'hi'));
    expect((await previewPacket(CHAT, N('hello'))).body).toBe('hello');
  });

  // The dominant real-world trigger: live call/`qos` signalling opened authoritatively
  // (openPacket) advances + persists the base PAST a chat message still queued in the
  // relay. The preview must still decrypt that queued message.
  it('decrypts a queued message after live signalling advanced+persisted the base past it', async () => {
    const { preamble } = await setupPersistedPair();
    await openPacket(CHAT, PREKEY(preamble, 'hi')); // n=0, Nr→1

    const queued = N('queued chat message'); // n=1 — stays in the relay queue
    const sig1 = N('call offer'); // n=2  — live signals over the WS
    const sig2 = N('ice candidate'); // n=3
    const sig3 = N('qos report'); // n=4

    // App open: only the live signals are received authoritatively (queued never is),
    // advancing + persisting Bob's base to Nr=5.
    await openPacket(CHAT, sig1);
    await openPacket(CHAT, sig2);
    await openPacket(CHAT, sig3);

    // SW previews the still-queued frame from the over-advanced base → must decrypt.
    expect((await previewPacket(CHAT, queued)).body).toBe('queued chat message');
  });
});

describe('spec 2015: idempotency / no corruption (FR-005)', () => {
  // After the SW preview advanced + PERSISTED the receiving ratchet, the page's
  // authoritative open of the SAME and SUBSEQUENT messages must still decrypt — the
  // preview must never make a message undecryptable for the authoritative receiver.
  it('authoritative openPacket still decrypts the same + later messages after a preview', async () => {
    const { preamble } = await setupPersistedPair();
    await openPacket(CHAT, PREKEY(preamble, 'hi'));

    const m1 = N('one');
    const m2 = N('two');
    const m3 = N('three');

    // SW previews a backlog (advances + persists).
    expect((await previewPacket(CHAT, m1)).body).toBe('one');
    expect((await previewPacket(CHAT, m2)).body).toBe('two');
    expect((await previewPacket(CHAT, m3)).body).toBe('three');

    // Page later opens them authoritatively — must all still decrypt (via the
    // persisted skipped-key cache the preview left behind), in any order.
    expect((await openPacket(CHAT, m2)).body).toBe('two');
    expect((await openPacket(CHAT, m1)).body).toBe('one');
    expect((await openPacket(CHAT, m3)).body).toBe('three');

    // And a brand-new message after all that still works both ways.
    const m4 = N('four');
    expect((await previewPacket(CHAT, m4)).body).toBe('four');
    expect((await openPacket(CHAT, m4)).body).toBe('four');
  });

  // A first-contact prekey (X3DH) message previewed by the SW must NOT consume the
  // one-time prekey or persist a responder session — the page stays authoritative for
  // X3DH, so its later open of that same prekey message must still succeed.
  it('a previewed first-contact prekey is NOT consumed: the page can still open it', async () => {
    const { preamble } = await setupPersistedPair();
    // No session persisted for a *different* chat: simulate first contact by clearing
    // the persisted session so previewPacket takes the establish-responder path.
    await import('@/db/idb').then((idb) => idb.remove('sessions', CHAT));

    const first = PREKEY(preamble, 'first hello');

    // Preview decrypts in-memory (shows content) ...
    expect((await previewPacket(CHAT, first)).body).toBe('first hello');
    // ... but must NOT have persisted a responder session.
    expect(await loadSession(CHAT)).toBeNull();
    // ... so the page's authoritative open still establishes + decrypts it.
    expect((await openPacket(CHAT, first)).body).toBe('first hello');
    expect(await loadSession(CHAT)).not.toBeNull();
  });

  // The initiator send-preamble is cleared only by the page's authoritative openPacket,
  // never by a preview (FR-004). We assert via the session-meta the preview leaves alone.
  it('the send-preamble is cleared only by openPacket, never by previewPacket', async () => {
    const { preamble } = await setupPersistedPair();
    await openPacket(CHAT, PREKEY(preamble, 'hi'));

    // Make THIS device an initiator awaiting confirmation: write a session-meta with
    // sendPreamble=true (the shape sealForChat writes; we set it directly to avoid the
    // network bootstrap).
    const idb = await import('@/db/idb');
    await idb.put('settings', {
      key: `smeta:${CHAT}`,
      value: { peerUserId: 'alice', sendPreamble: true, preamble: { idEd: 'x', idX: 'x', eph: 'x', spkId: 'x' } },
    });

    // A preview of an inbound message must NOT clear the preamble.
    await previewPacket(CHAT, N('inbound'));
    const afterPreview = await idb.get<{ key: string; value: { sendPreamble: boolean } }>(
      'settings',
      `smeta:${CHAT}`,
    );
    expect(afterPreview?.value.sendPreamble).toBe(true);

    // The page's authoritative open DOES clear it.
    await openPacket(CHAT, N('inbound 2'));
    const afterOpen = await idb.get<{ key: string; value: { sendPreamble: boolean } }>(
      'settings',
      `smeta:${CHAT}`,
    );
    expect(afterOpen?.value.sendPreamble).toBe(false);
  });
});
