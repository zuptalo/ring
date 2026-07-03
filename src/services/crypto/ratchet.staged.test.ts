// Spec 1032 (T009) — the staged authoritative open (openPacketStaged) that lets the
// service worker persist the FULL ratchet advance (DH steps included) atomically
// with the message row. Constitution Principle IV adversarial set:
//   - staged open returns the advanced state WITHOUT persisting;
//   - after the caller persists it, a subsequent SEAL on the reloaded state still
//     decrypts at the peer (send-chain integrity across a staged DH step);
//   - replaying the same packet fails (the key was consumed);
//   - forged ciphertext fails;
//   - a >50-frame out-of-order backlog (newest-first apply, like a capped
//     /relay/pending fetch) decrypts via the skipped-key cache.
//
// Same harness as messaging-preview.test.ts: mock idb with in-memory Maps
// (structuredClone on write), run the real X3DH + Double Ratchet.
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
vi.mock('../api', () => ({
  publishPreKeys: vi.fn(),
  preKeyCount: vi.fn(),
  addOneTimeKeys: vi.fn(),
  fetchPeerBundle: vi.fn(),
}));

import { ready } from './primitives';
import {
  x3dhInitiator,
  x3dhResponder,
  ratchetInitAlice,
  ratchetInitBob,
  saveSession,
  loadSession,
  type RatchetState,
} from './ratchet';
import { sealMessage, openMessage } from './message';
import { generateIdentityMaterial, type SecretBundle } from './identity';
import * as identity from './identity';
import type { WirePacket, StagedOpen } from '../messaging';

let bob: SecretBundle;
let alice: RatchetState;

vi.spyOn(identity, 'getIdentityKeys').mockImplementation(() => ({ ed: bob.ed, x: bob.x }));
vi.spyOn(identity, 'getSignedPreKey').mockImplementation(() => ({
  id: bob.signedPreKey.id,
  keypair: bob.signedPreKey.keypair,
}));
vi.spyOn(identity, 'getOneTimePreKeyById').mockImplementation(
  (id: string) => bob.oneTimePreKeys.find((p) => p.id === id)?.keypair ?? null,
);

import { openPacket, openPacketStaged, DeferFrame } from '../messaging';

beforeAll(async () => {
  await ready();
});

const CHAT = 'chat-with-alice';
const body = (s: string) => ({ body: s, kind: 'text', timestamp: 1 });

async function setupPersistedPair(): Promise<void> {
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
}

const N = (b: string): WirePacket => ({ v: 1, type: 'normal', msg: sealMessage(alice, body(b)) });

/** What sw-drain does after a staged open: commit the staged rows. Here that's
 *  just writes into the mock idb (atomicity itself is proven in idb.transact.test.ts). */
async function commitStaged(staged: StagedOpen): Promise<void> {
  const idb = await import('@/db/idb');
  await idb.put('sessions', staged.sessionRow);
  for (const w of staged.metaWrites) await idb.put('settings', { key: w.key, value: w.value });
}

beforeEach(() => {
  for (const m of Object.values(stores)) m.clear();
});

describe('openPacketStaged: stages, never persists', () => {
  it('decrypts (incl. the very first DH step) and leaves the persisted session untouched', async () => {
    await setupPersistedPair();
    const before = structuredClone(storeOf('sessions').get(CHAT));

    const staged = await openPacketStaged(CHAT, N('hello')); // Bob's first receive = a DH step
    expect(staged.payload.body).toBe('hello');
    expect(staged.sessionRow.id).toBe(CHAT);
    // Nothing persisted by the call itself:
    expect(storeOf('sessions').get(CHAT)).toEqual(before);
  });

  it('first contact (no session) → DeferFrame, never a partial establish', async () => {
    await setupPersistedPair();
    const idb = await import('@/db/idb');
    await idb.remove('sessions', CHAT);
    await expect(openPacketStaged(CHAT, N('first'))).rejects.toBeInstanceOf(DeferFrame);
    expect(await loadSession(CHAT)).toBeNull(); // still nothing persisted
  });

  it('forged ciphertext → DeferFrame(undecryptable), session untouched', async () => {
    await setupPersistedPair();
    const wire = N('real');
    const forged = structuredClone(wire) as WirePacket & { msg: { env: { ct: string } } };
    forged.msg.env.ct = forged.msg.env.ct.slice(0, -4) + 'AAAA'; // corrupt ciphertext||tag
    const before = structuredClone(storeOf('sessions').get(CHAT));
    await expect(openPacketStaged(CHAT, forged)).rejects.toBeInstanceOf(DeferFrame);
    expect(storeOf('sessions').get(CHAT)).toEqual(before);
    // The genuine packet still opens afterwards (nothing was consumed).
    expect((await openPacketStaged(CHAT, wire)).payload.body).toBe('real');
  });
});

