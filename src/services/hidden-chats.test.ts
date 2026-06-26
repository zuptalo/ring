// Unit tests for the Hidden Chats service (spec 1019). The idb-backed settings
// layer and the master-key accessor are mocked so we exercise the REAL crypto
// (Argon2id PIN verifier + master-key-sealed hidden set) without a DOM/IndexedDB.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { ready, randomBytes } from './crypto/primitives';

// In-memory settings + a swappable master key, hoisted so the vi.mock factories
// (which are hoisted above imports) can close over them.
const h = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  mk: { key: null as Uint8Array | null },
  groups: [] as Array<{ name: string; members: string[] }>,
}));

vi.mock('@/db/queries', () => ({
  getSetting: async (k: string, fb: unknown) => (h.settings.has(k) ? h.settings.get(k) : fb),
  setSetting: async (k: string, v: unknown) => {
    h.settings.set(k, v);
  },
  createGroup: async (name: string, members: string[]) => {
    h.groups.push({ name, members });
    return `grp-${members.join('-')}-${h.groups.length}`;
  },
}));

vi.mock('@/services/crypto/identity', () => ({
  getMasterKey: () => {
    if (!h.mk.key) throw new Error('locked');
    return h.mk.key;
  },
}));

// Keep the real hidden-state leaf, but stub idb.touch (no DOM bus in node).
vi.mock('@/db/idb', () => ({ touch: () => {} }));

import {
  getHiddenSet,
  isHidden,
  addHidden,
  removeHidden,
  hasHiddenPin,
  enableHiddenPin,
  verifyHiddenPin,
  changeHiddenPin,
  hiddenPinLength,
  startHiddenChat,
} from './hidden-chats';
import { clearHiddenState, isRevealed } from './hidden-state';

beforeAll(async () => {
  await ready();
  h.mk.key = randomBytes(32);
});

beforeEach(() => {
  h.settings.clear();
  h.groups.length = 0;
  clearHiddenState();
});

describe('hidden set (membership)', () => {
  it('starts empty and round-trips hides/unhides', async () => {
    expect([...(await getHiddenSet())]).toEqual([]);
    await addHidden('chat-A');
    await addHidden('chat-B');
    expect(await isHidden('chat-A')).toBe(true);
    expect(await isHidden('chat-Z')).toBe(false);
    await removeHidden('chat-A');
    expect(await isHidden('chat-A')).toBe(false);
    expect(await isHidden('chat-B')).toBe(true);
  });

  it('add/remove are idempotent', async () => {
    await addHidden('chat-A');
    await addHidden('chat-A');
    expect([...(await getHiddenSet())]).toEqual(['chat-A']);
    await removeHidden('nope'); // no-op
    expect([...(await getHiddenSet())]).toEqual(['chat-A']);
  });

  it('persists the set AEAD-sealed at rest, never as plaintext ids (FR-010)', async () => {
    await addHidden('secret-chat');
    const stored = h.settings.get('privacy.hiddenChats') as { __enc?: number; env?: unknown };
    expect(stored.__enc).toBe(1);
    expect(stored.env).toBeDefined();
    // The raw stored blob must not contain the plaintext id.
    expect(JSON.stringify(stored)).not.toContain('secret-chat');
  });

  it('fails closed (empty) when the keystore is locked', async () => {
    await addHidden('chat-A');
    clearHiddenState();
    const saved = h.mk.key;
    h.mk.key = null; // simulate locked
    expect([...(await getHiddenSet())]).toEqual([]); // no leak, no throw
    h.mk.key = saved;
  });
});

// Argon2id is deliberately slow (brute-force mitigation, FR-022); under the full
// parallel suite these PIN tests need a generous timeout vs. the 5s default.
const PIN_TIMEOUT = 30_000;

describe('separate dedicated PIN', () => {
  it('reports no PIN until enabled, then verifies only the correct PIN', async () => {
    expect(await hasHiddenPin()).toBe(false);
    expect(await verifyHiddenPin('1234')).toBe(false); // no PIN → no oracle
    await enableHiddenPin('1234');
    expect(await hasHiddenPin()).toBe(true);
    expect(await verifyHiddenPin('1234')).toBe(true);
    expect(await verifyHiddenPin('9999')).toBe(false);
  }, PIN_TIMEOUT);

  it('never stores the PIN in recoverable form', async () => {
    await enableHiddenPin('4321');
    expect(JSON.stringify(h.settings.get('privacy.hiddenPin'))).not.toContain('4321');
  }, PIN_TIMEOUT);

  it('exposes the PIN length for auto-verify-at-length', async () => {
    expect(await hiddenPinLength()).toBeNull();
    await enableHiddenPin('123456');
    expect(await hiddenPinLength()).toBe(6);
  }, PIN_TIMEOUT);

  it('change requires the old PIN and rotates the verifier', async () => {
    await enableHiddenPin('1111');
    await expect(changeHiddenPin('0000', '2222')).rejects.toThrow();
    await changeHiddenPin('1111', '2222');
    expect(await verifyHiddenPin('1111')).toBe(false);
    expect(await verifyHiddenPin('2222')).toBe(true);
  }, PIN_TIMEOUT);

  it('uses a salt independent of any app PIN (distinct salts per enable)', async () => {
    await enableHiddenPin('1234');
    const a = (h.settings.get('privacy.hiddenPin') as { salt: string }).salt;
    await enableHiddenPin('1234');
    const b = (h.settings.get('privacy.hiddenPin') as { salt: string }).salt;
    expect(a).not.toEqual(b); // fresh random salt each time
  }, PIN_TIMEOUT);
});

describe('startHiddenChat (coexisting distinct conversation)', () => {
  it('creates a distinct group and hides it, leaving any 1:1 untouched (FR-017)', async () => {
    const id = await startHiddenChat('contact-1');
    expect(h.groups).toHaveLength(1);
    expect(h.groups[0].members).toEqual(['contact-1']); // 2-person group
    expect(await isHidden(id)).toBe(true);
    // We never created or touched a 1:1 chat record here.
  });
});

describe('reveal flag isolation', () => {
  it('the reveal session starts locked', () => {
    expect(isRevealed()).toBe(false);
  });
});
