import { describe, it, expect, vi, beforeEach } from 'vitest';

// warmStores talks to IndexedDB-backed and crypto-heavy modules; mock them so the
// store logic (warm/clear/idempotency/zero-knowledge invariants) is tested in
// isolation in the node env. `isUnlocked` is a plain {value} we can flip per test.
const h = vi.hoisted(() => ({
  unlocked: { value: false },
  getSecret: vi.fn(),
  listChats: vi.fn(),
  listCallGroups: vi.fn(),
  listContacts: vi.fn(),
  unsub: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('@/services/crypto/identity', () => ({ isUnlocked: h.unlocked }));
vi.mock('@/db/secrets', () => ({ getSecret: h.getSecret }));
vi.mock('@/db/queries', () => ({
  listChats: h.listChats,
  listCallGroups: h.listCallGroups,
  listContacts: h.listContacts,
}));
vi.mock('@/db/idb', () => ({ subscribe: h.subscribe }));
vi.mock('@/services/auth', () => ({ getSelfUsername: () => 'alice' }));

import {
  warmAll, clearWarm,
  profileName, profileAbout, profileAvatarRaw, profileWarmed,
  warmChats, warmChatsLoaded, warmCalls, warmCallsLoaded, warmContacts, warmContactsLoaded,
} from './warmStores';

function happyPaths() {
  h.getSecret.mockImplementation(async (key: string, fallback: unknown) => {
    if (key === 'profileName') return 'Alice Real';
    if (key === 'profileAbout') return 'About me';
    if (key === 'profileAvatar') return 'data:image/png;base64,REAL';
    return fallback;
  });
  h.listChats.mockResolvedValue([{ id: 'c1' }]);
  h.listCallGroups.mockResolvedValue([{ id: 'g1' }]);
  h.listContacts.mockResolvedValue([{ id: 'p1' }]);
}

beforeEach(() => {
  h.unlocked.value = false;
  clearWarm(); // reset singleton to cold between tests
  vi.clearAllMocks();
  h.subscribe.mockReturnValue(h.unsub); // each subscribe returns the same unsub spy
});

describe('warmStores', () => {
  it('does not warm while locked (failed/aborted unlock)', async () => {
    happyPaths();
    h.unlocked.value = false;
    await warmAll();

    expect(h.getSecret).not.toHaveBeenCalled();
    expect(h.listChats).not.toHaveBeenCalled();
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(warmChatsLoaded.value).toBe(false);
    expect(profileWarmed.value).toBe(false);
  });

  it('populates every store and subscribes once when unlocked', async () => {
    happyPaths();
    h.unlocked.value = true;
    await warmAll();

    expect(profileName.value).toBe('Alice Real');
    expect(profileAbout.value).toBe('About me');
    expect(profileAvatarRaw.value).toBe('data:image/png;base64,REAL');
    expect(profileWarmed.value).toBe(true);

    expect(warmChats.value).toEqual([{ id: 'c1' }]);
    expect(warmChatsLoaded.value).toBe(true);
    expect(warmCalls.value).toEqual([{ id: 'g1' }]);
    expect(warmCallsLoaded.value).toBe(true);
    expect(warmContacts.value).toEqual([{ id: 'p1' }]);
    expect(warmContactsLoaded.value).toBe(true);

    // One subscription per store set (profile, chats, calls, contacts).
    expect(h.subscribe).toHaveBeenCalledTimes(4);
  });

  it('is idempotent: a second warmAll does not re-subscribe', async () => {
    happyPaths();
    h.unlocked.value = true;
    await warmAll();
    await warmAll();
    expect(h.subscribe).toHaveBeenCalledTimes(4); // not 8
  });

  it('leaves a store COLD if its query throws (no partial plaintext cached)', async () => {
    happyPaths();
    h.listChats.mockRejectedValue(new Error('decrypt failed'));
    h.unlocked.value = true;
    await warmAll();

    // Chats stayed cold; the others still warmed.
    expect(warmChats.value).toEqual([]);
    expect(warmChatsLoaded.value).toBe(false);
    expect(warmCallsLoaded.value).toBe(true);
    expect(warmContactsLoaded.value).toBe(true);
  });

  it('clearWarm resets every ref to its cold initial value and unsubscribes', async () => {
    happyPaths();
    h.unlocked.value = true;
    await warmAll();
    expect(profileWarmed.value).toBe(true); // sanity: it was warm

    clearWarm();

    // No decrypted residue: everything back to cold initial values.
    expect(profileName.value).toBe('Alice'); // fallback from @username
    expect(profileAbout.value).toBe('Hey there! I am using Ring.');
    expect(profileAvatarRaw.value).toBe('');
    expect(profileWarmed.value).toBe(false);
    expect(warmChats.value).toEqual([]);
    expect(warmChatsLoaded.value).toBe(false);
    expect(warmCalls.value).toEqual([]);
    expect(warmCallsLoaded.value).toBe(false);
    expect(warmContacts.value).toEqual([]);
    expect(warmContactsLoaded.value).toBe(false);

    // Each live subscription was torn down.
    expect(h.unsub).toHaveBeenCalledTimes(4);
  });
});