describe('send-chain integrity across a staged, committed DH step', () => {
  it('after commit, a seal on the RELOADED state still decrypts at the peer', async () => {
    await setupPersistedPair();

    // Alice → Bob: staged authoritative open TAKES a DH step (Bob's first receive
    // mints a fresh DHs); the caller commits it.
    const staged = await openPacketStaged(CHAT, N('takes a DH step'));
    await commitStaged(staged);

    // Bob now SEALS from the reloaded (committed) state — the exact write the old
    // "SW never persists DH steps" rule protected. If the staged commit had
    // clobbered/forked the send-state, Alice couldn't decrypt this.
    const bobSession = (await loadSession(CHAT)) as RatchetState;
    const reply = sealMessage(bobSession, body('reply after staged DH'));
    await saveSession(CHAT, bobSession);
    expect(openMessage(alice, reply).body).toBe('reply after staged DH');

    // And the round-trip continues both ways.
    const staged2 = await openPacketStaged(CHAT, N('second inbound'));
    await commitStaged(staged2);
    expect(staged2.payload.body).toBe('second inbound');
  });

  it('interleaved with the PAGE authoritative open: page open → staged open → page seal', async () => {
    await setupPersistedPair();
    // Page opens one authoritatively (persists), then the SW stages + commits the next,
    // then the page seals — everything through the one persisted row, like real life
    // under the session lock.
    expect((await openPacket(CHAT, N('page-opened'))).body).toBe('page-opened');
    const staged = await openPacketStaged(CHAT, N('sw-applied'));
    await commitStaged(staged);
    const s = (await loadSession(CHAT)) as RatchetState;
    const out = sealMessage(s, body('page seal after sw commit'));
    await saveSession(CHAT, s);
    expect(openMessage(alice, out).body).toBe('page seal after sw commit');
  });
});

describe('replay + out-of-order backlog', () => {
  it('replaying an already-committed frame fails to open (key consumed)', async () => {
    await setupPersistedPair();
    const wire = N('once only');
    const staged = await openPacketStaged(CHAT, wire);
    await commitStaged(staged);
    // The authoritative open consumed the message key; a replay must not decrypt.
    await expect(openPacketStaged(CHAT, wire)).rejects.toBeInstanceOf(DeferFrame);
  });

  it('newest-first apply of a capped backlog: older frames still open via skipped keys', async () => {
    await setupPersistedPair();
    // 60 queued frames but the fetch is capped to the newest 50 (relay behavior):
    // the SW applies 10..59 first; the page later opens 0..9.
    const frames: WirePacket[] = [];
    for (let i = 0; i < 60; i++) frames.push(N(`m${i}`));

    for (let i = 10; i < 60; i++) {
      const staged = await openPacketStaged(CHAT, frames[i]);
      expect(staged.payload.body).toBe(`m${i}`);
      await commitStaged(staged);
    }
    // The skipped-key cache (persisted with the staged advances) still reaches the
    // 10 older frames, in any order.
    for (const i of [3, 0, 9, 5, 1, 2, 4, 6, 8, 7]) {
      expect((await openPacket(CHAT, frames[i])).body).toBe(`m${i}`);
    }
  });
});
