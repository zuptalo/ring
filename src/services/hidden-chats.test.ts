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
}));

// hidden-chats.ts persists via idb get/put on the 'settings' store directly; back
// it with an in-memory map. `touch` is a no-op (no DOM bus in node).
vi.mock('@/db/idb', () => ({
  get: async (_store: string, key: string) => (h.settings.has(key) ? { key, value: h.settings.get(key) } : undefined),
  put: async (_store: string, row: { key: string; value: unknown }) => {
    h.settings.set(row.key, row.value);
  },
  touch: () => {},
}));

vi.mock('@/services/crypto/identity', () => ({
  getMasterKey: () => {
    if (!h.mk.key) throw new Error('locked');
    return h.mk.key;
  },
}));

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
} from './hidden-chats';
import { clearHiddenState, isRevealed, isHiddenKnown } from './hidden-state';

beforeAll(async () => {
  await ready();
  h.mk.key = randomBytes(32);
});

beforeEach(() => {
  h.settings.clear();
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

// `isHiddenKnown()` is the signal the chat/call-list choke points use to fail
// CLOSED on startup: an empty cache could mean "nothing hidden" OR "couldn't
// decrypt yet" (keystore still locked behind the unlock gate). Conflating them is
// what caused the flash of hidden chats before they were filtered, so the lists
// must show nothing until this flips true.
describe('isHiddenKnown (startup fail-closed signal)', () => {
  it('is false until loaded, stays false while a configured set is locked, true after it decrypts', async () => {
    clearHiddenState();
    expect(isHiddenKnown()).toBe(false); // nothing loaded yet

    await addHidden('chat-A'); // writes the (sealed) SET_KEY
    clearHiddenState(); // forget the cache → simulate a fresh page load
    const saved = h.mk.key;
    h.mk.key = null; // keystore locked at open
    expect([...(await getHiddenSet())]).toEqual([]); // fails closed (empty)
    expect(isHiddenKnown()).toBe(false); // ...and NOT mistaken for "nothing hidden"

    h.mk.key = saved; // unlock → the next read decrypts and the set becomes known
    expect([...(await getHiddenSet())]).toEqual(['chat-A']);
    expect(isHiddenKnown()).toBe(true);
  });

  it('is known (true) even while locked when no hidden set was ever configured', async () => {
    clearHiddenState();
    h.settings.clear(); // no SET_KEY at all → nothing to decrypt
    const saved = h.mk.key;
    h.mk.key = null; // locked, but irrelevant with no set
    expect([...(await getHiddenSet())]).toEqual([]);
    expect(isHiddenKnown()).toBe(true); // definitively empty → lists render normally, no blank flash
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

  it('stores the PIN length sealed, not in cleartext (spec 1027 T044)', async () => {
    await enableHiddenPin('123456');
    const raw = JSON.stringify(h.settings.get('privacy.hiddenPin'));
    expect(raw).not.toContain('"length"'); // no legacy cleartext field
    expect(raw).not.toContain(':6'); // the digit count itself never appears bare
    expect(await hiddenPinLength()).toBe(6); // ...but reads fine while unlocked
  }, PIN_TIMEOUT);

  it('migrates a legacy cleartext-length record in place on first read', async () => {
    // Simulate a pre-1027 record: real verifier + cleartext `length`.
    await enableHiddenPin('98765');
    const rec = h.settings.get('privacy.hiddenPin') as { salt: string; env: unknown; len?: unknown };
    h.settings.set('privacy.hiddenPin', { salt: rec.salt, env: rec.env, length: 5 });
    expect(await hiddenPinLength()).toBe(5); // read works...
    const migrated = JSON.stringify(h.settings.get('privacy.hiddenPin'));
    expect(migrated).not.toContain('"length"'); // ...and the plaintext is gone
    expect(await hiddenPinLength()).toBe(5); // sealed copy round-trips
    expect(await verifyHiddenPin('98765')).toBe(true); // verifier untouched
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

describe('reveal flag isolation', () => {
  it('the reveal session starts locked', () => {
    expect(isRevealed()).toBe(false);
  });
});
