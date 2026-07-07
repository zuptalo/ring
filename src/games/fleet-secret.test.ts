// Spec 1038 T006 — the namespaced fleet-secret helper. Two live namespaces
// (armada + legacy battleship) must never collide, secrets must round-trip as
// PLAIN data, and staged commits are keyed by session, not by hash.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { get } from '@/db/idb';
import {
  clearFleetSecret,
  clearStagedCommit,
  getFleetSecret,
  getStagedCommit,
  setFleetSecret,
  setStagedCommit,
} from './fleet-secret';

const SECRET = {
  layout: [
    { r: 0, c: 0, len: 5, dir: 'h' as const },
    { r: 2, c: 0, len: 4, dir: 'h' as const },
    { r: 4, c: 0, len: 3, dir: 'h' as const },
    { r: 6, c: 0, len: 3, dir: 'h' as const },
    { r: 8, c: 0, len: 2, dir: 'h' as const },
  ],
  salt: 'c2FsdA',
};

describe('fleet-secret (namespaced)', () => {
  it('round-trips a secret and clears it', async () => {
    await setFleetSecret('armada', 'HASH1', SECRET);
    expect(await getFleetSecret('armada', 'HASH1')).toEqual(SECRET);
    await clearFleetSecret('armada', 'HASH1');
    expect(await getFleetSecret('armada', 'HASH1')).toBeNull();
  });

  it('namespaces are isolated: an armada secret never shadows battleship keys', async () => {
    await setFleetSecret('armada', 'SAME', SECRET);
    expect(await getFleetSecret('battleship', 'SAME')).toBeNull();
    // The raw key uses the exact `${ns}.secret.${hash}` shape the legacy
    // helper established, so the two namespaces live side by side.
    const raw = await get<{ key: string }>('settings', 'armada.secret.SAME');
    expect(raw?.key).toBe('armada.secret.SAME');
    await clearFleetSecret('armada', 'SAME');
  });

  it('staged commits round-trip by SESSION key and clear independently of secrets', async () => {
    await setStagedCommit('armada', 'msg-1', { h: 'HASH1' });
    expect(await getStagedCommit('armada', 'msg-1')).toEqual({ h: 'HASH1' });
    expect(await getStagedCommit('armada', 'msg-2')).toBeNull();
    await clearStagedCommit('armada', 'msg-1');
    expect(await getStagedCommit('armada', 'msg-1')).toBeNull();
  });
});
