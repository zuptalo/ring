/**
 * Spec 2033 — the X3DH both-initiate collision at the MESSAGING layer.
 *
 * The pure Double Ratchet is fine (ratchet.test.ts); the field loss lived here:
 * when two peers who have never spoken both initiate X3DH to each other at
 * nearly the same time (a group fan-out makes this routine), each side's
 * "peer re-initiated" fallback REPLACED its own session with a responder of
 * the other's — a criss-cross where B sends on C's session lineage and C on
 * B's. Every later normal packet was undecryptable, and the crossing rekeys
 * re-raced the same collision instead of converging (the "second consecutive
 * frame lost" field signature).
 *
 * These tests simulate BOTH parties through the real sealForChat/openPacket
 * against a mocked IndexedDB + keystore (sessions are keyed by chatId, so the
 * two parties coexist in one store under their own carrier chat ids). The
 * invariant under test: after a simultaneous-initiation collision, BOTH
 * directions converge and keep working, in EVERY tie-break order — which is
 * why each scenario runs several rounds with fresh random identities.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

interface Party {
  bundle: import('./crypto/identity').SecretBundle;
  userId: string;
  chatId: string; // this party's local carrier chat for the OTHER party
}

const H = vi.hoisted(() => ({
  actor: 'B' as 'B' | 'C',
  parties: {} as Record<'B' | 'C', Party>,
  store: new Map<string, unknown>(),
}));

vi.mock('@/db/idb', () => ({
  // Rows are keyed like the real stores: sessions by `id`, settings by `key`.
  get: async (store: string, id: string) => H.store.get(`${store}:${id}`) ?? undefined,
  put: async (store: string, rec: { id?: string; key?: string }) => {
    H.store.set(`${store}:${rec.id ?? rec.key}`, rec);
  },
  remove: async (store: string, id: string) => {
    H.store.delete(`${store}:${id}`);
  },
}));

vi.mock('./cross-lock', () => ({
  withSessionLock: async (_id: string, fn: () => unknown) => fn(),
  LockTimeoutError: class LockTimeoutError extends Error {},
}));

vi.mock('./crypto/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./crypto/identity')>();
  return {
    ...actual,
    getIdentityKeys: () => ({ ed: H.parties[H.actor].bundle.ed, x: H.parties[H.actor].bundle.x }),
    getSignedPreKey: () => ({
      id: H.parties[H.actor].bundle.signedPreKey.id,
      keypair: H.parties[H.actor].bundle.signedPreKey.keypair,
    }),
    getOneTimePreKeyById: (id: string) =>
      H.parties[H.actor].bundle.oneTimePreKeys.find((p) => p.id === id)?.keypair ?? null,
    isUnlockedNow: () => true,
  };
});

vi.mock('./api', () => ({
  fetchPeerBundle: async (userId: string) => {
    const who: 'B' | 'C' = userId === H.parties.B.userId ? 'B' : 'C';
    const { publicBundleOf } = await import('./crypto/identity');
    const pub = publicBundleOf(H.parties[who].bundle);
    return {
      edPub: pub.edPub,
      xPub: pub.xPub,
      signedPreKey: pub.signedPreKey,
      // A stable one-time prekey (not popped): the keystore lookup must find it.
      oneTimePreKey: pub.oneTimePreKeys[0],
    };
  },
  publishPreKeys: async () => undefined,
  preKeyCount: async () => 99,
  addOneTimeKeys: async () => undefined,
}));

import { ready } from './crypto/primitives';
import { generateIdentityMaterial } from './crypto/identity';
import { sealForChat, openPacket, type WirePacket } from './messaging';
import type { MessagePayload } from './crypto/message';

const msg = (body: string): MessagePayload => ({ body, kind: 'text', timestamp: 1 });
const peerOf = (a: 'B' | 'C'): 'B' | 'C' => (a === 'B' ? 'C' : 'B');

async function seal(actor: 'B' | 'C', body: string): Promise<WirePacket> {
  H.actor = actor;
  const me = H.parties[actor];
  const sealed = await sealForChat(me.chatId, H.parties[peerOf(actor)].userId, false, msg(body));
  if (!sealed) throw new Error('seal returned null');
  return sealed.packet;
}

async function open(actor: 'B' | 'C', packet: WirePacket): Promise<MessagePayload> {
  H.actor = actor;
  return openPacket(H.parties[actor].chatId, packet);
}

function freshParties(): void {
  H.store.clear();
  H.parties = {
    B: { bundle: generateIdentityMaterial(2), userId: 'user-b', chatId: 'carrier-on-b' },
    C: { bundle: generateIdentityMaterial(2), userId: 'user-c', chatId: 'carrier-on-c' },
  };
}

beforeAll(async () => {
  await ready();
});

beforeEach(freshParties);

// The tie-break winner depends on random X3DH ephemerals, so every scenario
// runs several rounds with fresh identities — the invariant must hold in BOTH
// orders (and a failure message says which round broke).
const ROUNDS = 6;

describe('X3DH both-initiate collision (spec 2033)', () => {
  it('simultaneous initiations converge: consecutive frames flow BOTH ways afterwards (FR-001)', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      freshParties();
      // Both sides initiate before seeing anything from the other (the group
      // fan-out shape).
      const pB1 = await seal('B', 'bob here');
      const pC1 = await seal('C', 'carol here');
      // Each opens the other's colliding initiation — content must arrive.
      expect((await open('B', pC1)).body, `round ${round}`).toBe('carol here');
      expect((await open('C', pB1)).body, `round ${round}`).toBe('bob here');
      // The field bug: the next consecutive frames were permanently lost.
      const pC2 = await seal('C', 'carol 2');
      expect((await open('B', pC2)).body, `round ${round}`).toBe('carol 2');
      const pB2 = await seal('B', 'bob 2');
      expect((await open('C', pB2)).body, `round ${round}`).toBe('bob 2');
      // And the chains keep working (arbitrarily many consecutive frames).
      const pC3 = await seal('C', 'carol 3');
      const pC4 = await seal('C', 'carol 4');
      expect((await open('B', pC3)).body, `round ${round}`).toBe('carol 3');
      expect((await open('B', pC4)).body, `round ${round}`).toBe('carol 4');
    }
  });

  it('straggler frames sent before the collision resolves are all readable', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      freshParties();
      const pB1 = await seal('B', 'b1');
      // C sends SEVERAL frames on its doomed initiation before ever hearing B.
      const pC1 = await seal('C', 'c1');
      const pC2 = await seal('C', 'c2');
      const pC3 = await seal('C', 'c3');
      expect((await open('B', pC1)).body, `round ${round}`).toBe('c1');
      expect((await open('B', pC2)).body, `round ${round}`).toBe('c2');
      expect((await open('C', pB1)).body, `round ${round}`).toBe('b1');
      expect((await open('B', pC3)).body, `round ${round}`).toBe('c3');
      // Post-collision traffic converges both ways.
      const pC4 = await seal('C', 'c4');
      expect((await open('B', pC4)).body, `round ${round}`).toBe('c4');
      const pB2 = await seal('B', 'b2');
      expect((await open('C', pB2)).body, `round ${round}`).toBe('b2');
    }
  });

  it('the plain initiator→responder flow is untouched (no collision)', async () => {
    const pB1 = await seal('B', 'hi');
    expect((await open('C', pB1)).body).toBe('hi');
    const pC1 = await seal('C', 'hey');
    expect((await open('B', pC1)).body).toBe('hey');
    const pC2 = await seal('C', 'hey again'); // responder's consecutive send
    expect((await open('B', pC2)).body).toBe('hey again');
    const pB2 = await seal('B', 'more');
    expect((await open('C', pB2)).body).toBe('more');
  });

  it("a peer's genuine re-initiation (deleted chat) still replaces the session", async () => {
    // Establish + confirm a healthy session both ways.
    const pB1 = await seal('B', 'hi');
    expect((await open('C', pB1)).body).toBe('hi');
    const pC1 = await seal('C', 'hey');
    expect((await open('B', pC1)).body).toBe('hey');
    // C loses its session (deleted the chat) and re-initiates from scratch.
    const { clearSession } = await import('./messaging');
    H.actor = 'C';
    await clearSession(H.parties.C.chatId);
    const pC2 = await seal('C', 'fresh start');
    expect((await open('B', pC2)).body).toBe('fresh start');
    // The replaced session carries traffic both ways.
    const pB2 = await seal('B', 'welcome back');
    expect((await open('C', pB2)).body).toBe('welcome back');
    const pC3 = await seal('C', 'thanks');
    expect((await open('B', pC3)).body).toBe('thanks');
  });
});
